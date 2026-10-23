import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync } from "node:fs";
import { relative } from "node:path";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { ZodError } from "zod";
import { webDistDir } from "./lib/paths";
import { characterRoutes } from "./routes/characters";
import { chatRoutes, messageRoutes } from "./routes/chats";
import { connectionRoutes } from "./routes/connections";
import { settingsRoutes } from "./routes/settings";

export const app = new Hono();
if (process.env.NODE_ENV !== "test") app.use("/api/*", logger());

app.onError((err, c) => {
  if (err instanceof ZodError) {
    return c.json({ error: err.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") }, 400);
  }
  console.error(err);
  return c.json({ error: err.message || "Internal error" }, 500);
});

app.get("/api/health", (c) => c.json({ ok: true }));
app.route("/api/settings", settingsRoutes);
app.route("/api/connections", connectionRoutes);
app.route("/api/characters", characterRoutes);
app.route("/api/chats", chatRoutes);
app.route("/api/messages", messageRoutes);
app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

// In production the server also hosts the built web app.
if (process.env.NODE_ENV === "production" && existsSync(webDistDir)) {
  const root = relative(process.cwd(), webDistDir);
  app.use("/*", serveStatic({ root }));
  app.get("*", serveStatic({ root, path: "index.html" }));
}
