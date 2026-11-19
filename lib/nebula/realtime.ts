"use client";

/**
 * Supabase realtime subscriptions for Nebula book detail updates.
 *
 * Subscribes to nb_books + nb_enrichment_status changes for a specific
 * work_id; the worker's inserts/updates land in the UI without a refresh.
 *
 * Uses Clerk's supabase-template JWT so RLS's "authenticated" policy matches.
 */

import { useEffect, useRef } from "react";
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { useAuth } from "@clerk/nextjs";

export interface BookPatch {
  title?: string;
  description?: string | null;
  short_description?: string | null;
  cover_image_url?: string | null;
  publication_year?: number | null;
  page_count?: number | null;
  canonical_genre?: string | null;
}

export interface StatusPatch {
  metadata_status?: string;
  embedding_status?: string;
  coords_status?: string;
  cover_status?: string;
}

export interface BookSubscriptionCallbacks {
  onBookUpdate?: (patch: BookPatch) => void;
  onStatusUpdate?: (patch: StatusPatch) => void;
}

// One client per (Clerk token) cache-key — creating a new one per panel mount
// would exhaust Supabase's concurrent connection quota.
const clientCache = new Map<string, SupabaseClient>();

function getClient(token: string | null): SupabaseClient {
  const key = token ?? "__anon__";
  const cached = clientCache.get(key);
  if (cached) return cached;
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    token
      ? {
          global: { headers: { Authorization: `Bearer ${token}` } },
          realtime: { params: { apikey: token } },
        }
      : undefined,
  );
  clientCache.set(key, client);
  return client;
}

/**
 * Hook form: subscribes to a book's realtime updates for the component's
 * lifetime. Unsubscribes on unmount or when bookId changes.
 */
export function useNebulaBookRealtime(
  bookId: string | null,
  callbacks: BookSubscriptionCallbacks,
): void {
  const { getToken, isSignedIn } = useAuth();
  const channelRef = useRef<RealtimeChannel | null>(null);
  const callbacksRef = useRef(callbacks);
  // Keep the ref in sync with the latest callbacks in a layout effect so the
  // subscription handlers always call the current one without reconnecting.
  useEffect(() => {
    callbacksRef.current = callbacks;
  }, [callbacks]);

  useEffect(() => {
    if (!bookId || !isSignedIn) return;
    let cancelled = false;

    (async () => {
      const token = await getToken({ template: "supabase" });
      if (cancelled) return;

      const client = getClient(token);
      const channel = client
        .channel(`nebula-book-${bookId}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "nb_books",
            filter: `id=eq.${bookId}`,
          },
          (payload) => {
            const row = payload.new as Record<string, unknown>;
            callbacksRef.current.onBookUpdate?.({
              title: row.title as string | undefined,
              description: (row.description as string | null | undefined) ?? null,
              short_description:
                (row.short_description as string | null | undefined) ?? null,
              cover_image_url:
                (row.cover_image_url as string | null | undefined) ?? null,
              publication_year:
                (row.publication_year as number | null | undefined) ?? null,
              page_count: (row.page_count as number | null | undefined) ?? null,
              canonical_genre:
                (row.canonical_genre as string | null | undefined) ?? null,
            });
          },
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "nb_enrichment_status",
            filter: `work_id=eq.${bookId}`,
          },
          (payload) => {
            const row = payload.new as Record<string, unknown>;
            callbacksRef.current.onStatusUpdate?.({
              metadata_status: row.metadata_status as string | undefined,
              embedding_status: row.embedding_status as string | undefined,
              coords_status: row.coords_status as string | undefined,
              cover_status: row.cover_status as string | undefined,
            });
          },
        )
        .subscribe();

      channelRef.current = channel;
    })();

    return () => {
      cancelled = true;
      const ch = channelRef.current;
      if (ch) {
        ch.unsubscribe();
        channelRef.current = null;
      }
    };
  }, [bookId, isSignedIn, getToken]);
}
