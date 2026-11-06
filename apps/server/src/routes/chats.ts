import { buildPrompt, DEFAULT_GENERATION_SETTINGS, type Character, type GenerateEvent, type GenerateMode, type Message, type PromptMessage } from "@parlor/shared";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { db } from "../db/client";
import * as t from "../db/schema";
import {
  getActivePersona,
  getActivePreset,
  getCharacter,
  getChat,
  getConnectionRow,
  getMessages,
  getSettings,
  resolveConnection,
  touchChat,
} from "../lib/store";
import { ProviderError, providers } from "../providers";

const generateSchema = z.object({
  mode: z.enum(["send", "regenerate", "continue"]),
  text: z.string().optional(),
});

const CONTINUE_INSTRUCTION = "[Continue your last message from exactly where it stopped. Do not repeat what was already written.]";

const activeText = (m: Message) => m.swipes[m.swipeId] ?? "";

/** Local models often prefix replies with "Name:"; strip it. */
function cleanReply(text: string, name: string): string {
  const trimmed = text.replace(/^\s+/, "");
  const prefix = `${name}:`;
  return trimmed.startsWith(prefix) ? trimmed.slice(prefix.length).replace(/^\s+/, "") : trimmed;
}

/** Works out what a generation acts on and which history the model sees. */
function planGeneration(all: Message[], mode: GenerateMode) {
  const last = all.at(-1);
  // Regenerate and continue both work on the last reply; without one they act like send.
  const target = (mode === "regenerate" || mode === "continue") && last?.role === "assistant" ? last : null;
  const effectiveMode: GenerateMode = target ? mode : "send";
  const history: PromptMessage[] = (effectiveMode === "regenerate" ? all.slice(0, -1) : all).map((m) => ({
    role: m.role,
    content: activeText(m),
  }));
  if (effectiveMode === "continue") history.push({ role: "user", content: CONTINUE_INSTRUCTION });
  return { target, effectiveMode, history };
}

async function promptFor(character: Character, history: PromptMessage[], limits: { contextSize: number; maxTokens: number }) {
  const [persona, preset] = await Promise.all([getActivePersona(), getActivePreset()]);
  const prompt = buildPrompt({
    card: character.card,
    userName: persona.name,
    userDescription: persona.description,
    blocks: preset.blocks,
    history,
    contextSize: limits.contextSize,
    maxTokens: limits.maxTokens,
  });
  return { prompt, preset };
}

export const chatRoutes = new Hono()
  .get("/:id", async (c) => {
    const chat = await getChat(c.req.param("id"));
    if (!chat) return c.json({ error: "Chat not found" }, 404);
    const [character, messages] = await Promise.all([getCharacter(chat.characterId), getMessages(chat.id)]);
    return c.json({ chat, character, messages });
  })

  /** The prompt inspector: exactly what the model would see for the next reply. */
  .get("/:id/prompt", async (c) => {
    const chat = await getChat(c.req.param("id"));
    if (!chat) return c.json({ error: "Chat not found" }, 404);
    const character = await getCharacter(chat.characterId);
    if (!character) return c.json({ error: "Character not found" }, 404);
    const mode = z.enum(["send", "regenerate", "continue"]).catch("send").parse(c.req.query("mode"));

    const settings = await getSettings();
    const row = settings.activeConnectionId ? await getConnectionRow(settings.activeConnectionId) : undefined;
    const limits = row?.settings ?? DEFAULT_GENERATION_SETTINGS;
    const { effectiveMode, history } = planGeneration(await getMessages(chat.id), mode);
    const { prompt, preset } = await promptFor(character, history, limits);
    return c.json({
      mode: effectiveMode,
      prompt,
      preset: { id: preset.id, name: preset.name },
      connection: row ? { name: row.name, model: row.model, provider: row.provider } : null,
      contextSize: limits.contextSize,
      maxTokens: limits.maxTokens,
    });
  })

  .patch("/:id", async (c) => {
    const { title } = z.object({ title: z.string().trim().min(1).max(200) }).parse(await c.req.json());
    await db.update(t.chats).set({ title }).where(eq(t.chats.id, c.req.param("id")));
    return c.json({ ok: true });
  })

  .delete("/:id", async (c) => {
    const chatId = c.req.param("id");
    await db.delete(t.messages).where(eq(t.messages.chatId, chatId));
    await db.delete(t.chats).where(eq(t.chats.id, chatId));
    return c.body(null, 204);
  })

  .post("/:id/generate", async (c) => {
    const { mode, text } = generateSchema.parse(await c.req.json());
    const chat = await getChat(c.req.param("id"));
    if (!chat) return c.json({ error: "Chat not found" }, 404);
    const character = await getCharacter(chat.characterId);
    if (!character) return c.json({ error: "Character not found" }, 404);

    const settings = await getSettings();
    const connectionRow = settings.activeConnectionId ? await getConnectionRow(settings.activeConnectionId) : undefined;
    if (!connectionRow) return c.json({ error: "Set up a model connection in Settings first." }, 400);
    if (!connectionRow.model) return c.json({ error: `Pick a model for "${connectionRow.name}" in Settings.` }, 400);
    const connection = resolveConnection(connectionRow);

    if (mode === "send" && text?.trim()) {
      await db.insert(t.messages).values({ chatId: chat.id, role: "user", swipes: [text.trim()], swipeId: 0 });
    }

    const { target, effectiveMode, history } = planGeneration(await getMessages(chat.id), mode);
    const { prompt } = await promptFor(character, history, connection.settings);

    return streamSSE(c, async (stream) => {
      const abort = new AbortController();
      stream.onAbort(() => abort.abort());
      const send = (event: GenerateEvent) => stream.writeSSE({ data: JSON.stringify(event) });

      await send({ type: "start", messageId: target?.id ?? null });
      let output = "";
      let error: string | null = null;
      try {
        for await (const chunk of providers[connection.provider].stream({
          connection,
          system: prompt.system,
          messages: prompt.messages,
          signal: abort.signal,
        })) {
          output += chunk;
          await send({ type: "token", text: chunk });
        }
      } catch (err) {
        error = err instanceof ProviderError ? err.message : `Generation failed: ${(err as Error).message}`;
        console.error("[generate]", err);
      }

      // Keep whatever arrived, even if the user hit stop or the stream broke.
      let saved: Message | null = null;
      if (output.trim()) {
        if (effectiveMode === "send") {
          const [row] = await db
            .insert(t.messages)
            .values({ chatId: chat.id, role: "assistant", swipes: [cleanReply(output, character.name)], swipeId: 0 })
            .returning();
          saved = row ?? null;
        } else if (target && effectiveMode === "regenerate") {
          const swipes = [...target.swipes, cleanReply(output, character.name)];
          saved = { ...target, swipes, swipeId: swipes.length - 1 };
        } else if (target) {
          const current = activeText(target);
          const joiner = /\s$/.test(current) || /^\s/.test(output) ? "" : " ";
          const swipes = target.swipes.with(target.swipeId, current + joiner + cleanReply(output, character.name));
          saved = { ...target, swipes };
        }
        if (saved && effectiveMode !== "send") {
          await db.update(t.messages).set({ swipes: saved.swipes, swipeId: saved.swipeId }).where(eq(t.messages.id, saved.id));
        }
        await touchChat(chat.id);
      }

      if (abort.signal.aborted) return;
      if (error) await send({ type: "error", error });
      else if (saved) await send({ type: "done", message: saved });
      else await send({ type: "error", error: "The model returned an empty reply." });
    });
  });

export const messageRoutes = new Hono()
  .patch("/:id", async (c) => {
    const messageId = Number(c.req.param("id"));
    const body = z
      .object({ swipeId: z.number().int().min(0).optional(), content: z.string().optional() })
      .parse(await c.req.json());
    const message = await db.query.messages.findFirst({ where: eq(t.messages.id, messageId) });
    if (!message) return c.json({ error: "Message not found" }, 404);
    const swipeId = Math.min(body.swipeId ?? message.swipeId, message.swipes.length - 1);
    const swipes = body.content !== undefined ? message.swipes.with(swipeId, body.content) : message.swipes;
    await db.update(t.messages).set({ swipes, swipeId }).where(eq(t.messages.id, messageId));
    return c.json({ ...message, swipes, swipeId });
  })

  .delete("/:id", async (c) => {
    await db.delete(t.messages).where(eq(t.messages.id, Number(c.req.param("id"))));
    return c.body(null, 204);
  });
