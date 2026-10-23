import { applyMacros } from "./macros";
import type { BuiltPrompt, CharacterCard, PromptMessage } from "./types";

export interface PromptInput {
  card: CharacterCard;
  userName: string;
  userDescription: string;
  /** The global system prompt preset. A card's own system_prompt overrides it. */
  systemPrompt: string;
  /** Chat history, oldest first, already resolved to the active swipe. */
  history: PromptMessage[];
  /** Total token budget for the prompt plus the reply. */
  contextSize: number;
  /** Tokens reserved for the reply. */
  maxTokens: number;
}

/** Cheap, provider-agnostic token estimate (about 3.5 characters per token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

/**
 * Builds the system prompt and message list for one generation.
 *
 * Layout: system preset, character sheet, persona, example dialogue, then as
 * much recent history as fits, then post-history instructions folded into
 * the final user turn.
 */
export function buildPrompt(input: PromptInput): BuiltPrompt {
  const ctx = { char: input.card.name, user: input.userName };
  const m = (text: string) => applyMacros(text, ctx).trim();
  const { card } = input;

  const sections: string[] = [];
  // A card's own system prompt replaces the preset; {{original}} splices the preset in.
  const preset = card.system_prompt.trim()
    ? card.system_prompt.replace(/\{\{\s*original\s*\}\}/gi, input.systemPrompt)
    : input.systemPrompt;
  if (preset.trim()) sections.push(m(preset));

  const sheet: string[] = [];
  if (card.description.trim()) sheet.push(m(card.description));
  if (card.personality.trim()) sheet.push(`${card.name}'s personality: ${m(card.personality)}`);
  if (card.scenario.trim()) sheet.push(`Scenario: ${m(card.scenario)}`);
  if (sheet.length) sections.push(`<character name="${card.name}">\n${sheet.join("\n\n")}\n</character>`);

  if (input.userDescription.trim()) {
    sections.push(`<user name="${input.userName}">\n${m(input.userDescription)}\n</user>`);
  }

  const examples = formatExamples(card.mes_example, ctx);
  if (examples) {
    sections.push(`<example_dialogue>\nThese show ${card.name}'s voice and style. They are not part of the story.\n${examples}\n</example_dialogue>`);
  }

  const system = sections.join("\n\n");
  const postHistory = m(card.post_history_instructions);

  // Fit history from newest to oldest.
  const budget = input.contextSize - input.maxTokens - estimateTokens(system) - estimateTokens(postHistory);
  const kept: PromptMessage[] = [];
  let used = 0;
  for (let i = input.history.length - 1; i >= 0; i--) {
    const msg = input.history[i]!;
    const cost = estimateTokens(msg.content) + 4;
    if (used + cost > budget && kept.length > 0) break;
    kept.unshift({ role: msg.role, content: m(msg.content) });
    used += cost;
  }

  const messages = mergeConsecutive(kept);
  if (postHistory) {
    const last = messages.at(-1);
    if (last?.role === "user") last.content += `\n\n[${postHistory}]`;
    else messages.push({ role: "user", content: `[${postHistory}]` });
  }

  return {
    system,
    messages,
    estimatedTokens: estimateTokens(system) + used + estimateTokens(postHistory),
    droppedMessages: input.history.length - kept.length,
  };
}

/** Turns `<START>`-separated example blocks into a readable transcript. */
function formatExamples(raw: string, ctx: { char: string; user: string }): string {
  const text = applyMacros(raw, ctx).trim();
  if (!text) return "";
  return text
    .split(/<START>/i)
    .map((block) => block.trim())
    .filter(Boolean)
    .join("\n\n---\n\n");
}

/** Some APIs (Claude) require alternating roles, so join same-role neighbours. */
export function mergeConsecutive(messages: PromptMessage[]): PromptMessage[] {
  const out: PromptMessage[] = [];
  for (const msg of messages) {
    const prev = out.at(-1);
    if (prev && prev.role === msg.role) prev.content += `\n\n${msg.content}`;
    else out.push({ ...msg });
  }
  return out;
}
