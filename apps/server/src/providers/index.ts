import type { ProviderKind } from "@parlor/shared";
import { anthropicProvider } from "./anthropic";
import { openaiProvider } from "./openai";
import type { Provider } from "./types";

export const providers: Record<ProviderKind, Provider> = {
  openai: openaiProvider,
  anthropic: anthropicProvider,
};

export * from "./types";
