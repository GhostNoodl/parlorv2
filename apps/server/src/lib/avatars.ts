import { isPng, stripCardFromPng } from "@parlor/shared";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { dataDir } from "./paths";

export type AvatarKind = "characters" | "personas";

const MAX_AVATAR_BYTES = 8 * 1024 * 1024;

function avatarPath(kind: AvatarKind, ownerId: string): string {
  const dir = resolve(dataDir, "avatars", kind);
  mkdirSync(dir, { recursive: true });
  // ids are UUIDs we generate, but never trust them as path segments.
  return resolve(dir, `${ownerId.replace(/[^a-zA-Z0-9-]/g, "")}.png`);
}

/** URL the UI uses for an avatar; the version busts browser caches. */
export function avatarUrl(kind: AvatarKind, ownerId: string): string {
  return `/api/${kind}/${ownerId}/avatar?v=${Date.now()}`;
}

/** Saves a PNG avatar (with any embedded card data removed). */
export function saveAvatar(kind: AvatarKind, ownerId: string, png: Uint8Array): string {
  if (png.length > MAX_AVATAR_BYTES) throw new AvatarError("That image is too big (8 MB max).");
  if (!isPng(png)) throw new AvatarError("Avatars must be PNG images.");
  writeFileSync(avatarPath(kind, ownerId), stripCardFromPng(png));
  return avatarUrl(kind, ownerId);
}

export function readAvatar(kind: AvatarKind, ownerId: string): Buffer | null {
  const path = avatarPath(kind, ownerId);
  return existsSync(path) ? readFileSync(path) : null;
}

export function deleteAvatar(kind: AvatarKind, ownerId: string) {
  rmSync(avatarPath(kind, ownerId), { force: true });
}

export class AvatarError extends Error {}

// ---- a tiny PNG encoder, for cards exported without an avatar ----

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc ^= b;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function hsl(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

/** A soft diagonal gradient in the character's colour, 400×600 like most cards. */
export function placeholderPng(name: string, width = 400, height = 600): Uint8Array {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  const from = hsl(hue, 0.75, 0.72);
  const to = hsl((hue + 50) % 360, 0.65, 0.45);

  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const t = (x / width + y / height) / 2;
      const i = row + 1 + x * 3;
      raw[i] = from[0] + (to[0] - from[0]) * t;
      raw[i + 1] = from[1] + (to[1] - from[1]) * t;
      raw[i + 2] = from[2] + (to[2] - from[2]) * t;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: RGB
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
