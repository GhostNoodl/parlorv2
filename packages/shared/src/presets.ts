import { BLOCK_LABELS, newTextBlock } from "./defaults";
import type { PromptBlock, PromptBlockKind, PromptPreset } from "./types";

export class PresetError extends Error {}

/** What a preset file looks like on disk. */
export interface PresetFile {
  parlor_preset: 1;
  name: string;
  blocks: Omit<PromptBlock, "id">[];
}

export function toPresetFile(preset: Pick<PromptPreset, "name" | "blocks">): PresetFile {
  return { parlor_preset: 1, name: preset.name, blocks: preset.blocks.map(({ id: _id, ...rest }) => rest) };
}

const KINDS = new Set<PromptBlockKind>(["text", "main", "character", "persona", "examples", "history", "postHistory"]);
const SINGLETONS = new Set<PromptBlockKind>(["main", "character", "persona", "examples", "history", "postHistory"]);

/** Fills in ids and drops duplicate built-in blocks, so any block list is safe to store. */
export function normalizeBlocks(blocks: Partial<PromptBlock>[]): PromptBlock[] {
  const seen = new Set<PromptBlockKind>();
  const out: PromptBlock[] = [];
  for (const b of blocks) {
    const kind = b.kind && KINDS.has(b.kind) ? b.kind : "text";
    if (SINGLETONS.has(kind)) {
      if (seen.has(kind)) continue;
      seen.add(kind);
    }
    const fresh = kind === "text" ? newTextBlock() : null;
    out.push({
      id: kind === "text" ? (b.id && b.id.startsWith("text-") ? b.id : fresh!.id) : kind,
      kind,
      name: (b.name ?? "").trim() || BLOCK_LABELS[kind],
      enabled: b.enabled ?? true,
      content: typeof b.content === "string" ? b.content : "",
    });
  }
  if (!seen.has("history")) out.push({ id: "history", kind: "history", name: BLOCK_LABELS.history, enabled: true, content: "" });
  return out;
}

// SillyTavern chat-completion presets name their prompts by identifier.
const ST_MARKERS: Record<string, PromptBlockKind> = {
  main: "main",
  charDescription: "character",
  charPersonality: "character",
  scenario: "character",
  personaDescription: "persona",
  dialogueExamples: "examples",
  chatHistory: "history",
};

interface StPrompt {
  identifier: string;
  name?: string;
  content?: string;
  marker?: boolean;
  enabled?: boolean;
}

interface StPreset {
  prompts: StPrompt[];
  prompt_order?: { character_id: number; order: { identifier: string; enabled: boolean }[] }[];
}

/**
 * Reads a Parlor preset file or a SillyTavern chat-completion preset.
 * Returns a name and normalized blocks; throws PresetError otherwise.
 */
export function parsePresetJson(raw: unknown, fallbackName = "Imported preset"): { name: string; blocks: PromptBlock[] } {
  if (!raw || typeof raw !== "object") throw new PresetError("That file isn't a preset.");
  const obj = raw as Record<string, unknown>;

  if (obj.parlor_preset === 1 && Array.isArray(obj.blocks)) {
    const name = typeof obj.name === "string" && obj.name.trim() ? obj.name.trim() : fallbackName;
    return { name, blocks: normalizeBlocks(obj.blocks as Partial<PromptBlock>[]) };
  }

  if (Array.isArray(obj.prompts)) return { name: fallbackName, blocks: fromSillyTavern(obj as unknown as StPreset) };

  throw new PresetError("That file isn't a Parlor or SillyTavern chat-completion preset.");
}

function fromSillyTavern(st: StPreset): PromptBlock[] {
  const byId = new Map(st.prompts.filter((p) => p && typeof p.identifier === "string").map((p) => [p.identifier, p]));
  // ST keeps a global order (character 100001) and sometimes per-character ones; prefer the global one.
  const orders = st.prompt_order ?? [];
  const order =
    (orders.find((o) => o.character_id === 100001) ?? orders.at(-1))?.order ??
    st.prompts.map((p) => ({ identifier: p.identifier, enabled: p.enabled ?? true }));

  const blocks: Partial<PromptBlock>[] = [];
  for (const entry of order) {
    const prompt = byId.get(entry.identifier);
    const kind = ST_MARKERS[entry.identifier];
    if (kind) {
      blocks.push({ kind, enabled: entry.enabled, content: kind === "main" ? (prompt?.content ?? "") : "" });
      if (kind === "history") blocks.push({ kind: "postHistory", enabled: true });
      continue;
    }
    // Other markers (world info and friends) have nothing to carry over yet.
    if (!prompt || prompt.marker || !prompt.content?.trim()) continue;
    blocks.push({ kind: "text", name: prompt.name ?? entry.identifier, enabled: entry.enabled, content: prompt.content });
  }
  return normalizeBlocks(blocks);
}
