import { applyMacros } from "./macros";
import type { BuiltPrompt, CharacterCard, PromptBlock, PromptMessage, PromptPart } from "./types";

export interface PromptInput {
  card: CharacterCard;
  userName: string;
  userDescription: string;
  /** The active preset's blocks, in order. */
  blocks: PromptBlock[];
  /** Chat history, oldest first, already resolved to the active swipe. */
  history: PromptMessage[];
  /** Total token budget for the prompt plus the reply. */
  contextSize: number;
  /** Tokens reserved for the reply. */
  maxTokens: number;
  /** Fixed clock for {{date}} and friends (tests). */
  now?: Date;
}

/** Cheap, provider-agnostic token estimate (about 3.5 characters per token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

/**
 * Builds the system prompt and message list for one generation.
 *
 * Enabled blocks above the "history" block are joined into the system
 * prompt. Then comes as much recent history as fits, and finally the blocks
 * below "history" are folded into the last user turn (where models pay the
 * most attention). A preset without a history block keeps history last.
 */
export function buildPrompt(input: PromptInput): BuiltPrompt {
  const ctx = { char: input.card.name, user: input.userName, now: input.now };
  const m = (text: string) => applyMacros(text, ctx).trim();

  const historyAt = input.blocks.findIndex((b) => b.kind === "history");
  const historyBlock = historyAt >= 0 ? input.blocks[historyAt]! : null;
  const before = historyAt >= 0 ? input.blocks.slice(0, historyAt) : input.blocks;
  const after = historyAt >= 0 ? input.blocks.slice(historyAt + 1) : [];

  const breakdown: PromptPart[] = [];
  const render = (blocks: PromptBlock[], placement: PromptPart["placement"]) => {
    const texts: string[] = [];
    for (const block of blocks) {
      if (!block.enabled || block.kind === "history") continue;
      const text = renderBlock(block, input, m);
      if (!text) continue;
      texts.push(text);
      breakdown.push({ blockId: block.id, name: block.name, kind: block.kind, tokens: estimateTokens(text), placement });
    }
    return texts.join("\n\n");
  };

  const system = render(before, "system");
  const historyPartAt = breakdown.length;
  const afterText = render(after, "after");

  // Fit history from newest to oldest. A disabled history block sends none.
  const history = historyBlock && !historyBlock.enabled ? [] : input.history;
  const budget = input.contextSize - input.maxTokens - estimateTokens(system) - estimateTokens(afterText);
  const kept: PromptMessage[] = [];
  let used = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i]!;
    const cost = estimateTokens(msg.content) + 4;
    if (used + cost > budget && kept.length > 0) break;
    kept.unshift({ role: msg.role, content: m(msg.content) });
    used += cost;
  }
  breakdown.splice(historyPartAt, 0, {
    blockId: historyBlock?.id ?? "history",
    name: historyBlock?.name ?? "Chat history",
    kind: "history",
    tokens: used,
    placement: "history",
  });

  const messages = mergeConsecutive(kept);
  if (afterText) {
    const last = messages.at(-1);
    if (last?.role === "user") last.content += `\n\n${afterText}`;
    else messages.push({ role: "user", content: afterText });
  }

  return {
    system,
    messages,
    estimatedTokens: estimateTokens(system) + used + estimateTokens(afterText),
    droppedMessages: input.history.length - kept.length,
    breakdown,
  };
}

function renderBlock(block: PromptBlock, input: PromptInput, m: (text: string) => string): string {
  const { card } = input;
  switch (block.kind) {
    case "text":
      return m(block.content);
    case "main":
      // A card's own system prompt replaces the main prompt; {{original}} splices it back in.
      return m(card.system_prompt.trim() ? card.system_prompt.replace(/\{\{\s*original\s*\}\}/gi, block.content) : block.content);
    case "character": {
      const sheet: string[] = [];
      if (card.description.trim()) sheet.push(m(card.description));
      if (card.personality.trim()) sheet.push(`${card.name}'s personality: ${m(card.personality)}`);
      if (card.scenario.trim()) sheet.push(`Scenario: ${m(card.scenario)}`);
      return sheet.length ? `<character name="${card.name}">\n${sheet.join("\n\n")}\n</character>` : "";
    }
    case "persona":
      return input.userDescription.trim() ? `<user name="${input.userName}">\n${m(input.userDescription)}\n</user>` : "";
    case "examples": {
      const examples = formatExamples(card.mes_example, m);
      return examples
        ? `<example_dialogue>\nThese show ${card.name}'s voice and style. They are not part of the story.\n${examples}\n</example_dialogue>`
        : "";
    }
    case "postHistory": {
      const text = m(card.post_history_instructions);
      return text ? `[${text}]` : "";
    }
    case "history":
      return "";
  }
}

/** Turns `<START>`-separated example blocks into a readable transcript. */
function formatExamples(raw: string, m: (text: string) => string): string {
  const text = m(raw);
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
