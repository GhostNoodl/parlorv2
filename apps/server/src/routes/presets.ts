import { defaultPromptBlocks, normalizeBlocks, parsePresetJson, PresetError, toPresetFile } from "@parlor/shared";
import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/client";
import * as t from "../db/schema";
import { getActivePreset, getSettings, id, updateSettings } from "../lib/store";

const blockSchema = z.object({
  id: z.string().max(100).optional(),
  kind: z.enum(["text", "main", "character", "persona", "examples", "history", "postHistory"]),
  name: z.string().max(200).default(""),
  enabled: z.boolean().default(true),
  content: z.string().max(100_000).default(""),
});

const presetSchema = z.object({
  name: z.string().trim().min(1).max(100),
  blocks: z.array(blockSchema).max(100),
});

const findPreset = (presetId: string) => db.query.presets.findFirst({ where: eq(t.presets.id, presetId) });

async function insertPreset(name: string, blocks: z.infer<typeof blockSchema>[]) {
  const row = { id: id(), name, blocks: normalizeBlocks(blocks), createdAt: Date.now(), updatedAt: Date.now() };
  await db.insert(t.presets).values(row);
  return row;
}

export const presetRoutes = new Hono()
  .get("/", async (c) => {
    await getActivePreset(); // makes sure at least one exists
    return c.json(await db.select().from(t.presets).orderBy(asc(t.presets.createdAt)));
  })

  .post("/", async (c) => {
    const body = presetSchema.partial({ blocks: true }).parse(await c.req.json());
    return c.json(await insertPreset(body.name, body.blocks ?? defaultPromptBlocks()), 201);
  })

  .post("/import", async (c) => {
    const { fileName, data } = z.object({ fileName: z.string().max(300).default(""), data: z.unknown() }).parse(await c.req.json());
    const fallback = fileName.replace(/\.json$/i, "").trim() || "Imported preset";
    try {
      const parsed = parsePresetJson(data, fallback);
      return c.json(await insertPreset(parsed.name.slice(0, 100), parsed.blocks), 201);
    } catch (err) {
      if (err instanceof PresetError) return c.json({ error: err.message }, 400);
      throw err;
    }
  })

  .get("/:id/export", async (c) => {
    const preset = await findPreset(c.req.param("id"));
    if (!preset) return c.json({ error: "Preset not found" }, 404);
    const file = `${preset.name.replace(/[^\w\- ]+/g, "").trim() || "preset"}.json`;
    c.header("Content-Disposition", `attachment; filename="${file}"`);
    return c.json(toPresetFile(preset));
  })

  .post("/:id/duplicate", async (c) => {
    const preset = await findPreset(c.req.param("id"));
    if (!preset) return c.json({ error: "Preset not found" }, 404);
    return c.json(await insertPreset(`${preset.name} (copy)`.slice(0, 100), preset.blocks), 201);
  })

  .patch("/:id", async (c) => {
    const preset = await findPreset(c.req.param("id"));
    if (!preset) return c.json({ error: "Preset not found" }, 404);
    const patch = presetSchema.partial().parse(await c.req.json());
    const next = {
      name: patch.name ?? preset.name,
      blocks: patch.blocks ? normalizeBlocks(patch.blocks) : preset.blocks,
      updatedAt: Date.now(),
    };
    await db.update(t.presets).set(next).where(eq(t.presets.id, preset.id));
    return c.json({ ...preset, ...next });
  })

  .delete("/:id", async (c) => {
    const presetId = c.req.param("id");
    const all = await db.select({ id: t.presets.id }).from(t.presets);
    if (all.length <= 1) return c.json({ error: "Keep at least one preset." }, 400);
    await db.delete(t.presets).where(eq(t.presets.id, presetId));
    const settings = await getSettings();
    if (settings.activePresetId === presetId) await updateSettings({ activePresetId: null });
    await getActivePreset();
    return c.body(null, 204);
  });
