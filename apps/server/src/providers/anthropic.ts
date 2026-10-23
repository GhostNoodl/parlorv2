import Anthropic from "@anthropic-ai/sdk";
import type { PromptMessage } from "@parlor/shared";
import { ProviderError, type Provider, type ResolvedConnection } from "./types";

// Models that take server-side refusal fallbacks (`fallbacks: "default"`).
const FALLBACK_MODELS = /^claude-(opus-5|opus-5-5|fable-5-1|sonnet-5-5)$/;
// Models that accept `output_config.effort`.
const EFFORT_MODELS = /^claude-(opus|sonnet|haiku|fable|mythos)-5|^claude-opus-4-[678]|^claude-sonnet-4-6/;

function client(connection: ResolvedConnection) {
  if (!connection.apiKey) throw new ProviderError("Add your Anthropic API key to this connection first.");
  const baseURL = connection.baseUrl.replace(/\/+$/, "");
  return new Anthropic({
    apiKey: connection.apiKey,
    ...(baseURL && baseURL !== "https://api.anthropic.com" ? { baseURL } : {}),
  });
}

/** Claude needs the conversation to start with a user turn. */
function claudeMessages(messages: PromptMessage[]): PromptMessage[] {
  if (messages[0]?.role === "user") return messages;
  return [{ role: "user", content: "[The roleplay begins.]" }, ...messages];
}

function describe(err: unknown): ProviderError {
  if (err instanceof Anthropic.APIError) {
    const body = err.error as { error?: { message?: string } } | undefined;
    return new ProviderError(`HTTP ${err.status ?? "?"}: ${body?.error?.message ?? err.message}`);
  }
  return new ProviderError((err as Error).message);
}

export const anthropicProvider: Provider = {
  async *stream({ connection, system, messages, signal }) {
    const { model, settings } = connection;
    const useFallbacks = FALLBACK_MODELS.test(model);
    // The 2026-10-21 API rejects temperature/top_p/top_k, so Claude is steered
    // with effort instead.
    const stream = client(connection).beta.messages.stream(
      {
        model,
        max_tokens: settings.maxTokens,
        system: system || undefined,
        messages: claudeMessages(messages),
        ...(EFFORT_MODELS.test(model) ? { output_config: { effort: settings.effort } } : {}),
        ...(useFallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      },
      { signal },
    );

    try {
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield event.delta.text;
        }
      }
      const final = await stream.finalMessage();
      if (final.stop_reason === "refusal") {
        throw new ProviderError("Claude declined to continue this reply. Try rewording or regenerating.");
      }
    } catch (err) {
      if (signal.aborted || err instanceof Anthropic.APIUserAbortError) return;
      if (err instanceof ProviderError) throw err;
      throw describe(err);
    }
  },

  async listModels(connection) {
    try {
      const ids: string[] = [];
      for await (const m of client(connection).models.list()) ids.push(m.id);
      return ids;
    } catch (err) {
      throw describe(err);
    }
  },
};
