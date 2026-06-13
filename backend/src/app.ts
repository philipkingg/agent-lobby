import Fastify from "fastify";
import type { DatabaseSync } from "node:sqlite";
import { createDb } from "./db.js";
import { createProject, listProjects, getProject, InvalidProjectPathError } from "./projects.js";
import { createTask, listTasks, getTask, type TaskMode } from "./tasks.js";
import { WorktreeError } from "./worktrees.js";

export function buildApp(db: DatabaseSync = createDb()) {
  const app = Fastify();

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

  return app;
}
