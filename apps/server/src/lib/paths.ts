import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export const repoRoot = resolve(here, "../../../..");
export const dataDir = resolve(process.env.PARLOR_DATA_DIR ?? resolve(repoRoot, "data"));
export const migrationsDir = resolve(here, "../../drizzle");
export const webDistDir = resolve(repoRoot, "apps/web/dist");

mkdirSync(dataDir, { recursive: true });
