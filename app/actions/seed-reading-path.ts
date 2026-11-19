"use server";

import { auth } from "@clerk/nextjs/server";
import { createAuthClient } from "@/lib/supabase-server";
import { revalidatePath } from "next/cache";

/**
 * Update existing "read" edges with staggered read_at dates over the past 2 years.
 * If no read edges exist, converts some owned books to read status.
 */
export async function seedReadingPath(): Promise<{
  updated: number;
  error?: string;
}> {
  const { userId } = await auth();
  if (!userId) return { updated: 0, error: "Not authenticated" };

  const supabase = await createAuthClient();

  // Get all read edges
  const { data: readEdges } = await supabase
    .from("edges")
    .select("id, target_id, metadata")
    .eq("source_type", "user")
    .eq("source_id", userId)
    .eq("target_type", "book")
    .eq("edge_type", "read");

  let toUpdate = readEdges ?? [];

  // If no read edges, convert some owned books
  if (toUpdate.length === 0) {
    const { data: ownedEdges } = await supabase
      .from("edges")
      .select("id, target_id")
      .eq("source_type", "user")
      .eq("source_id", userId)
      .eq("target_type", "book")
      .eq("edge_type", "owns");

    if (!ownedEdges || ownedEdges.length === 0) {
      return { updated: 0, error: "No books found" };
    }

    // Convert 20 random owned → read
    const shuffled = [...ownedEdges].sort(() => Math.random() - 0.5).slice(0, 20);
    for (const edge of shuffled) {
      await supabase.from("edges").delete().eq("id", edge.id);
      await supabase.from("edges").insert({
        source_type: "user",
        source_id: userId,
        target_type: "book",
        target_id: edge.target_id,
        edge_type: "read",
        metadata: {},
      });
    }

    // Re-fetch the read edges we just created
    const { data: newReadEdges } = await supabase
      .from("edges")
      .select("id, target_id, metadata")
      .eq("source_type", "user")
      .eq("source_id", userId)
      .eq("target_type", "book")
      .eq("edge_type", "read");

    toUpdate = newReadEdges ?? [];
  }

  // Stagger read_at dates over the past 2 years
  const now = Date.now();
  const twoYearsAgo = now - 2 * 365 * 24 * 60 * 60 * 1000;
  const count = toUpdate.length;

  let updated = 0;
  for (let i = 0; i < count; i++) {
    const edge = toUpdate[i];
    const baseTime = twoYearsAgo + ((i + 0.5) / count) * (now - twoYearsAgo);
    const jitter = (Math.random() - 0.5) * 14 * 24 * 60 * 60 * 1000;
    const readAt = new Date(baseTime + jitter).toISOString();

    const { error } = await supabase
      .from("edges")
      .update({ metadata: { ...(edge.metadata as object ?? {}), read_at: readAt } })
      .eq("id", edge.id);

    if (!error) updated++;
  }

  revalidatePath("/universe");
  return { updated };
}
