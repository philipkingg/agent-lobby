import Fastify from "fastify";
import websocketPlugin from "@fastify/websocket";
import type { DatabaseSync } from "node:sqlite";
import { createDb } from "./db.js";
import { createProject, listProjects, getProject, InvalidProjectPathError } from "./projects.js";
import { createTask, listTasks, getTask, setTaskStatus, setTaskPrResult, type TaskMode } from "./tasks.js";
import { WorktreeError } from "./worktrees.js";
import { listTranscriptEntries } from "./transcripts.js";
import { AgentRunner, type QueryFn } from "./agent-runner.js";
import { PtyManager, type SpawnFn } from "./pty-runner.js";
import { createPullRequest, type ExecFn } from "./pr-service.js";
import type { WsEvent } from "./ws-events.js";

export function buildApp(db: DatabaseSync = createDb(), queryFn?: QueryFn, spawnFn?: SpawnFn, execFn?: ExecFn) {
  const app = Fastify();

  const subscribers = new Map<string, Set<{ send: (data: string) => void }>>();
  const broadcast = (taskId: string, event: WsEvent) => {
    const sockets = subscribers.get(taskId);
    if (sockets) {
      const payload = JSON.stringify(event);
      for (const socket of sockets) {
        socket.send(payload);
      }
    }

    if (event.type === "status" && event.status === "done") {
      openPullRequest(taskId);
    }
  };

  const openPullRequest = (taskId: string) => {
    const task = getTask(db, taskId);
    const project = task && getProject(db, task.projectId);
    if (!task || !project) return;
    const result = createPullRequest(task, project, execFn);
    setTaskPrResult(db, taskId, result);
  };

  const runner = new AgentRunner(db, broadcast, queryFn);
  const ptyManager = new PtyManager(db, broadcast, spawnFn);

  app.register(websocketPlugin);

  app.register(async (instance) => {
    instance.get("/ws/tasks/:id", { websocket: true }, (socket, request) => {
      const { id } = request.params as { id: string };
      let sockets = subscribers.get(id);
      if (!sockets) {
        sockets = new Set();
        subscribers.set(id, sockets);
      }
      sockets.add(socket);

      socket.on("message", (raw: Buffer) => {
        let msg: { type?: string; data?: string; cols?: number; rows?: number };
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }

        if (msg.type === "input" && typeof msg.data === "string") {
          ptyManager.write(id, msg.data);
        } else if (msg.type === "resize" && typeof msg.cols === "number" && typeof msg.rows === "number") {
          ptyManager.resize(id, msg.cols, msg.rows);
        }
      });

      socket.on("close", () => {
        sockets?.delete(socket);
      });
    });
  });

  app.get("/health", async () => {
    return { status: "ok" };
  });

  app.post("/projects", async (request, reply) => {
    const body = request.body as { source?: string; value?: string };

    if (body.source !== "path" || !body.value) {
      return reply.code(400).send({ error: "expected { source: 'path', value: string }" });
    }

    try {
      const project = createProject(db, { source: "path", value: body.value });
      return reply.code(201).send(project);
    } catch (err) {
      if (err instanceof InvalidProjectPathError) {
        return reply.code(400).send({ error: err.message });
      }
      throw err;
    }
  });

  app.get("/projects", async () => {
    return listProjects(db);
  });

  app.post("/projects/:id/tasks", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { description?: string; mode?: string };

    if (!body.description || (body.mode !== "sdk" && body.mode !== "pty")) {
      return reply.code(400).send({ error: "expected { description: string, mode: 'sdk' | 'pty' }" });
    }

    const project = getProject(db, id);
    if (!project) {
      return reply.code(404).send({ error: "project not found" });
    }

    try {
      const task = createTask(db, project, { description: body.description, mode: body.mode as TaskMode });

      if (task.mode === "sdk") {
        runner.run(task, project).catch(() => {
          setTaskStatus(db, task.id, "error");
          broadcast(task.id, { type: "status", status: "error" });
        });
      } else {
        ptyManager.start(task);
      }

      return reply.code(201).send(task);
    } catch (err) {
      if (err instanceof WorktreeError) {
        return reply.code(500).send({ error: err.message });
      }
      throw err;
    }
  });

  app.get("/tasks", async () => {
    return listTasks(db);
  });

  app.get("/tasks/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const task = getTask(db, id);
    if (!task) {
      return reply.code(404).send({ error: "task not found" });
    }
    return task;
  });

  app.get("/tasks/:id/transcript", async (request, reply) => {
    const { id } = request.params as { id: string };
    const task = getTask(db, id);
    if (!task) {
      return reply.code(404).send({ error: "task not found" });
    }
    return listTranscriptEntries(db, id);
  });

  app.post("/tasks/:id/respond", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { message?: string };

    if (!body.message) {
      return reply.code(400).send({ error: "expected { message: string }" });
    }

    const task = getTask(db, id);
    if (!task) {
      return reply.code(404).send({ error: "task not found" });
    }

    if (!runner.respond(id, body.message)) {
      return reply.code(409).send({ error: "task is not waiting for a response" });
    }

    return { ok: true };
  });

  app.post("/tasks/:id/retry-pr", async (request, reply) => {
    const { id } = request.params as { id: string };
    const task = getTask(db, id);
    if (!task) {
      return reply.code(404).send({ error: "task not found" });
    }
    if (task.status !== "done") {
      return reply.code(409).send({ error: "task is not done" });
    }

    openPullRequest(id);
    return getTask(db, id);
  });

  app.post("/tasks/:id/stop", async (request, reply) => {
    const { id } = request.params as { id: string };
    const task = getTask(db, id);
    if (!task) {
      return reply.code(404).send({ error: "task not found" });
    }

    if (!ptyManager.stop(id)) {
      return reply.code(409).send({ error: "task has no running pty session" });
    }

    return { ok: true };
  });

  return app;
}
