import type { CharacterCard, GenerationSettings, MessageRole, ProviderKind } from "@parlor/shared";
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

const now = sql`(unixepoch('subsec') * 1000)`;

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).notNull(),
});

export const connections = sqliteTable("connections", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  provider: text("provider").$type<ProviderKind>().notNull(),
  baseUrl: text("base_url").notNull(),
  model: text("model").notNull().default(""),
  /** AES-256-GCM encrypted, see lib/secrets.ts. */
  apiKey: text("api_key"),
  settings: text("settings", { mode: "json" }).$type<GenerationSettings>().notNull(),
  createdAt: integer("created_at").notNull().default(now),
});

export const characters = sqliteTable("characters", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  avatar: text("avatar"),
  card: text("card", { mode: "json" }).$type<CharacterCard>().notNull(),
  createdAt: integer("created_at").notNull().default(now),
  updatedAt: integer("updated_at").notNull().default(now),
});

export const chats = sqliteTable(
  "chats",
  {
    id: text("id").primaryKey(),
    characterId: text("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => [index("chats_character_idx").on(t.characterId)],
);

export const messages = sqliteTable(
  "messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    role: text("role").$type<MessageRole>().notNull(),
    swipes: text("swipes", { mode: "json" }).$type<string[]>().notNull(),
    swipeId: integer("swipe_id").notNull().default(0),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [index("messages_chat_idx").on(t.chatId, t.id)],
);
