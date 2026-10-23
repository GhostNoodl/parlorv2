import { serve } from "@hono/node-server";
import { app } from "./app";
import { initDb } from "./db/client";
import { seed } from "./seed";

await initDb();
await seed();

const port = Number(process.env.PORT ?? 3700);
const hostname = process.env.HOST ?? "127.0.0.1";
serve({ fetch: app.fetch, port, hostname }, () => {
  console.log(`🍝 Parlor server listening on http://${hostname}:${port}`);
});
