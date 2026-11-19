import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { cache } from "react";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // setAll can fail in Server Components (read-only cookies).
            // This is expected — it works in Route Handlers and Server Actions.
          }
        },
      },
    }
  );
}

// Cached per request — avoids fetching Clerk JWT multiple times in one render.
//
// If the Clerk token exchange fails (transient API blip, expired session,
// missing template), we still return a working anon Supabase client. RLS will
// then enforce: read-global tables continue to load, user-scoped writes fail
// loudly with a clear "row violates RLS policy" error rather than a generic
// ClerkAPIResponseError that surfaces as a server-component crash.
export const createAuthClient = cache(async () => {
  let token: string | null = null;
  try {
    const { getToken } = await auth();
    token = await getToken({ template: "supabase" });
  } catch (err) {
    console.warn(
      "[supabase-server] Clerk getToken failed; falling back to anon client:",
      err instanceof Error ? err.message : err,
    );
  }

  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    token
      ? { global: { headers: { Authorization: `Bearer ${token}` } } }
      : undefined,
  );
});

/**
 * Service-role client for server actions that need to write to the shared,
 * compounding catalog tables (nb_books, nb_authors, nb_editions,
 * nb_enrichment_*, nb_book_coordinates, etc). Bypasses RLS — the server
 * action is responsible for authenticating the caller via Clerk first.
 *
 * DO NOT use this for user-scoped writes (nb_user_books, ratings, shelf
 * state) — those should go through createAuthClient so RLS enforces the
 * user_id boundary.
 */
export function createServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}
