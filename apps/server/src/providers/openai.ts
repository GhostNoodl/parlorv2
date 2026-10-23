import { ProviderError, type Provider, type ResolvedConnection } from "./types";

// Works with anything that speaks the OpenAI Chat Completions API:
// OpenAI, OpenRouter, Ollama, LM Studio, KoboldCpp, vLLM, DeepSeek and friends.

function headers(connection: ResolvedConnection): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    // OpenRouter uses these to label the app; other servers ignore them.
    "HTTP-Referer": "https://github.com/GhostNoodl/parlorv2",
    "X-Title": "Parlor",
  };
  if (connection.apiKey) h.Authorization = `Bearer ${connection.apiKey}`;
  return h;
}

function url(connection: ResolvedConnection, path: string): string {
  return `${connection.baseUrl.replace(/\/+$/, "")}${path}`;
}

async function failure(res: Response): Promise<ProviderError> {
  let detail = await res.text().catch(() => "");
  try {
    const json = JSON.parse(detail);
    detail = json.error?.message ?? json.message ?? json.detail ?? detail;
  } catch {
    // Not JSON, keep the raw body.
  }
  return new ProviderError(`HTTP ${res.status}: ${String(detail).slice(0, 500) || res.statusText}`);
}

export const openaiProvider: Provider = {
  async *stream({ connection, system, messages, signal }) {
    const { settings } = connection;
    let res: Response;
    try {
      res = await fetch(url(connection, "/chat/completions"), {
        method: "POST",
        headers: headers(connection),
        signal,
        body: JSON.stringify({
          model: connection.model,
          stream: true,
          max_tokens: settings.maxTokens,
          temperature: settings.temperature,
          top_p: settings.topP,
          messages: [...(system ? [{ role: "system", content: system }] : []), ...messages],
        }),
      });
    } catch (err) {
      if (signal.aborted) return;
      throw new ProviderError(`Could not reach ${connection.baseUrl}: ${(err as Error).message}`);
    }
    if (!res.ok || !res.body) throw await failure(res);

    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of res.body) {
      buffer += decoder.decode(chunk as Uint8Array, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") return;
        let json;
        try {
          json = JSON.parse(data);
        } catch {
          continue;
        }
        if (json.error) throw new ProviderError(json.error.message ?? JSON.stringify(json.error));
        const text = json.choices?.[0]?.delta?.content;
        if (text) yield text;
      }
    }
  },

  async listModels(connection) {
    const res = await fetch(url(connection, "/models"), { headers: headers(connection) });
    if (!res.ok) throw await failure(res);
    const json = (await res.json()) as { data?: { id: string }[] };
    return (json.data ?? []).map((m) => m.id).sort();
  },
};
