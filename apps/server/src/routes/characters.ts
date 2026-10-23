import { emptyCard } from "@parlor/shared";
import { asc, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/client";
import * as t from "../db/schema";
import { createChat, getCharacter, id } from "../lib/store";

const cardSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string(),
    personality: z.string(),
    scenario: z.string(),
    first_mes: z.string(),
    mes_example: z.string(),
    alternate_greetings: z.array(z.string()),
    system_prompt: z.string(),
    post_history_instructions: z.string(),
    creator_notes: z.string(),
    creator: z.string(),
    character_version: z.string(),
    tags: z.array(z.string()),
    extensions: z.record(z.string(), z.unknown()),
  })
  .partial();

export const characterRoutes = new Hono()
  .get("/", async (c) => {
    const rows = await db.select().from(t.characters).orderBy(asc(t.characters.name));
    return c.json(rows);
  })

  .post("/", async (c) => {
    const card = { ...emptyCard(), ...cardSchema.parse(await c.req.json()) };
    if (!card.name) return c.json({ error: "A character needs a name" }, 400);
    const row = { id: id(), name: card.name, avatar: null, card, createdAt: Date.now(), updatedAt: Date.now() };
    await db.insert(t.characters).values(row);
    return c.json(row, 201);
  })

  .get("/:id", async (c) => {
    const character = await getCharacter(c.req.param("id"));
    return character ? c.json(character) : c.json({ error: "Character not found" }, 404);
  })

  .patch("/:id", async (c) => {
    const character = await getCharacter(c.req.param("id"));
    if (!character) return c.json({ error: "Character not found" }, 404);
    const card = { ...character.card, ...cardSchema.parse(await c.req.json()) };
    const patch = { name: card.name, card, updatedAt: Date.now() };
    await db.update(t.characters).set(patch).where(eq(t.characters.id, character.id));
    return c.json({ ...character, ...patch });
  })

  .delete("/:id", async (c) => {
    const characterId = c.req.param("id");
    const chats = await db.select({ id: t.chats.id }).from(t.chats).where(eq(t.chats.characterId, characterId));
    for (const chat of chats) await db.delete(t.messages).where(eq(t.messages.chatId, chat.id));
    await db.delete(t.chats).where(eq(t.chats.characterId, characterId));
    await db.delete(t.characters).where(eq(t.characters.id, characterId));
    return c.body(null, 204);
  })

  .get("/:id/chats", async (c) => {
    const rows = await db
      .select()
      .from(t.chats)
      .where(eq(t.chats.characterId, c.req.param("id")))
      .orderBy(desc(t.chats.updatedAt));
    return c.json(rows);
  })

  .post("/:id/chats", async (c) => {
    const character = await getCharacter(c.req.param("id"));
    if (!character) return c.json({ error: "Character not found" }, 404);
    return c.json(await createChat(character), 201);
  });
