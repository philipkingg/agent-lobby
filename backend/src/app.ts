import Fastify from "fastify";
import type { DatabaseSync } from "node:sqlite";
import { createDb } from "./db.js";
import { createProject, listProjects, InvalidProjectPathError } from "./projects.js";

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

  return app;
}
