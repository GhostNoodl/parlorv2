import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { resolve } from "node:path";
import { dataDir, migrationsDir } from "../lib/paths";
import * as schema from "./schema";

const client = createClient({ url: `file:${resolve(dataDir, "parlor.db")}` });

export const db = drizzle(client, { schema });

export async function initDb() {
  await client.execute("PRAGMA foreign_keys = ON");
  await client.execute("PRAGMA journal_mode = WAL");
  await migrate(db, { migrationsFolder: migrationsDir });
}
