import { mkdirSync } from "node:fs";
import path from "node:path";
import { buildApp } from "./app.js";
import { createDb } from "./db.js";

const dataDir = path.resolve("data");
mkdirSync(dataDir, { recursive: true });

const db = createDb(path.join(dataDir, "agent-office.db"));
const app = buildApp(db, { autoStartScheduler: true });

app.listen({ port: 3001 }, (err, address) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  console.log(`Agent Office backend listening at ${address}`);
});
