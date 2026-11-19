"use client";

/**
 * Centred low-glow prompt visible only when the user has zero shelf books.
 * Single-shot: once the shelf grows past zero, the prompt fades out (600 ms)
 * and never returns even if the user later removes everything. The dim
 * universe + region planets do the rest of the work; this is just the
 * explicit invitation to upload.
 *
 * State machine:
 *   "armed"    initial render. We haven't observed an empty shelf yet.
 *   "showing"  observed empty shelf at least once; render the prompt.
 *   "fading"   shelf grew past 0; render the prompt at opacity 0 for 600 ms.
 *   "done"     unmounted. Never returns.
 */

import { useEffect, useState } from "react";
import { useNebula } from "@/lib/nebula/nebula-context";
import { BookPlus } from "lucide-react";

type Phase = "armed" | "showing" | "fading" | "done";

export function EmptyShelfPrompt() {
  const { userLibrary, setShowUploadPanel } = useNebula();
  const [phase, setPhase] = useState<Phase>("armed");

  useEffect(() => {
    const isEmpty = userLibrary.size === 0;
    // Phase transitions are tied to a real external signal — userLibrary.size
    // changing — and each transition advances at most once before reaching
    // a terminal state. The lint rule's concern (cascading renders) doesn't
    // apply here: the depth is 1 and the dependency only changes when shelf
    // size actually changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPhase((current) => {
      if (current === "done") return current;
      if (current === "armed" && isEmpty) return "showing";
      if (current === "showing" && !isEmpty) return "fading";
      return current;
    });
  }, [userLibrary.size]);

  useEffect(() => {
    if (phase !== "fading") return;
    const t = setTimeout(() => setPhase("done"), 600);
    return () => clearTimeout(t);
  }, [phase]);

  if (phase === "armed" || phase === "done") return null;

  return (
    <div
      className={`pointer-events-none fixed inset-0 z-30 flex items-center justify-center transition-opacity duration-[600ms] ${
        phase === "fading" ? "opacity-0" : "opacity-100"
      }`}
    >
      <div className="text-center pointer-events-auto">
        <p className="text-white/70 text-sm tracking-wide mb-4">
          Add your first book to begin exploring
        </p>
        <button
          onClick={() => setShowUploadPanel(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 border border-white/20 backdrop-blur-md text-white/80 hover:bg-white/15 hover:text-white transition-colors text-xs"
        >
          <BookPlus size={14} />
          Add a book
        </button>
      </div>
    </div>
  );
}
