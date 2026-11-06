/**
 * Character data, modelled on the Character Card V2/V3 `data` object so that
 * importing and exporting SillyTavern-style cards is a straight mapping.
 */
export interface CharacterCard {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  first_mes: string;
  mes_example: string;
  alternate_greetings: string[];
  system_prompt: string;
  post_history_instructions: string;
  creator_notes: string;
  creator: string;
  character_version: string;
  tags: string[];
  extensions: Record<string, unknown>;
  /** Embedded lorebook, kept as-is from the card until lorebooks land. */
  character_book?: unknown;
  /** V3 extras, preserved on round trips. */
  nickname?: string;
  group_only_greetings?: string[];
  source?: string[];
  creation_date?: number;
  modification_date?: number;
}

export interface Persona {
  id: string;
  name: string;
  description: string;
  avatar: string | null;
  createdAt: number;
}

export interface Character {
  id: string;
  name: string;
  avatar: string | null;
  card: CharacterCard;
  createdAt: number;
  updatedAt: number;
}

export type ProviderKind = "openai" | "anthropic";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface GenerationSettings {
  /** Max tokens for the reply (for Claude this also covers thinking). */
  maxTokens: number;
  /** Total context budget used when trimming old history. */
  contextSize: number;
  /** OpenAI-compatible only. Claude's current API rejects sampling params. */
  temperature: number;
  topP: number;
  /** Claude only. */
  effort: Effort;
}

export interface Connection {
  id: string;
  name: string;
  provider: ProviderKind;
  baseUrl: string;
  model: string;
  /** True when a key is stored. The key itself never leaves the server. */
  hasApiKey: boolean;
  settings: GenerationSettings;
  createdAt: number;
}

export interface Chat {
  id: string;
  characterId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export type MessageRole = "user" | "assistant";

export interface Message {
  id: number;
  chatId: string;
  role: MessageRole;
  /** Alternate versions of this message. Users have exactly one. */
  swipes: string[];
  swipeId: number;
  createdAt: number;
}

export interface AppSettings {
  systemPrompt: string;
  activeConnectionId: string | null;
  activePersonaId: string | null;
}

export type GenerateMode = "send" | "regenerate" | "continue";

/** Events streamed from the server while a reply is generated. */
export type GenerateEvent =
  | { type: "start"; messageId: number | null }
  | { type: "token"; text: string }
  | { type: "done"; message: Message }
  | { type: "error"; error: string };

/** What the prompt builder hands to a provider adapter. */
export interface PromptMessage {
  role: MessageRole;
  content: string;
}

export interface BuiltPrompt {
  system: string;
  messages: PromptMessage[];
  /** Rough token estimate of everything sent. */
  estimatedTokens: number;
  /** How many history messages were dropped to fit the context. */
  droppedMessages: number;
}
