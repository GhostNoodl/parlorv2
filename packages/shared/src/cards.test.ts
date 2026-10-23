import { describe, expect, it } from "vitest";
import { CardError, embedCardInPng, extractCardFromPng, parseCardJson, readPngText, stripCardFromPng, toV2Json, toV3Json } from "./cards";
import { emptyCard } from "./defaults";

// A 1×1 transparent PNG.
const PIXEL = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
);

const card = {
  ...emptyCard("Zoë 🌙"),
  description: "A moon witch. Speaks in riddles — mostly.",
  first_mes: "*She looks up.* \"Oh. You.\"",
  alternate_greetings: ["Hi"],
  tags: ["fantasy"],
  character_book: { entries: [{ keys: ["moon"], content: "The moon is cheese." }] },
};

describe("card PNGs", () => {
  it("round-trips a card through a PNG, unicode included", () => {
    const png = embedCardInPng(PIXEL, card);
    const text = readPngText(png);
    expect(Object.keys(text).sort()).toEqual(["ccv3", "chara"]);
    const back = extractCardFromPng(png)!;
    expect(back.name).toBe("Zoë 🌙");
    expect(back.description).toBe(card.description);
    expect(back.alternate_greetings).toEqual(["Hi"]);
    expect(back.character_book).toEqual(card.character_book);
  });

  it("replaces old card data instead of stacking it", () => {
    const twice = embedCardInPng(embedCardInPng(PIXEL, card), { ...card, name: "Renamed" });
    expect(extractCardFromPng(twice)!.name).toBe("Renamed");
    expect(Object.keys(readPngText(twice))).toHaveLength(2);
  });

  it("falls back to the V2 chunk when there is no V3 chunk", () => {
    const v2Only = embedCardInPng(PIXEL, card, { v3: false });
    expect(Object.keys(readPngText(v2Only))).toEqual(["chara"]);
    expect(extractCardFromPng(v2Only)!.name).toBe(card.name);
  });

  it("returns null for a plain image and strips card data", () => {
    expect(extractCardFromPng(PIXEL)).toBeNull();
    expect(extractCardFromPng(stripCardFromPng(embedCardInPng(PIXEL, card)))).toBeNull();
  });

  it("rejects files that aren't PNGs", () => {
    expect(() => extractCardFromPng(new Uint8Array([1, 2, 3]))).toThrow(CardError);
  });
});

describe("card JSON", () => {
  it("reads V2 and V3 wrappers", () => {
    expect(parseCardJson(toV2Json(card)).name).toBe(card.name);
    expect(parseCardJson(toV3Json(card)).character_book).toEqual(card.character_book);
  });

  it("reads flat V1 and Pygmalion-style cards", () => {
    expect(parseCardJson({ name: "Old", description: "d", first_mes: "hi" })).toMatchObject({ name: "Old", description: "d", first_mes: "hi" });
    expect(parseCardJson({ char_name: "Pyg", char_persona: "p", char_greeting: "g", world_scenario: "w", example_dialogue: "e" })).toMatchObject({
      name: "Pyg",
      description: "p",
      first_mes: "g",
      scenario: "w",
      mes_example: "e",
    });
  });

  it("requires a name", () => {
    expect(() => parseCardJson({ spec: "chara_card_v2", data: { description: "nameless" } })).toThrow(/name/);
  });
});
