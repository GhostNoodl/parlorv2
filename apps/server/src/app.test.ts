import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Character, Chat, GenerateEvent, Message } from "@parlor/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.PARLOR_DATA_DIR = mkdtempSync(join(tmpdir(), "parlor-test-"));

const { app } = await import("./app");
const { initDb } = await import("./db/client");
const { seed } = await import("./seed");

// A fake OpenAI-compatible server that streams a canned reply.
let lastRequest: any = null;
let mock: Server;
let mockUrl = "";

beforeAll(async () => {
  await initDb();
  await seed();
  mock = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.url === "/v1/models") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: [{ id: "mock-b" }, { id: "mock-a" }] }));
        return;
      }
      lastRequest = JSON.parse(body);
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      for (const piece of ["Basil: *He smiles.* ", '"Welcome', ' back."']) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
      }
      res.end("data: [DONE]\n\n");
    });
  });
  await new Promise<void>((resolve) => mock.listen(0, "127.0.0.1", resolve));
  mockUrl = `http://127.0.0.1:${(mock.address() as AddressInfo).port}/v1`;
});

afterAll(() => mock.close());

const api = (path: string, init?: RequestInit) =>
  app.request(`/api${path}`, { headers: { "Content-Type": "application/json" }, ...init });
const json = async <T>(res: Response | Promise<Response>) => (await res).json() as Promise<T>;

async function generate(chatId: string, body: object): Promise<GenerateEvent[]> {
  const res = await api(`/chats/${chatId}/generate`, { method: "POST", body: JSON.stringify(body) });
  const text = await res.text();
  return text
    .split("\n")
    .filter((l) => l.startsWith("data:"))
    .map((l) => JSON.parse(l.slice(5)));
}

describe("api", () => {
  let character: Character;
  let chat: Chat;

  it("seeds a sample character", async () => {
    const characters = await json<Character[]>(api("/characters"));
    expect(characters.map((c) => c.name)).toEqual(["Basil"]);
    character = characters[0]!;
  });

  it("refuses to generate without a connection", async () => {
    chat = await json<Chat>(api(`/characters/${character.id}/chats`, { method: "POST" }));
    const res = await api(`/chats/${chat.id}/generate`, { method: "POST", body: JSON.stringify({ mode: "send", text: "hi" }) });
    expect(res.status).toBe(400);
  });

  it("stores connections without ever returning the key", async () => {
    const created = await json<any>(
      api("/connections", {
        method: "POST",
        body: JSON.stringify({ name: "Mock", provider: "openai", baseUrl: mockUrl, model: "mock-a", apiKey: "sk-secret" }),
      }),
    );
    expect(created.hasApiKey).toBe(true);
    expect(JSON.stringify(created)).not.toContain("sk-secret");
    const settings = await json<any>(api("/settings"));
    expect(settings.activeConnectionId).toBe(created.id);
    const models = await json<any>(api(`/connections/${created.id}/models`));
    expect(models).toEqual({ ok: true, models: ["mock-a", "mock-b"] });
  });

  it("starts chats with the greeting and alternates as swipes", async () => {
    const { messages } = await json<{ messages: Message[] }>(api(`/chats/${chat.id}`));
    expect(messages).toHaveLength(1);
    expect(messages[0]!.role).toBe("assistant");
    expect(messages[0]!.swipes).toHaveLength(2);
  });

  it("streams a reply, strips the name prefix and saves it", async () => {
    const events = await generate(chat.id, { mode: "send", text: "Hello again" });
    expect(events.filter((e) => e.type === "token")).toHaveLength(3);
    const done = events.at(-1);
    expect(done?.type).toBe("done");
    expect(done?.type === "done" && done.message.swipes).toEqual(['*He smiles.* "Welcome back."']);

    expect(lastRequest.model).toBe("mock-a");
    expect(lastRequest.messages[0].role).toBe("system");
    expect(lastRequest.messages.at(-1)).toEqual({ role: "user", content: "Hello again" });

    const { messages } = await json<{ messages: Message[] }>(api(`/chats/${chat.id}`));
    expect(messages.map((m) => m.role)).toEqual(["assistant", "user", "assistant"]);
  });

  it("regenerates into a new swipe without resending the old reply", async () => {
    const events = await generate(chat.id, { mode: "regenerate" });
    const done = events.at(-1);
    expect(done?.type === "done" && done.message.swipes).toHaveLength(2);
    expect(done?.type === "done" && done.message.swipeId).toBe(1);
    expect(lastRequest.messages.at(-1).role).toBe("user");
  });

  it("switches swipes and edits messages", async () => {
    const { messages } = await json<{ messages: Message[] }>(api(`/chats/${chat.id}`));
    const last = messages.at(-1)!;
    const updated = await json<Message>(api(`/messages/${last.id}`, { method: "PATCH", body: JSON.stringify({ swipeId: 0, content: "Edited" }) }));
    expect(updated.swipeId).toBe(0);
    expect(updated.swipes[0]).toBe("Edited");
  });

  it("continues the last reply in place", async () => {
    const events = await generate(chat.id, { mode: "continue" });
    const done = events.at(-1);
    expect(done?.type === "done" && done.message.swipes[0]).toBe('Edited *He smiles.* "Welcome back."');
  });
});
