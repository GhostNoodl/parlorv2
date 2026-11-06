import type { SearchResult } from "@parlor/shared";
import { and, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/client";
import * as t from "../db/schema";

const querySchema = z.object({
  q: z.string().trim().min(1).max(200),
  chatId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(40),
});

/** Escapes LIKE wildcards so "100%" means a literal percent sign. */
const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;

/** A short excerpt around the first match, trimmed to word boundaries. */
export function snippet(text: string, query: string, radius = 70): string {
  const flat = text.replace(/\*/g, "").replace(/\s+/g, " ");
  const at = flat.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0) return flat.slice(0, radius * 2);
  let start = Math.max(0, at - radius);
  let end = Math.min(flat.length, at + query.length + radius);
  if (start > 0) start = flat.indexOf(" ", start) + 1 || start;
  if (end < flat.length) end = flat.lastIndexOf(" ", end) > at + query.length ? flat.lastIndexOf(" ", end) : end;
  return `${start > 0 ? "…" : ""}${flat.slice(start, end).trim()}${end < flat.length ? "…" : ""}`;
}

export const searchRoutes = new Hono().get("/", async (c) => {
  const { q, chatId, limit } = querySchema.parse(c.req.query());
  const pattern = likePattern(q);
  // Search every swipe, not just the visible one: that line you remember may be on a reroll.
  const matches = sql`exists (select 1 from json_each(${t.messages.swipes}) where json_each.value like ${pattern} escape '\\')`;
  const rows = await db
    .select({
      messageId: t.messages.id,
      role: t.messages.role,
      swipes: t.messages.swipes,
      swipeId: t.messages.swipeId,
      createdAt: t.messages.createdAt,
      chatId: t.chats.id,
      chatTitle: t.chats.title,
      characterId: t.characters.id,
      characterName: t.characters.name,
      characterAvatar: t.characters.avatar,
    })
    .from(t.messages)
    .innerJoin(t.chats, eq(t.messages.chatId, t.chats.id))
    .innerJoin(t.characters, eq(t.chats.characterId, t.characters.id))
    .where(chatId ? and(matches, eq(t.messages.chatId, chatId)) : matches)
    .orderBy(desc(t.messages.id))
    .limit(limit);

  const needle = q.toLowerCase();
  const results: SearchResult[] = rows.map(({ swipes, swipeId, ...row }) => {
    const active = swipes[swipeId] ?? "";
    const hitSwipe = active.toLowerCase().includes(needle) ? swipeId : swipes.findIndex((s) => s.toLowerCase().includes(needle));
    return { ...row, swipeId: Math.max(hitSwipe, 0), snippet: snippet(swipes[Math.max(hitSwipe, 0)] ?? "", q) };
  });
  return c.json(results);
});
