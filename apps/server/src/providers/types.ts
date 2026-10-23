import type { GenerationSettings, PromptMessage, ProviderKind } from "@parlor/shared";

/** A connection with its API key decrypted, server-side only. */
export interface ResolvedConnection {
  provider: ProviderKind;
  baseUrl: string;
  model: string;
  apiKey: string | null;
  settings: GenerationSettings;
}

export interface StreamParams {
  connection: ResolvedConnection;
  system: string;
  messages: PromptMessage[];
  signal: AbortSignal;
}

export interface Provider {
  /** Yields text chunks as they arrive. Throws ProviderError on failure. */
  stream(params: StreamParams): AsyncGenerator<string>;
  listModels(connection: ResolvedConnection): Promise<string[]>;
}

export class ProviderError extends Error {}
