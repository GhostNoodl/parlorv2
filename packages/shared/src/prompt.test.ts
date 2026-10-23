import { describe, expect, it } from "vitest";
import { emptyCard } from "./defaults";
import { applyMacros } from "./macros";
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
  systemPrompt: "You are {{char}}. Talk to {{user}}.",
  history: [],
  contextSize: 8000,
  maxTokens: 500,
};

describe("applyMacros", () => {
  it("replaces modern and legacy macros case-insensitively", () => {
    expect(applyMacros("{{char}} <BOT> {{ USER }} <user>", { char: "A", user: "B" })).toBe("A A B B");
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
