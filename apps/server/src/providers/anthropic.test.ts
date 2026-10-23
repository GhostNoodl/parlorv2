import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { DEFAULT_GENERATION_SETTINGS, type PromptMessage } from "@parlor/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anthropicProvider } from "./anthropic";
import type { ResolvedConnection } from "./types";

// A fake Messages API that streams two text deltas, or a refusal.
let lastBody: any = null;
let lastHeaders: IncomingHttpHeaders = {};
let refuse = false;
let server: Server;
let baseUrl = "";

const sse = (event: string, data: object) => `event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`;

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      lastBody = JSON.parse(body);
      lastHeaders = req.headers;
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(
        sse("message_start", {
          message: { id: "msg_1", type: "message", role: "assistant", model: lastBody.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } },
        }),
      );
      res.write(sse("content_block_start", { index: 0, content_block: { type: "text", text: "" } }));
      for (const text of ["*Basil nods.* ", '"Evening."']) {
        res.write(sse("content_block_delta", { index: 0, delta: { type: "text_delta", text } }));
      }
      res.write(sse("content_block_stop", { index: 0 }));
      res.write(sse("message_delta", { delta: { stop_reason: refuse ? "refusal" : "end_turn", stop_sequence: null }, usage: { output_tokens: 5 } }));
      res.end(sse("message_stop", {}));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => server.close());

const connection = (model: string): ResolvedConnection => ({
  provider: "anthropic",
  baseUrl,
  model,
  apiKey: "sk-ant-test",
  settings: { ...DEFAULT_GENERATION_SETTINGS, maxTokens: 2048, effort: "medium" },
});

async function collect(model: string, messages: PromptMessage[] = [{ role: "assistant", content: "Hello there." }]) {
  let out = "";
  for await (const chunk of anthropicProvider.stream({ connection: connection(model), system: "Be Basil.", messages, signal: new AbortController().signal })) {
    out += chunk;
  }
  return out;
}

describe("anthropic provider", () => {
  it("streams text and sends a request the current API accepts", async () => {
    refuse = false;
    expect(await collect("claude-opus-5-5")).toBe('*Basil nods.* "Evening."');
    expect(lastBody.system).toBe("Be Basil.");
    expect(lastBody.max_tokens).toBe(2048);
    expect(lastBody.output_config).toEqual({ effort: "medium" });
    expect(lastBody.fallbacks).toBe("default");
    expect(lastHeaders["anthropic-beta"]).toContain("server-side-fallback-2026-07-01");
    expect(lastBody).not.toHaveProperty("temperature");
    expect(lastBody).not.toHaveProperty("top_p");
    // Claude needs a user turn first, so one is added before the greeting.
    expect(lastBody.messages[0].role).toBe("user");
    expect(lastBody.messages[1]).toEqual({ role: "assistant", content: "Hello there." });
  });

  it("leaves out fallbacks and effort for models that don't take them", async () => {
    refuse = false;
    await collect("claude-haiku-4-5", [{ role: "user", content: "Hi" }]);
    expect(lastBody).not.toHaveProperty("fallbacks");
    expect(lastBody).not.toHaveProperty("output_config");
    expect(lastBody.messages).toEqual([{ role: "user", content: "Hi" }]);
  });

  it("reports refusals as an error", async () => {
    refuse = true;
    await expect(collect("claude-opus-5-5")).rejects.toThrow(/declined/);
  });
});
