import type { AppSettings, CharacterCard, GenerationSettings, PromptBlock, PromptBlockKind } from "./types";

export const DEFAULT_SYSTEM_PROMPT = [
  "You are {{char}} in an ongoing collaborative roleplay with {{user}}.",
  "Write {{char}}'s next reply only. Stay in character, show their feelings through action and dialogue, and keep the scene moving.",
  "Write actions in *asterisks* and speech in \"quotes\". Aim for one to four vivid paragraphs.",
  "Never write {{user}}'s words, thoughts or actions.",
].join("\n");

export const DEFAULT_REMINDER = "[Stay in character as {{char}}. Keep the reply vivid, and leave room for {{user}} to act.]";

/** Display names for the built-in blocks. */
export const BLOCK_LABELS: Record<PromptBlockKind, string> = {
  text: "Custom text",
  main: "Main prompt",
  character: "Character",
  persona: "Persona",
  examples: "Example dialogue",
  history: "Chat history",
  postHistory: "Card's post-history instructions",
};

const block = (kind: PromptBlockKind, content = "", enabled = true, name = BLOCK_LABELS[kind]): PromptBlock => ({
  id: kind === "text" ? `text-${Math.random().toString(36).slice(2, 10)}` : kind,
  kind,
  name,
  enabled,
  content,
});

/** The layout Parlor uses out of the box. */
export function defaultPromptBlocks(mainPrompt = DEFAULT_SYSTEM_PROMPT): PromptBlock[] {
  return [
    block("main", mainPrompt),
    block("character"),
    block("persona"),
    block("examples"),
    block("history"),
    block("postHistory"),
    block("text", DEFAULT_REMINDER, false, "Reminder"),
  ];
}

export const newTextBlock = (name = "Custom text", content = "") => block("text", content, true, name);

export const DEFAULT_APP_SETTINGS: AppSettings = {
  activePresetId: null,
  activeConnectionId: null,
  activePersonaId: null,
};

export const DEFAULT_PERSONA_NAME = "Guest";

export const DEFAULT_GENERATION_SETTINGS: GenerationSettings = {
  maxTokens: 1024,
  contextSize: 32768,
  temperature: 0.9,
  topP: 1,
  effort: "low",
};

export function emptyCard(name = ""): CharacterCard {
  return {
    name,
    description: "",
    personality: "",
    scenario: "",
    first_mes: "",
    mes_example: "",
    alternate_greetings: [],
    system_prompt: "",
    post_history_instructions: "",
    creator_notes: "",
    creator: "",
    character_version: "",
    tags: [],
    extensions: {},
  };
}

/** Quick-start presets for the connection form. */
export const CONNECTION_PRESETS = [
  { label: "Claude (Anthropic)", provider: "anthropic", baseUrl: "https://api.anthropic.com", model: "claude-opus-5-5", needsKey: true },
  { label: "OpenRouter", provider: "openai", baseUrl: "https://openrouter.ai/api/v1", model: "", needsKey: true },
  { label: "OpenAI", provider: "openai", baseUrl: "https://api.openai.com/v1", model: "", needsKey: true },
  { label: "Ollama", provider: "openai", baseUrl: "http://localhost:11434/v1", model: "", needsKey: false },
  { label: "LM Studio", provider: "openai", baseUrl: "http://localhost:1234/v1", model: "", needsKey: false },
  { label: "KoboldCpp", provider: "openai", baseUrl: "http://localhost:5001/v1", model: "", needsKey: false },
  { label: "Custom (OpenAI-compatible)", provider: "openai", baseUrl: "", model: "", needsKey: false },
] as const;
