import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/client";
import * as t from "../db/schema";
import { deleteAvatar } from "../lib/avatars";
import { getActivePersona, getSettings, id, updateSettings } from "../lib/store";
import { avatarHandlers } from "./avatar-routes";

const personaSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().max(20_000).default(""),
});

const avatar = avatarHandlers("personas");

export const personaRoutes = new Hono()
  .get("/", async (c) => {
    await getActivePersona(); // makes sure at least one exists
    return c.json(await db.select().from(t.personas).orderBy(asc(t.personas.createdAt)));
  })

  .post("/", async (c) => {
    const body = personaSchema.parse(await c.req.json());
    const row = { id: id(), ...body, avatar: null, createdAt: Date.now() };
    await db.insert(t.personas).values(row);
    return c.json(row, 201);
  })

  .patch("/:id", async (c) => {
    const persona = await db.query.personas.findFirst({ where: eq(t.personas.id, c.req.param("id")) });
    if (!persona) return c.json({ error: "Persona not found" }, 404);
    const patch = personaSchema.partial().parse(await c.req.json());
    await db.update(t.personas).set(patch).where(eq(t.personas.id, persona.id));
    return c.json({ ...persona, ...patch });
  })

  .delete("/:id", async (c) => {
    const personaId = c.req.param("id");
    const all = await db.select({ id: t.personas.id }).from(t.personas);
    if (all.length <= 1) return c.json({ error: "Keep at least one persona." }, 400);
    await db.delete(t.personas).where(eq(t.personas.id, personaId));
    deleteAvatar("personas", personaId);
    const settings = await getSettings();
    if (settings.activePersonaId === personaId) await updateSettings({ activePersonaId: null });
    await getActivePersona();
    return c.body(null, 204);
  })

  .get("/:id/avatar", avatar.get)
  .put("/:id/avatar", avatar.put)
  .delete("/:id/avatar", avatar.delete);
