import { DEFAULT_GENERATION_SETTINGS } from "@parlor/shared";
import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/client";
import * as t from "../db/schema";
import { getConnectionRow, getSettings, id, resolveConnection, toConnection, updateSettings } from "../lib/store";
import { encrypt } from "../lib/secrets";
import { ProviderError, providers, type ResolvedConnection } from "../providers";

const settingsSchema = z.object({
  maxTokens: z.number().int().min(16).max(128000),
  contextSize: z.number().int().min(512).max(2_000_000),
  temperature: z.number().min(0).max(2),
  topP: z.number().min(0).max(1),
  effort: z.enum(["low", "medium", "high", "xhigh", "max"]),
});

const connectionSchema = z.object({
  name: z.string().trim().min(1).max(100),
  provider: z.enum(["openai", "anthropic"]),
  baseUrl: z.string().trim().max(500),
  model: z.string().trim().max(200).default(""),
  /** undefined keeps the stored key, "" clears it. */
  apiKey: z.string().optional(),
  settings: settingsSchema.partial().optional(),
});

export const connectionRoutes = new Hono()
  .get("/", async (c) => {
    const rows = await db.select().from(t.connections).orderBy(desc(t.connections.createdAt));
    return c.json(rows.map(toConnection));
  })

  .post("/", async (c) => {
    const body = connectionSchema.parse(await c.req.json());
    const row = {
      id: id(),
      name: body.name,
      provider: body.provider,
      baseUrl: body.baseUrl,
      model: body.model,
      apiKey: body.apiKey ? encrypt(body.apiKey) : null,
      settings: { ...DEFAULT_GENERATION_SETTINGS, ...(body.provider === "anthropic" ? { maxTokens: 8192 } : {}), ...body.settings },
      createdAt: Date.now(),
    };
    await db.insert(t.connections).values(row);
    // The first connection becomes the active one.
    const settings = await getSettings();
    if (!settings.activeConnectionId) await updateSettings({ activeConnectionId: row.id });
    return c.json(toConnection(row), 201);
  })

  .patch("/:id", async (c) => {
    const existing = await getConnectionRow(c.req.param("id"));
    if (!existing) return c.json({ error: "Connection not found" }, 404);
    const body = connectionSchema.partial().parse(await c.req.json());
    const { apiKey, settings, ...rest } = body;
    const patch = {
      ...rest,
      ...(apiKey !== undefined ? { apiKey: apiKey ? encrypt(apiKey) : null } : {}),
      ...(settings ? { settings: { ...existing.settings, ...settings } } : {}),
    };
    await db.update(t.connections).set(patch).where(eq(t.connections.id, existing.id));
    return c.json(toConnection({ ...existing, ...patch }));
  })

  .delete("/:id", async (c) => {
    const connectionId = c.req.param("id");
    await db.delete(t.connections).where(eq(t.connections.id, connectionId));
    const settings = await getSettings();
    if (settings.activeConnectionId === connectionId) {
      const next = await db.query.connections.findFirst({ orderBy: desc(t.connections.createdAt) });
      await updateSettings({ activeConnectionId: next?.id ?? null });
    }
    return c.body(null, 204);
  })

  // Lists models, which doubles as a connection test.
  .get("/:id/models", async (c) => {
    const row = await getConnectionRow(c.req.param("id"));
    if (!row) return c.json({ error: "Connection not found" }, 404);
    return c.json(await probe(resolveConnection(row)));
  })

  // Same, for a connection that is still being filled in. Falls back to the
  // stored key when editing an existing connection without retyping it.
  .post("/probe", async (c) => {
    const body = probeSchema.parse(await c.req.json());
    const stored = body.connectionId ? await getConnectionRow(body.connectionId) : undefined;
    const apiKey = body.apiKey || (stored ? resolveConnection(stored).apiKey : null);
    return c.json(
      await probe({ provider: body.provider, baseUrl: body.baseUrl, apiKey, model: "", settings: DEFAULT_GENERATION_SETTINGS }),
    );
  });

const probeSchema = z.object({
  provider: z.enum(["openai", "anthropic"]),
  baseUrl: z.string().trim(),
  apiKey: z.string().optional(),
  connectionId: z.string().optional(),
});

async function probe(connection: ResolvedConnection) {
  try {
    const models = await providers[connection.provider].listModels(connection);
    return { ok: true, models };
  } catch (err) {
    const message = err instanceof ProviderError ? err.message : `Could not reach ${connection.baseUrl}: ${(err as Error).message}`;
    return { ok: false, error: message, models: [] as string[] };
  }
}
