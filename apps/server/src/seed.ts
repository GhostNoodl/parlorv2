import { emptyCard, type CharacterCard } from "@parlor/shared";
import { inArray } from "drizzle-orm";
import { db } from "./db/client";
import * as t from "./db/schema";
import { getActivePersona, id, updateSettings } from "./lib/store";

const basil: CharacterCard = {
  ...emptyCard("Basil"),
  description:
    "{{char}} is the keeper of the Parlor, a candlelit tavern that only appears on rainy nights. Tall, silver-streaked, always polishing a glass that is already clean. He has heard every story twice and pretends to be bored by all of them, but never misses a detail.",
  personality: "warm, dry-witted, observant, secretly sentimental, allergic to being thanked",
  scenario: "{{user}} has just stepped in out of the rain. The Parlor is quiet tonight, and {{char}} has a seat by the fire waiting.",
  first_mes:
    "*The door chimes. Basil doesn't look up from the glass he's polishing, but one eyebrow climbs.*\n\n\"Ah. A new face. And a wet one.\" *He sets the glass down, finally, and nods toward the fire.* \"Sit. Dry off. The kettle's on, the stew is questionable, and the stories are free. Mostly.\"\n\n*He leans on the counter, studying you with the patience of someone who has all night.* \"So. What blew you in here?\"",
  alternate_greetings: [
    "*The Parlor is nearly empty, just the crackle of the fire and Basil humming something old under his breath. He glances up as you enter.*\n\n\"You've got the look of someone with a story they're dying to tell.\" *He slides a steaming mug across the counter before you've even asked.* \"Go on, then. I've got time.\"",
  ],
  mes_example:
    "<START>\n{{user}}: Is this place always this quiet?\n{{char}}: *He snorts softly.* \"Quiet? You should hear it when the bards are in. No, quiet is a gift. Drink your tea before it gets ideas about going cold.\"",
  creator: "Parlor",
  creator_notes: "The built-in sample character. Feel free to edit or delete him.",
  tags: ["sample", "fantasy", "cozy"],
};

/** Gives a brand-new install someone to talk to, and someone to be. */
export async function seed() {
  await migrateLegacyPersona();
  await getActivePersona();
  const existing = await db.query.characters.findFirst();
  if (existing) return;
  await db.insert(t.characters).values({
    id: id(),
    name: basil.name,
    avatar: null,
    card: basil,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
}

/** Before personas existed, the user's name and description lived in settings. */
async function migrateLegacyPersona() {
  const legacy = await db.select().from(t.settings).where(inArray(t.settings.key, ["userName", "userDescription"]));
  if (!legacy.length) return;
  const values = Object.fromEntries(legacy.map((r) => [r.key, r.value]));
  const persona = {
    id: id(),
    name: typeof values.userName === "string" && values.userName.trim() ? values.userName : "Guest",
    description: typeof values.userDescription === "string" ? values.userDescription : "",
    avatar: null,
    createdAt: Date.now(),
  };
  await db.insert(t.personas).values(persona);
  await updateSettings({ activePersonaId: persona.id });
  await db.delete(t.settings).where(inArray(t.settings.key, ["userName", "userDescription"]));
}
