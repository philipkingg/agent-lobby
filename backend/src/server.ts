import { buildApp } from "./app.js";

const app = buildApp();

app.listen({ port: 3001 }, (err, address) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  console.log(`Agent Office backend listening at ${address}`);
});
