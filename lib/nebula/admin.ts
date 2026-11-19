/**
 * Admin gate for /admin/* routes.
 *
 * Uses an env-var allowlist of Clerk user IDs. Solo-dev appropriate; replace
 * with Clerk roles when there's more than one admin.
 */

import { auth } from "@clerk/nextjs/server";

export async function isAdmin(): Promise<boolean> {
  const { userId } = await auth();
  if (!userId) return false;
  const allow = (process.env.ADMIN_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return allow.includes(userId);
}

export async function requireAdmin(): Promise<{ userId: string }> {
  const { userId } = await auth();
  if (!userId) throw new Error("not authenticated");
  const allow = (process.env.ADMIN_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!allow.includes(userId)) throw new Error("not authorised");
  return { userId };
}
