/**
 * Update nb_regions with shorter, cleaner names.
 * Usage: npx tsx scripts/nebula/update-region-names.ts
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(__dirname, "../../.env.local") });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const RENAMES: Record<string, string> = {
  "Mythic & Folkloric Fantasy": "Mythic Fantasy",
  "Cozy & Heartwarming Fantasy": "Cozy Fantasy",
  "Urban & Contemporary Fantasy": "Urban Fantasy",
  "Epic & Secondary World Fantasy": "Epic Fantasy",
  "Grimdark & Dark Political Fantasy": "Grimdark",
  "Romantasy & Court Fantasy": "Romantasy",
  "Science Fantasy Borderlands": "Science Fantasy",
  "Dystopian & Post-Apocalyptic": "Dystopian",
  "First Contact & Philosophical SF": "First Contact",
  "Space Opera & Galactic Adventure": "Space Opera",
  "Military SF & Strategy": "Military SF",
  "Hard SF & Technical Speculation": "Hard SF",
  "Cyberpunk & Near Future Tech": "Cyberpunk",
  "Weird & Experimental Speculative": "Weird Fiction",
};

async function run() {
  for (const [oldName, newName] of Object.entries(RENAMES)) {
    const { error } = await supabase
      .from("nb_regions")
      .update({ name: newName })
      .eq("name", oldName);
    if (error) console.error(`Failed: ${oldName} → ${newName}:`, error.message);
    else console.log(`${oldName} → ${newName}`);
  }
  console.log("Done");
}

run().catch(console.error);
