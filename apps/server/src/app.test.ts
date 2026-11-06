import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { embedCardInPng, emptyCard, extractCardFromPng, type Character, type Chat, type GenerateEvent, type Message, type Persona } from "@parlor/shared";
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

// A 1×1 transparent PNG.
const PIXEL = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
);

function upload(path: string, files: { name: string; bytes: Uint8Array | string }[], method = "POST") {
  const form = new FormData();
  for (const f of files) form.append("file", new File([typeof f.bytes === "string" ? f.bytes : new Uint8Array(f.bytes)], f.name));
  return app.request(`/api${path}`, { method, body: form });
}

describe("characters", () => {
  it("imports card PNGs and JSON, and reports bad files", async () => {
    const png = embedCardInPng(PIXEL, { ...emptyCard("Ivy"), description: "A botanist.", first_mes: "Hello, {{user}}." });
    const json = JSON.stringify({ spec: "chara_card_v2", spec_version: "2.0", data: { ...emptyCard("Rook"), description: "A crow." } });
    const res = await upload("/characters/import", [
      { name: "ivy.png", bytes: png },
      { name: "rook.json", bytes: json },
      { name: "plain.png", bytes: PIXEL },
      { name: "notes.txt", bytes: "hello" },
    ]);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { imported: Character[]; errors: { file: string; error: string }[] };
    expect(body.imported.map((c) => c.name)).toEqual(["Ivy", "Rook"]);
    expect(body.imported[0]!.avatar).toMatch(/^\/api\/characters\/.+\/avatar\?v=/);
    expect(body.imported[1]!.avatar).toBeNull();
    expect(body.errors.map((e) => e.file)).toEqual(["plain.png", "notes.txt"]);

    // The stored avatar is served without the card data inside it.
    const avatar = new Uint8Array(await (await app.request(body.imported[0]!.avatar!)).arrayBuffer());
    expect(extractCardFromPng(avatar)).toBeNull();
  });

  it("exports a card PNG that imports back the same, with or without an avatar", async () => {
    const characters = await json<Character[]>(api("/characters"));
    for (const name of ["Ivy", "Rook"]) {
      const character = characters.find((c) => c.name === name)!;
      const res = await api(`/characters/${character.id}/export`);
      expect(res.headers.get("content-type")).toBe("image/png");
      expect(res.headers.get("content-disposition")).toContain(`${name}.png`);
      const card = extractCardFromPng(new Uint8Array(await res.arrayBuffer()));
      expect(card).toMatchObject({ name, description: character.card.description });
    }
  });

  it("exports V3 JSON", async () => {
    const ivy = (await json<Character[]>(api("/characters"))).find((c) => c.name === "Ivy")!;
    const exported = await json<any>(api(`/characters/${ivy.id}/export?format=json`));
    expect(exported.spec).toBe("chara_card_v3");
    expect(exported.data.first_mes).toBe("Hello, {{user}}.");
  });

  it("replaces and removes avatars", async () => {
    const rook = (await json<Character[]>(api("/characters"))).find((c) => c.name === "Rook")!;
    const put = await upload(`/characters/${rook.id}/avatar`, [{ name: "a.png", bytes: PIXEL }], "PUT");
    expect(put.status).toBe(200);
    const bad = await upload(`/characters/${rook.id}/avatar`, [{ name: "a.jpg", bytes: "not a png" }], "PUT");
    expect(bad.status).toBe(400);
    expect((await api(`/characters/${rook.id}/avatar`, { method: "DELETE" })).status).toBe(204);
    expect((await api(`/characters/${rook.id}/avatar`)).status).toBe(404);
  });
});

describe("personas", () => {
  it("starts with one persona and uses the active one in prompts", async () => {
    const personas = await json<Persona[]>(api("/personas"));
    expect(personas).toHaveLength(1);
    const created = await json<Persona>(api("/personas", { method: "POST", body: JSON.stringify({ name: "Andrew", description: "A bard." }) }));
    await api("/settings", { method: "PATCH", body: JSON.stringify({ activePersonaId: created.id }) });

    const basil = (await json<Character[]>(api("/characters"))).find((c) => c.name === "Basil")!;
    const chat = await json<Chat>(api(`/characters/${basil.id}/chats`, { method: "POST" }));
    await generate(chat.id, { mode: "send", text: "Hi" });
    expect(lastRequest.messages[0].content).toContain('<user name="Andrew">');
    expect(lastRequest.messages[0].content).toContain("A bard.");
  });

  it("won't delete the last persona", async () => {
    const personas = await json<Persona[]>(api("/personas"));
    expect((await api(`/personas/${personas[0]!.id}`, { method: "DELETE" })).status).toBe(204);
    const left = await json<Persona[]>(api("/personas"));
    expect(left).toHaveLength(1);
    expect((await api(`/personas/${left[0]!.id}`, { method: "DELETE" })).status).toBe(400);
  });
});
