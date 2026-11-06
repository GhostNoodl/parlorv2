import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_PERSONA_NAME,
  DEFAULT_SYSTEM_PROMPT,
  defaultPromptBlocks,
  type AppSettings,
  type Character,
  type Chat,
  type Connection,
  type Message,
  type Persona,
  type PromptPreset,
} from "@parlor/shared";
import { asc, eq } from "drizzle-orm";
import { db } from "../db/client";
import * as t from "../db/schema";
import type { ResolvedConnection } from "../providers";
import { decrypt } from "./secrets";

export function id(): string {
  return crypto.randomUUID();
}

// ---- settings ----

export async function getSettings(): Promise<AppSettings> {
  const rows = await db.select().from(t.settings);
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return { ...DEFAULT_APP_SETTINGS, ...stored } as AppSettings;
}

export async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (value === null) {
      // Unset means "use the default", which a missing row already says.
      await db.delete(t.settings).where(eq(t.settings.key, key));
      continue;
    }
    await db
      .insert(t.settings)
      .values({ key, value })
      .onConflictDoUpdate({ target: t.settings.key, set: { value } });
  }
  return getSettings();
}

// ---- personas ----

/** The persona the user is currently playing as, creating a default one if needed. */
export async function getActivePersona(): Promise<Persona> {
  const settings = await getSettings();
  if (settings.activePersonaId) {
    const active = await db.query.personas.findFirst({ where: eq(t.personas.id, settings.activePersonaId) });
    if (active) return active;
  }
  const first = await db.query.personas.findFirst({ orderBy: asc(t.personas.createdAt) });
  if (first) {
    await updateSettings({ activePersonaId: first.id });
    return first;
  }
  const persona = { id: id(), name: DEFAULT_PERSONA_NAME, description: "", avatar: null, createdAt: Date.now() };
  await db.insert(t.personas).values(persona);
  await updateSettings({ activePersonaId: persona.id });
  return persona;
}

// ---- prompt presets ----

/** The preset used for generation, creating the default one if needed. */
export async function getActivePreset(): Promise<PromptPreset> {
  const settings = await getSettings();
  if (settings.activePresetId) {
    const active = await db.query.presets.findFirst({ where: eq(t.presets.id, settings.activePresetId) });
    if (active) return active;
  }
  const first = await db.query.presets.findFirst({ orderBy: asc(t.presets.createdAt) });
  if (first) {
    await updateSettings({ activePresetId: first.id });
    return first;
  }
  // Before presets existed there was a single editable system prompt; keep it.
  const legacy = await db.query.settings.findFirst({ where: eq(t.settings.key, "systemPrompt") });
  const mainPrompt = typeof legacy?.value === "string" ? legacy.value : DEFAULT_SYSTEM_PROMPT;
  const preset = { id: id(), name: "Parlor default", blocks: defaultPromptBlocks(mainPrompt), createdAt: Date.now(), updatedAt: Date.now() };
  await db.insert(t.presets).values(preset);
  await updateSettings({ activePresetId: preset.id });
  if (legacy) await db.delete(t.settings).where(eq(t.settings.key, "systemPrompt"));
  return preset;
}

// ---- connections ----

type ConnectionRow = typeof t.connections.$inferSelect;

export function toConnection(row: ConnectionRow): Connection {
  const { apiKey, ...rest } = row;
  return { ...rest, hasApiKey: Boolean(apiKey) };
}

export function resolveConnection(row: ConnectionRow): ResolvedConnection {
  return {
    provider: row.provider,
    baseUrl: row.baseUrl,
    model: row.model,
    apiKey: row.apiKey ? decrypt(row.apiKey) : null,
    settings: row.settings,
  };
}

export async function getConnectionRow(connectionId: string) {
  return db.query.connections.findFirst({ where: eq(t.connections.id, connectionId) });
}

// ---- characters, chats, messages ----

export async function getCharacter(characterId: string): Promise<Character | undefined> {
  return db.query.characters.findFirst({ where: eq(t.characters.id, characterId) });
}

export async function getChat(chatId: string): Promise<Chat | undefined> {
  return db.query.chats.findFirst({ where: eq(t.chats.id, chatId) });
}

export async function getMessages(chatId: string): Promise<Message[]> {
  return db.select().from(t.messages).where(eq(t.messages.chatId, chatId)).orderBy(asc(t.messages.id));
}

export async function touchChat(chatId: string) {
  await db.update(t.chats).set({ updatedAt: Date.now() }).where(eq(t.chats.id, chatId));
}

/** Starts a chat with the character's greeting (and alternates as swipes). */
export async function createChat(character: Character, title?: string): Promise<Chat> {
  const chat = {
    id: id(),
    characterId: character.id,
    title: title ?? `Chat ${new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await db.insert(t.chats).values(chat);
  const greetings = [character.card.first_mes, ...character.card.alternate_greetings].filter((g) => g.trim());
  if (greetings.length) {
    await db.insert(t.messages).values({ chatId: chat.id, role: "assistant", swipes: greetings, swipeId: 0 });
  }
  return chat;
}
