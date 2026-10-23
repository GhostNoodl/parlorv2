import { CardError, embedCardInPng, emptyCard, extractCardFromPng, isPng, parseCardJson, toV3Json, type Character, type CharacterCard } from "@parlor/shared";
import { asc, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/client";
import * as t from "../db/schema";
import { deleteAvatar, placeholderPng, readAvatar, saveAvatar } from "../lib/avatars";
import { createChat, getCharacter, id } from "../lib/store";
import { avatarHandlers } from "./avatar-routes";

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
    character_book: z.unknown(),
    nickname: z.string(),
    group_only_greetings: z.array(z.string()),
    source: z.array(z.string()),
    creation_date: z.number(),
    modification_date: z.number(),
  })
  .partial();

const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
const avatar = avatarHandlers("characters");

async function insertCharacter(card: CharacterCard, avatarPng?: Uint8Array): Promise<Character> {
  const row: Character = { id: id(), name: card.name, avatar: null, card, createdAt: Date.now(), updatedAt: Date.now() };
  if (avatarPng) row.avatar = saveAvatar("characters", row.id, avatarPng);
  await db.insert(t.characters).values(row);
  return row;
}

/** Turns an uploaded file into a character: a card PNG or a card JSON. */
async function importFile(file: File): Promise<Character> {
  if (file.size > MAX_IMPORT_BYTES) throw new CardError("File is too big (20 MB max).");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (isPng(bytes)) {
    const card = extractCardFromPng(bytes);
    if (!card) throw new CardError("This PNG has no character card data in it.");
    return insertCharacter(card, bytes);
  }
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new CardError("Not a card PNG or JSON file.");
  }
  return insertCharacter(parseCardJson(json));
}

function safeFilename(name: string): string {
  return name.replace(/[^\p{L}\p{N} _.-]/gu, "").trim().slice(0, 80) || "character";
}

export const characterRoutes = new Hono()
  .get("/", async (c) => {
    const rows = await db.select().from(t.characters).orderBy(asc(t.characters.name));
    return c.json(rows);
  })

  .post("/", async (c) => {
    const card = { ...emptyCard(), ...cardSchema.parse(await c.req.json()) };
    if (!card.name) return c.json({ error: "A character needs a name" }, 400);
    return c.json(await insertCharacter(card), 201);
  })

  // Multipart upload with one or more `file` fields (card PNGs or JSON).
  .post("/import", async (c) => {
    const body = await c.req.parseBody({ all: true });
    const files = [body.file].flat().filter((f): f is File => f instanceof File);
    if (!files.length) return c.json({ error: "Attach at least one card file as `file`." }, 400);
    const imported: Character[] = [];
    const errors: { file: string; error: string }[] = [];
    for (const file of files) {
      try {
        imported.push(await importFile(file));
      } catch (err) {
        if (!(err instanceof CardError)) console.error("[import]", err);
        errors.push({ file: file.name, error: err instanceof CardError ? err.message : "Couldn't import this file." });
      }
    }
    return c.json({ imported, errors }, imported.length ? 201 : 400);
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
    deleteAvatar("characters", characterId);
    return c.body(null, 204);
  })

  .post("/:id/duplicate", async (c) => {
    const character = await getCharacter(c.req.param("id"));
    if (!character) return c.json({ error: "Character not found" }, 404);
    const avatarPng = readAvatar("characters", character.id);
    const copy = await insertCharacter({ ...character.card, name: `${character.card.name} (copy)` }, avatarPng ?? undefined);
    return c.json(copy, 201);
  })

  // ?format=png (default) writes a V2+V3 card PNG; ?format=json writes V3 JSON.
  .get("/:id/export", async (c) => {
    const character = await getCharacter(c.req.param("id"));
    if (!character) return c.json({ error: "Character not found" }, 404);
    const name = safeFilename(character.name);
    const disposition = (ext: string) => `attachment; filename*=UTF-8''${encodeURIComponent(`${name}.${ext}`)}`;
    if (c.req.query("format") === "json") {
      return c.body(JSON.stringify(toV3Json(character.card), null, 2), 200, {
        "Content-Type": "application/json",
        "Content-Disposition": disposition("json"),
      });
    }
    const base = readAvatar("characters", character.id) ?? placeholderPng(character.name);
    return c.body(new Uint8Array(embedCardInPng(new Uint8Array(base), character.card)), 200, {
      "Content-Type": "image/png",
      "Content-Disposition": disposition("png"),
    });
  })

  .get("/:id/avatar", avatar.get)
  .put("/:id/avatar", avatar.put)
  .delete("/:id/avatar", avatar.delete)

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
