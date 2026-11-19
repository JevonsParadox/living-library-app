"use client";

/**
 * Add-to-Universe CTA: fetch top provider candidates, let the user pick one,
 * create a shell work, and return the new bookId to the caller.
 *
 * Used by NebulaSearch (zero-results CTA), NebulaBarcodeScan (ISBN-miss),
 * and NebulaUploadPanel (unmatched CSV rows).
 */

import { useEffect, useState } from "react";
import { X, Sparkles, BookPlus } from "lucide-react";
import {
  createShellFromProvider,
  previewAddCandidates,
  resolveIsbnOrShell,
  type CreatedShell,
  type ProviderCandidate,
} from "@/app/(nebula)/nebula/actions";

type Seed =
  | { kind: "title"; title: string; author?: string }
  | { kind: "isbn"; isbn: string };

export interface AddToUniverseDialogProps {
  seed: Seed;
  onClose: () => void;
  onAdded: (shell: CreatedShell) => void;
}

export function AddToUniverseDialog({ seed, onClose, onAdded }: AddToUniverseDialogProps) {
  const [candidates, setCandidates] = useState<ProviderCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creatingIdx, setCreatingIdx] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (seed.kind === "title") {
          const { candidates } = await previewAddCandidates(seed.title, seed.author);
          if (!cancelled) setCandidates(candidates);
        } else {
          // ISBN path: try existing universe first (non-creating), then if
          // missing fetch providers directly by ISBN.
          const existing = await resolveIsbnOrShell(seed.isbn, { createIfMiss: false });
          if (cancelled) return;
          if (existing.shell) {
            onAdded(existing.shell);
            onClose();
            return;
          }
          // Use previewAddCandidates via ISBN as query; both providers accept that.
          const { candidates } = await previewAddCandidates(seed.isbn);
          if (!cancelled) setCandidates(candidates);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Lookup failed");
      }
    })();
    return () => { cancelled = true; };
  }, [seed, onAdded, onClose]);

  async function handlePick(idx: number) {
    if (!candidates) return;
    setCreatingIdx(idx);
    const { shell, error } = await createShellFromProvider(candidates[idx]);
    if (error || !shell) {
      setError(error ?? "Could not create shell");
      setCreatingIdx(null);
      return;
    }
    onAdded(shell);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-[28rem] max-h-[80vh] overflow-y-auto rounded-xl border border-white/15 bg-[#0A0E14] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Sparkles size={14} className="text-accent" />
              Add to your universe
            </h2>
            <p className="text-[11px] text-muted mt-0.5">
              {seed.kind === "title"
                ? `Looking up “${seed.title}”…`
                : `Looking up ISBN ${seed.isbn}…`}
            </p>
          </div>
          <button onClick={onClose} className="text-muted hover:text-foreground">
            <X size={16} />
          </button>
        </div>

        {error && (
          <div className="text-[11px] text-red-400 mb-2">{error}</div>
        )}

        {!candidates && !error && (
          <div className="text-xs text-muted animate-pulse py-4 text-center">
            Checking OpenLibrary and Google Books…
          </div>
        )}

        {candidates && candidates.length === 0 && !error && (
          <div className="text-xs text-muted py-4 text-center">
            Nothing found. Try a different title or spelling.
          </div>
        )}

        {candidates && candidates.length > 0 && (
          <ul className="space-y-2">
            {candidates.map((c, i) => (
              <li key={`${c.provider}-${c.provider_record_id}`}>
                <button
                  onClick={() => handlePick(i)}
                  disabled={creatingIdx !== null}
                  className="w-full text-left flex gap-3 rounded-lg border border-white/10 bg-white/5 p-2.5 hover:bg-white/10 disabled:opacity-60 transition"
                >
                  {c.coverUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={c.coverUrl}
                      alt={c.title}
                      className="w-12 h-16 object-cover rounded shrink-0"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                  ) : (
                    <div className="w-12 h-16 rounded bg-white/5 shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-foreground truncate">{c.title}</p>
                    <p className="text-[11px] text-muted truncate">
                      {c.authorName ?? "Unknown author"}
                      {c.year ? ` · ${c.year}` : ""}
                    </p>
                    {c.description && (
                      <p className="text-[10px] text-muted/70 mt-1 line-clamp-2">{c.description}</p>
                    )}
                    <p className="text-[9px] text-accent/60 mt-1 uppercase tracking-wider">
                      via {c.provider === "openlibrary" ? "OpenLibrary" : "Google Books"}
                      {creatingIdx === i ? " · creating…" : ""}
                    </p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="text-[10px] text-muted/60 mt-4 flex items-center gap-1">
          <BookPlus size={10} />
          Picking one adds it to the shared universe — the next person to search it will find it instantly.
        </p>
      </div>
    </div>
  );
}
