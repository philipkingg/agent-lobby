import Fastify from "fastify";
import websocketPlugin from "@fastify/websocket";
import type { DatabaseSync } from "node:sqlite";
import { createDb } from "./db.js";
import { createProject, listProjects, getProject, InvalidProjectPathError, type GitExecFn } from "./projects.js";
import { listTasks, getTask, setTaskStatus, setTaskPrResult, setTaskFailed, setTaskWorktreeRemoved, type Task, type TaskMode } from "./tasks.js";
import { WorktreeError, removeWorktree } from "./worktrees.js";
import { listTranscriptEntries } from "./transcripts.js";
import { AgentRunner, type QueryFn } from "./agent-runner.js";
import { PtyManager, type SpawnFn } from "./pty-runner.js";
import { createPullRequest, type ExecFn } from "./pr-service.js";
import { TaskManager } from "./task-manager.js";
import { getMaxConcurrentAgents, setMaxConcurrentAgents } from "./settings.js";
import type { Project } from "./projects.js";
import type { WsEvent } from "./ws-events.js";

const TERMINAL_STATUSES = ["done", "error", "stopped", "failed"];

export function buildApp(
  db: DatabaseSync = createDb(),
  queryFn?: QueryFn,
  spawnFn?: SpawnFn,
  execFn?: ExecFn,
  gitExecFn?: GitExecFn
) {
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

    if (event.type === "status" && TERMINAL_STATUSES.includes(event.status)) {
      taskManager.onTaskFinished();
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

  const dispatchTask = (task: Task, project: Project) => {
    if (task.mode === "sdk") {
      runner.run(task, project).catch(() => {
        setTaskStatus(db, task.id, "error");
        broadcast(task.id, { type: "status", status: "error" });
      });
    } else {
      ptyManager.start(task);
    }
  };

  const taskManager = new TaskManager(db, dispatchTask);

  // Resume in-progress tasks left over from a previous run (e.g. server restart).
  const incomplete = listTasks(db).filter((t) => t.status === "running" || t.status === "blocked");
  for (const task of incomplete) {
    const project = getProject(db, task.projectId);
    if (!project) continue;

    if (task.mode === "sdk") {
      dispatchTask(task, project);
    } else {
      setTaskFailed(db, task.id, "pty session cannot be resumed after a restart");
      broadcast(task.id, { type: "status", status: "failed" });
    }
  }

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

    if ((body.source !== "path" && body.source !== "url") || !body.value) {
      return reply.code(400).send({ error: "expected { source: 'path' | 'url', value: string }" });
    }

    try {
      const project = createProject(db, { source: body.source, value: body.value }, gitExecFn);
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
      const task = taskManager.createTask(project, { description: body.description, mode: body.mode as TaskMode });
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

  app.post("/tasks/:id/retry", async (request, reply) => {
    const { id } = request.params as { id: string };
    const task = getTask(db, id);
    if (!task) {
      return reply.code(404).send({ error: "task not found" });
    }
    if (task.status !== "failed") {
      return reply.code(409).send({ error: "task is not failed" });
    }

    const project = getProject(db, task.projectId);
    if (!project) {
      return reply.code(404).send({ error: "project not found" });
    }

    try {
      const fresh = taskManager.createTask(project, { description: task.description, mode: task.mode });
      return reply.code(201).send(fresh);
    } catch (err) {
      if (err instanceof WorktreeError) {
        return reply.code(500).send({ error: err.message });
      }
      throw err;
    }
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

  app.delete("/tasks/:id/worktree", async (request, reply) => {
    const { id } = request.params as { id: string };
    const task = getTask(db, id);
    if (!task) {
      return reply.code(404).send({ error: "task not found" });
    }
    if (!TERMINAL_STATUSES.includes(task.status)) {
      return reply.code(409).send({ error: "task is still running" });
    }

    const project = getProject(db, task.projectId);
    if (!project) {
      return reply.code(404).send({ error: "project not found" });
    }

    try {
      removeWorktree(project, task.id);
    } catch (err) {
      if (err instanceof WorktreeError) {
        return reply.code(500).send({ error: err.message });
      }
      throw err;
    }

    setTaskWorktreeRemoved(db, id);
    return getTask(db, id);
  });

  app.get("/settings", async () => {
    return { maxConcurrentAgents: getMaxConcurrentAgents(db) };
  });

  app.post("/settings", async (request, reply) => {
    const body = request.body as { maxConcurrentAgents?: number };
    if (typeof body.maxConcurrentAgents !== "number" || !Number.isFinite(body.maxConcurrentAgents)) {
      return reply.code(400).send({ error: "expected { maxConcurrentAgents: number }" });
    }
    const maxConcurrentAgents = setMaxConcurrentAgents(db, body.maxConcurrentAgents);
    return { maxConcurrentAgents };
  });

  return app;
}
