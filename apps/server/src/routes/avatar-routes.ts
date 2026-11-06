import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { db } from "../db/client";
import * as t from "../db/schema";
import { AvatarError, deleteAvatar, readAvatar, saveAvatar, type AvatarKind } from "../lib/avatars";

/** Reads one uploaded file from a multipart body. */
export async function uploadedFile(c: Context, field = "file"): Promise<File | null> {
  const body = await c.req.parseBody();
  const value = body[field];
  return value instanceof File ? value : null;
}

const tables = { characters: t.characters, personas: t.personas } as const;

/** GET / PUT / DELETE handlers for an owner's avatar image. */
export function avatarHandlers(kind: AvatarKind) {
  const table = tables[kind];
  const exists = async (ownerId: string) =>
    Boolean((await db.select({ id: table.id }).from(table).where(eq(table.id, ownerId)).limit(1))[0]);

  return {
    get: (c: Context) => {
      const png = readAvatar(kind, c.req.param("id")!);
      if (!png) return c.json({ error: "No avatar" }, 404);
      return c.body(new Uint8Array(png), 200, { "Content-Type": "image/png", "Cache-Control": "public, max-age=31536000, immutable" });
    },
    put: async (c: Context) => {
      const ownerId = c.req.param("id")!;
      if (!(await exists(ownerId))) return c.json({ error: "Not found" }, 404);
      const file = await uploadedFile(c);
      if (!file) return c.json({ error: "Attach an image as `file`." }, 400);
      try {
        const avatar = saveAvatar(kind, ownerId, new Uint8Array(await file.arrayBuffer()));
        await db.update(table).set({ avatar }).where(eq(table.id, ownerId));
        return c.json({ avatar });
      } catch (err) {
        if (err instanceof AvatarError) return c.json({ error: err.message }, 400);
        throw err;
      }
    },
    delete: async (c: Context) => {
      const ownerId = c.req.param("id")!;
      deleteAvatar(kind, ownerId);
      await db.update(table).set({ avatar: null }).where(eq(table.id, ownerId));
      return c.body(null, 204);
    },
  };
}
