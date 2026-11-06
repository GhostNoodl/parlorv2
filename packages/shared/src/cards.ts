import { emptyCard } from "./defaults";
import type { CharacterCard } from "./types";

// Character Card V1/V2/V3 support.
//
// A card PNG is an ordinary image with the character JSON stored, base64
// encoded, in a tEXt chunk: keyword `chara` for V2 (and V1), `ccv3` for V3.
// We read `ccv3` first and fall back to `chara`, and write both on export so
// older apps can still read our cards.

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

export class CardError extends Error {}

// ---- base64 + UTF-8, without Node's Buffer so this also runs in browsers ----

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const utf8 = new TextEncoder();
const fromUtf8 = new TextDecoder();
const latin1 = new TextDecoder("latin1");

// ---- PNG chunks ----

let crcTable: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const b of bytes) crc = crcTable[(crc ^ b) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

interface Chunk {
  type: string;
  data: Uint8Array;
}

export function isPng(bytes: Uint8Array): boolean {
  return PNG_SIGNATURE.every((b, i) => bytes[i] === b);
}

function readChunks(bytes: Uint8Array): Chunk[] {
  if (!isPng(bytes)) throw new CardError("Not a PNG file");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: Chunk[] = [];
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = latin1.decode(bytes.subarray(offset + 4, offset + 8));
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    chunks.push({ type, data });
    offset += 12 + length;
    if (type === "IEND") break;
  }
  return chunks;
}

function writeChunks(chunks: Chunk[]): Uint8Array {
  const size = 8 + chunks.reduce((n, c) => n + 12 + c.data.length, 0);
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  out.set(PNG_SIGNATURE, 0);
  let offset = 8;
  for (const chunk of chunks) {
    const typeBytes = utf8.encode(chunk.type);
    view.setUint32(offset, chunk.data.length);
    out.set(typeBytes, offset + 4);
    out.set(chunk.data, offset + 8);
    const crcInput = new Uint8Array(4 + chunk.data.length);
    crcInput.set(typeBytes, 0);
    crcInput.set(chunk.data, 4);
    view.setUint32(offset + 8 + chunk.data.length, crc32(crcInput));
    offset += 12 + chunk.data.length;
  }
  return out;
}

/** Reads tEXt (and uncompressed iTXt) chunks into a keyword → text map. */
export function readPngText(bytes: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { type, data } of readChunks(bytes)) {
    if (type === "tEXt") {
      const sep = data.indexOf(0);
      if (sep > 0) out[latin1.decode(data.subarray(0, sep))] = latin1.decode(data.subarray(sep + 1));
    } else if (type === "iTXt") {
      // keyword \0 compressionFlag compressionMethod languageTag \0 translatedKeyword \0 text
      const sep = data.indexOf(0);
      if (sep <= 0 || data[sep + 1] !== 0) continue;
      let pos = sep + 3;
      pos = data.indexOf(0, pos) + 1;
      pos = data.indexOf(0, pos) + 1;
      if (pos > 0) out[latin1.decode(data.subarray(0, sep))] = fromUtf8.decode(data.subarray(pos));
    }
  }
  return out;
}

function textChunk(keyword: string, text: string): Chunk {
  const k = utf8.encode(keyword);
  const t = utf8.encode(text); // base64 is plain ASCII, so this is valid latin1
  const data = new Uint8Array(k.length + 1 + t.length);
  data.set(k, 0);
  data.set(t, k.length + 1);
  return { type: "tEXt", data };
}

// ---- JSON shapes ----

const str = (v: unknown) => (typeof v === "string" ? v : "");
const strList = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** Normalises any V1, V2 or V3 card JSON into our card shape. */
export function parseCardJson(input: unknown): CharacterCard {
  if (!input || typeof input !== "object") throw new CardError("Card data isn't a JSON object");
  const root = input as Record<string, unknown>;
  const spec = str(root.spec);
  const isWrapped = spec === "chara_card_v2" || spec === "chara_card_v3" || (root.data && typeof root.data === "object" && !root.name);
  const d = (isWrapped ? root.data : root) as Record<string, unknown>;

  const card: CharacterCard = {
    ...emptyCard(),
    // V1 cards from older tools sometimes use Pygmalion-style field names.
    name: str(d.name) || str(d.char_name),
    description: str(d.description) || str(d.char_persona),
    personality: str(d.personality),
    scenario: str(d.scenario) || str(d.world_scenario),
    first_mes: str(d.first_mes) || str(d.char_greeting),
    mes_example: str(d.mes_example) || str(d.example_dialogue),
    alternate_greetings: strList(d.alternate_greetings),
    system_prompt: str(d.system_prompt),
    post_history_instructions: str(d.post_history_instructions),
    creator_notes: str(d.creator_notes) || str(d.creatorcomment),
    creator: str(d.creator),
    character_version: str(d.character_version),
    tags: strList(d.tags),
    extensions: d.extensions && typeof d.extensions === "object" ? (d.extensions as Record<string, unknown>) : {},
  };
  if (d.character_book) card.character_book = d.character_book;
  if (typeof d.nickname === "string" && d.nickname) card.nickname = d.nickname;
  if (Array.isArray(d.group_only_greetings)) card.group_only_greetings = strList(d.group_only_greetings);
  if (Array.isArray(d.source)) card.source = strList(d.source);
  if (typeof d.creation_date === "number") card.creation_date = d.creation_date;
  if (typeof d.modification_date === "number") card.modification_date = d.modification_date;

  if (!card.name.trim()) throw new CardError("This card has no character name");
  return card;
}

export function toV2Json(card: CharacterCard) {
  const { nickname, group_only_greetings, source, creation_date, modification_date, ...v2 } = card;
  return {
    spec: "chara_card_v2",
    spec_version: "2.0",
    // V1 fields at the top level keep very old readers happy.
    name: card.name,
    description: card.description,
    personality: card.personality,
    scenario: card.scenario,
    first_mes: card.first_mes,
    mes_example: card.mes_example,
    data: v2,
  };
}

export function toV3Json(card: CharacterCard) {
  return {
    spec: "chara_card_v3",
    spec_version: "3.0",
    data: {
      ...card,
      group_only_greetings: card.group_only_greetings ?? [],
      modification_date: Math.floor(Date.now() / 1000),
    },
  };
}

/** Pulls the character out of a card PNG. Returns null for plain images. */
export function extractCardFromPng(bytes: Uint8Array): CharacterCard | null {
  const text = readPngText(bytes);
  for (const key of ["ccv3", "chara"]) {
    const raw = text[key];
    if (!raw) continue;
    try {
      return parseCardJson(JSON.parse(fromUtf8.decode(base64ToBytes(raw))));
    } catch (err) {
      if (key === "chara" || !text.chara) throw err instanceof CardError ? err : new CardError(`Couldn't read the card data (${(err as Error).message})`);
    }
  }
  return null;
}

/** Returns a copy of the PNG with the card embedded (old card chunks replaced). */
export function embedCardInPng(png: Uint8Array, card: CharacterCard, { v3 = true } = {}): Uint8Array {
  const chunks = readChunks(png).filter((c) => {
    if (c.type !== "tEXt") return true;
    const sep = c.data.indexOf(0);
    const key = latin1.decode(c.data.subarray(0, sep)).toLowerCase();
    return key !== "chara" && key !== "ccv3";
  });
  const encode = (obj: unknown) => bytesToBase64(utf8.encode(JSON.stringify(obj)));
  const iend = chunks.findIndex((c) => c.type === "IEND");
  const added = [textChunk("chara", encode(toV2Json(card)))];
  if (v3) added.push(textChunk("ccv3", encode(toV3Json(card))));
  chunks.splice(iend < 0 ? chunks.length : iend, 0, ...added);
  return writeChunks(chunks);
}

/** Removes embedded card data so a card PNG can be stored as a plain avatar. */
export function stripCardFromPng(png: Uint8Array): Uint8Array {
  return writeChunks(
    readChunks(png).filter((c) => {
      if (c.type !== "tEXt" && c.type !== "iTXt") return true;
      const key = latin1.decode(c.data.subarray(0, c.data.indexOf(0))).toLowerCase();
      return key !== "chara" && key !== "ccv3";
    }),
  );
}
