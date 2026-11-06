import { describe, expect, it } from "vitest";
import { defaultPromptBlocks, emptyCard, newTextBlock } from "./defaults";
import { applyMacros } from "./macros";
import { parsePresetJson, PresetError, toPresetFile } from "./presets";
import { buildPrompt, mergeConsecutive } from "./prompt";

const card = {
  ...emptyCard("Basil"),
  description: "{{char}} runs the Parlor and teases {{user}}.",
  personality: "warm, sardonic",
  scenario: "A rainy night.",
};

const base = {
  card,
  userName: "Andrew",
  userDescription: "",
  blocks: defaultPromptBlocks("You are {{char}}. Talk to {{user}}."),
  history: [],
  contextSize: 8000,
  maxTokens: 500,
};

describe("applyMacros", () => {
  it("replaces modern and legacy macros case-insensitively", () => {
    expect(applyMacros("{{char}} <BOT> {{ USER }} <user>", { char: "A", user: "B" })).toBe("A A B B");
  });

  it("handles dates, comments and random picks", () => {
    const now = new Date(2026, 10, 6, 21, 5);
    expect(applyMacros("{{weekday}}, {{date}}{{// hidden}}", { char: "A", user: "B", now })).toBe("Friday, November 6, 2026");
    expect(["x", "y"]).toContain(applyMacros("{{random:x,y}}", { char: "A", user: "B" }));
    expect(applyMacros("{{random::only one}}", { char: "A", user: "B" })).toBe("only one");
  });
});

describe("buildPrompt", () => {
  it("assembles the system prompt with macros resolved", () => {
    const out = buildPrompt(base);
    expect(out.system).toContain("You are Basil. Talk to Andrew.");
    expect(out.system).toContain("Basil runs the Parlor and teases Andrew.");
    expect(out.system).toContain("Basil's personality: warm, sardonic");
    expect(out.system).toContain("Scenario: A rainy night.");
  });

  it("lets the card's system prompt override the preset, with {{original}}", () => {
    const out = buildPrompt({ ...base, card: { ...card, system_prompt: "Card rules. {{original}}" } });
    expect(out.system.startsWith("Card rules. You are Basil.")).toBe(true);
  });

  it("drops the oldest history when the context is full", () => {
    const history = Array.from({ length: 50 }, (_, i) => ({
      role: (i % 2 ? "assistant" : "user") as "user" | "assistant",
      content: `message ${i} ${"x".repeat(350)}`,
    }));
    const out = buildPrompt({ ...base, history, contextSize: 2000 });
    expect(out.droppedMessages).toBeGreaterThan(0);
    expect(out.messages.at(-1)?.content).toContain("message 49");
    expect(out.messages.some((msg) => msg.content.includes("message 0 "))).toBe(false);
  });

  it("appends post-history instructions to the last user turn", () => {
    const out = buildPrompt({
      ...base,
      card: { ...card, post_history_instructions: "Stay spooky, {{user}}." },
      history: [{ role: "user", content: "Hi" }],
    });
    expect(out.messages).toEqual([{ role: "user", content: "Hi\n\n[Stay spooky, Andrew.]" }]);
  });
});

describe("prompt presets", () => {
  const history = [
    { role: "assistant" as const, content: "Evening." },
    { role: "user" as const, content: "Hi" },
  ];

  it("follows the block order and skips disabled blocks", () => {
    const blocks = defaultPromptBlocks("Main.");
    const [main, character, ...rest] = blocks;
    const out = buildPrompt({ ...base, blocks: [character!, { ...main!, enabled: false }, ...rest], history });
    expect(out.system.startsWith('<character name="Basil">')).toBe(true);
    expect(out.system).not.toContain("Main.");
  });

  it("puts blocks below the history into the last user turn", () => {
    const blocks = [...defaultPromptBlocks("Main."), newTextBlock("Note", "Keep it short, {{char}}.")];
    const out = buildPrompt({ ...base, blocks, history });
    expect(out.messages.at(-1)).toEqual({ role: "user", content: "Hi\n\nKeep it short, Basil." });
    expect(out.breakdown.map((p) => p.placement)).toEqual(["system", "system", "history", "after"]);
    expect(out.breakdown.find((p) => p.kind === "history")?.tokens).toBeGreaterThan(0);
  });

  it("sends no history when the history block is off", () => {
    const blocks = defaultPromptBlocks().map((b) => (b.kind === "history" ? { ...b, enabled: false } : b));
    expect(buildPrompt({ ...base, blocks, history }).messages).toEqual([]);
  });

  it("round-trips Parlor preset files", () => {
    const file = JSON.parse(JSON.stringify(toPresetFile({ name: "Mine", blocks: defaultPromptBlocks("Hello") })));
    const parsed = parsePresetJson(file);
    expect(parsed.name).toBe("Mine");
    expect(parsed.blocks.map((b) => b.kind)).toEqual(defaultPromptBlocks().map((b) => b.kind));
    expect(parsed.blocks[0]!.content).toBe("Hello");
  });

  it("imports SillyTavern chat-completion presets", () => {
    const st = {
      prompts: [
        { identifier: "main", name: "Main Prompt", content: "Write {{char}}'s next reply.", system_prompt: true },
        { identifier: "nsfw", name: "Auxiliary Prompt", content: "", system_prompt: true },
        { identifier: "charDescription", marker: true },
        { identifier: "charPersonality", marker: true },
        { identifier: "worldInfoBefore", marker: true },
        { identifier: "chatHistory", marker: true },
        { identifier: "jailbreak", name: "Post-History Instructions", content: "Be bold." },
      ],
      prompt_order: [
        {
          character_id: 100001,
          order: [
            { identifier: "main", enabled: true },
            { identifier: "nsfw", enabled: true },
            { identifier: "worldInfoBefore", enabled: true },
            { identifier: "charDescription", enabled: true },
            { identifier: "charPersonality", enabled: true },
            { identifier: "chatHistory", enabled: true },
            { identifier: "jailbreak", enabled: false },
          ],
        },
      ],
    };
    const { name, blocks } = parsePresetJson(st, "Celia");
    expect(name).toBe("Celia");
    expect(blocks.map((b) => [b.kind, b.enabled])).toEqual([
      ["main", true],
      ["character", true],
      ["history", true],
      ["postHistory", true],
      ["text", false],
    ]);
    expect(blocks.at(-1)!.content).toBe("Be bold.");
    expect(() => parsePresetJson({ hello: 1 })).toThrow(PresetError);
  });
});

describe("mergeConsecutive", () => {
  it("merges neighbours with the same role", () => {
    expect(
      mergeConsecutive([
        { role: "assistant", content: "a" },
        { role: "assistant", content: "b" },
        { role: "user", content: "c" },
      ]),
    ).toEqual([
      { role: "assistant", content: "a\n\nb" },
      { role: "user", content: "c" },
    ]);
  });
});
