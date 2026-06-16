import Fastify from "fastify";
import websocketPlugin from "@fastify/websocket";
import type { DatabaseSync } from "node:sqlite";
import { createDb, SCHEMA_VERSION } from "./db.js";
import {
  createProject,
  listProjects,
  getProject,
  deleteProject,
  InvalidProjectPathError,
  type GitExecFn,
} from "./projects.js";
import {
  createTask,
  getTask,
  listTasks,
  deleteTask,
  approveTaskStage,
  retryStuckTask,
  listTaskStages,
  type CreateTaskInput,
} from "./tasks.js";
import { hireAgent, fireAgent, listAgents, getAgent, type HireAgentInput } from "./agents.js";
import {
  createSquad,
  updateSquad,
  deleteSquad,
  listSquads,
  getSquad,
  addAgentToSquad,
  removeAgentFromSquad,
} from "./squads.js";
import { listTranscriptEntries } from "./transcripts.js";
import { removeWorktree, WorktreeError } from "./worktrees.js";
import type { WsEvent } from "./ws-events.js";

export type { GitExecFn };

export function buildApp(db: DatabaseSync = createDb(), gitExecFn?: GitExecFn) {
  const app = Fastify();

  // WebSocket subscriber map — channel key → set of sockets
  const subscribers = new Map<string, Set<{ send: (data: string) => void }>>();

  const broadcast = (channel: string, event: WsEvent) => {
    const sockets = subscribers.get(channel);
    if (!sockets) return;
    const payload = JSON.stringify(event);
    for (const socket of sockets) socket.send(payload);
  };

  // Expose broadcast for Phase 2 scheduler wiring
  (app as unknown as { broadcast: typeof broadcast }).broadcast = broadcast;

  app.register(websocketPlugin);

  app.register(async (instance) => {
    // Task-scoped WS channel: /ws/tasks/:id
    instance.get("/ws/tasks/:id", { websocket: true }, (socket, request) => {
      const { id } = request.params as { id: string };
      let sockets = subscribers.get(`task:${id}`);
      if (!sockets) {
        sockets = new Set();
        subscribers.set(`task:${id}`, sockets);
      }
      sockets.add(socket);
      socket.on("close", () => sockets?.delete(socket));
    });

    // Global event channel (agent state, user XP, etc.)
    instance.get("/ws/events", { websocket: true }, (socket) => {
      let sockets = subscribers.get("global");
      if (!sockets) {
        sockets = new Set();
        subscribers.set("global", sockets);
      }
      sockets.add(socket);
      socket.on("close", () => sockets?.delete(socket));
    });
  });

  // ── Health ────────────────────────────────────────────────────────────────

  app.get("/health", async () => {
    return { status: "ok", schemaVersion: SCHEMA_VERSION };
  });

  // ── Projects ──────────────────────────────────────────────────────────────

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

  app.get("/projects", async () => listProjects(db));

  app.delete("/projects/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = getProject(db, id);
    if (!project) return reply.code(404).send({ error: "project not found" });

    // Delete all tasks and their worktrees
    const tasks = listTasks(db, { projectId: id });
    for (const task of tasks) {
      if (task.worktreePath) {
        try {
          removeWorktree(project, task.id);
        } catch {
          // worktree may already be gone
        }
      }
      deleteTask(db, task.id);
    }

    deleteProject(db, id);
    return { ok: true };
  });

  // ── Agents ────────────────────────────────────────────────────────────────

  app.post("/agents", async (request, reply) => {
    const body = request.body as Partial<HireAgentInput>;
    const validJobTypes = ["prioritizer", "planner", "implementer", "reviewer", "merger"];

    if (!body.jobType || !validJobTypes.includes(body.jobType)) {
      return reply.code(400).send({
        error: `expected { jobType: one of ${validJobTypes.join(", ")} }`,
      });
    }

    const agent = hireAgent(db, { jobType: body.jobType, model: body.model });
    broadcast("global", { type: "agent:update", agentId: agent.id, station: null, taskId: null });
    return reply.code(201).send(agent);
  });

  app.get("/agents", async () => listAgents(db));

  app.get("/agents/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const agent = getAgent(db, id);
    if (!agent) return reply.code(404).send({ error: "agent not found" });
    return agent;
  });

  app.delete("/agents/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const fired = fireAgent(db, id);
    if (!fired) return reply.code(404).send({ error: "agent not found or already fired" });
    return { ok: true };
  });

  // ── Squads ────────────────────────────────────────────────────────────────

  app.post("/squads", async (request, reply) => {
    const body = request.body as { name?: string; projectIds?: string[]; agentIds?: string[] };
    if (!body.name) return reply.code(400).send({ error: "expected { name: string }" });

    const squad = createSquad(db, {
      name: body.name,
      projectIds: body.projectIds,
      agentIds: body.agentIds,
    });
    return reply.code(201).send(squad);
  });

  app.get("/squads", async () => listSquads(db));

  app.get("/squads/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const squad = getSquad(db, id);
    if (!squad) return reply.code(404).send({ error: "squad not found" });
    return squad;
  });

  app.put("/squads/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { name?: string; projectIds?: string[] };

    const updated = updateSquad(db, id, body);
    if (!updated) return reply.code(404).send({ error: "squad not found" });
    return updated;
  });

  app.delete("/squads/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const deleted = deleteSquad(db, id);
    if (!deleted) return reply.code(404).send({ error: "squad not found" });
    return { ok: true };
  });

  app.post("/squads/:id/agents", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { agentId?: string };
    if (!body.agentId) return reply.code(400).send({ error: "expected { agentId: string }" });

    const squad = getSquad(db, id);
    if (!squad) return reply.code(404).send({ error: "squad not found" });

    const agent = getAgent(db, body.agentId);
    if (!agent) return reply.code(404).send({ error: "agent not found" });

    addAgentToSquad(db, id, body.agentId);
    return { ok: true };
  });

  app.delete("/squads/:id/agents/:agentId", async (request, reply) => {
    const { id, agentId } = request.params as { id: string; agentId: string };

    const squad = getSquad(db, id);
    if (!squad) return reply.code(404).send({ error: "squad not found" });

    removeAgentFromSquad(db, id, agentId);
    return { ok: true };
  });

  // ── Tasks ─────────────────────────────────────────────────────────────────

  app.post("/tasks", async (request, reply) => {
    const body = request.body as Partial<CreateTaskInput> & { requiresHumanReview?: boolean };

    if (!body.projectId || !body.title || !body.description) {
      return reply.code(400).send({
        error: "expected { projectId, title, description }",
      });
    }

    const project = getProject(db, body.projectId);
    if (!project) return reply.code(404).send({ error: "project not found" });

    if (body.priority !== undefined) {
      const p = Number(body.priority);
      if (!Number.isInteger(p) || p < 1 || p > 5) {
        return reply.code(400).send({ error: "priority must be integer 1-5" });
      }
    }

    const task = createTask(db, {
      projectId: body.projectId,
      title: body.title,
      description: body.description,
      priority: body.priority,
      requiresHumanReview: body.requiresHumanReview,
      source: body.source,
      githubIssueNumber: body.githubIssueNumber,
    });

    return reply.code(201).send(task);
  });

  app.get("/tasks", async (request) => {
    const query = request.query as { stage?: string; status?: string; projectId?: string };
    return listTasks(db, query);
  });

  app.get("/tasks/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const task = getTask(db, id);
    if (!task) return reply.code(404).send({ error: "task not found" });
    return task;
  });

  app.get("/tasks/:id/stages", async (request, reply) => {
    const { id } = request.params as { id: string };
    const task = getTask(db, id);
    if (!task) return reply.code(404).send({ error: "task not found" });
    return listTaskStages(db, id);
  });

  app.get("/tasks/:id/transcript", async (request, reply) => {
    const { id } = request.params as { id: string };
    const task = getTask(db, id);
    if (!task) return reply.code(404).send({ error: "task not found" });
    return listTranscriptEntries(db, id);
  });

  app.post("/tasks/:id/approve", async (request, reply) => {
    const { id } = request.params as { id: string };
    const task = getTask(db, id);
    if (!task) return reply.code(404).send({ error: "task not found" });
    if (task.status !== "awaiting_approval") {
      return reply.code(409).send({ error: "task is not awaiting approval" });
    }

    const updated = approveTaskStage(db, id);
    broadcast(`task:${id}`, { type: "status", status: "queued", stage: updated!.stage });
    return updated;
  });

  app.post("/tasks/:id/retry", async (request, reply) => {
    const { id } = request.params as { id: string };
    const task = getTask(db, id);
    if (!task) return reply.code(404).send({ error: "task not found" });
    if (task.status !== "stuck") {
      return reply.code(409).send({ error: "task is not stuck" });
    }

    const updated = retryStuckTask(db, id);
    broadcast(`task:${id}`, { type: "status", status: "queued", stage: updated!.stage });
    return updated;
  });

  app.delete("/tasks/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const task = getTask(db, id);
    if (!task) return reply.code(404).send({ error: "task not found" });

    if (task.worktreePath) {
      const project = getProject(db, task.projectId);
      if (project) {
        try {
          removeWorktree(project, task.id);
        } catch {
          // worktree may already be gone
        }
      }
    }

    deleteTask(db, id);
    return { ok: true };
  });

  app.delete("/tasks/:id/worktree", async (request, reply) => {
    const { id } = request.params as { id: string };
    const task = getTask(db, id);
    if (!task) return reply.code(404).send({ error: "task not found" });

    const terminalStatuses: string[] = ["done", "error", "stuck"];
    if (!terminalStatuses.includes(task.status)) {
      return reply.code(409).send({ error: "task is still active" });
    }
    if (!task.worktreePath) {
      return reply.code(409).send({ error: "task has no worktree" });
    }

    const project = getProject(db, task.projectId);
    if (!project) return reply.code(404).send({ error: "project not found" });

    try {
      removeWorktree(project, task.id);
    } catch (err) {
      if (err instanceof WorktreeError) {
        return reply.code(500).send({ error: err.message });
      }
      throw err;
    }

    db.prepare(`UPDATE tasks SET worktreePath = NULL, branch = NULL, updatedAt = ? WHERE id = ?`).run(
      new Date().toISOString(),
      id
    );
    return getTask(db, id);
  });

  // ── User profile ──────────────────────────────────────────────────────────

  app.get("/profile", async () => {
    return db.prepare(`SELECT * FROM user_profile WHERE id = 1`).get();
  });

  // ── Settings ──────────────────────────────────────────────────────────────

  app.get("/settings", async () => {
    const rows = db.prepare(`SELECT key, value FROM settings WHERE key != 'schemaVersion'`).all() as {
      key: string;
      value: string;
    }[];
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  });

  app.post("/settings", async (request, reply) => {
    const body = request.body as Record<string, string>;
    if (!body || typeof body !== "object") {
      return reply.code(400).send({ error: "expected object of key-value settings" });
    }

    for (const [key, value] of Object.entries(body)) {
      db.prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      ).run(key, String(value));
    }

    return { ok: true };
  });

  return app;
}
