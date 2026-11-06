import { Hono } from "hono";
import { z } from "zod";
import { getSettings, updateSettings } from "../lib/store";

const settingsSchema = z
  .object({
    activePresetId: z.string().nullable(),
    activeConnectionId: z.string().nullable(),
    activePersonaId: z.string().nullable(),
  })
  .partial();

export const settingsRoutes = new Hono()
  .get("/", async (c) => c.json(await getSettings()))
  .patch("/", async (c) => c.json(await updateSettings(settingsSchema.parse(await c.req.json()))));
