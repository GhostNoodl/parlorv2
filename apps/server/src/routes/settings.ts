import { Hono } from "hono";
import { z } from "zod";
import { getSettings, updateSettings } from "../lib/store";

const settingsSchema = z
  .object({
    userName: z.string().trim().min(1).max(100),
    userDescription: z.string().max(20_000),
    systemPrompt: z.string().max(50_000),
    activeConnectionId: z.string().nullable(),
  })
  .partial();

export const settingsRoutes = new Hono()
  .get("/", async (c) => c.json(await getSettings()))
  .patch("/", async (c) => c.json(await updateSettings(settingsSchema.parse(await c.req.json()))));
