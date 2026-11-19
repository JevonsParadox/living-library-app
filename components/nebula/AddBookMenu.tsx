"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Plus, Check } from "lucide-react";
import { addToNebulaShelf, type AddToShelfOptions } from "@/app/(nebula)/nebula/actions";
import { useNebula } from "@/lib/nebula/nebula-context";
import type { BookOwnership, BookStatus } from "@/lib/nebula/nebula-types";

interface Option {
  label: string;
  ownership: BookOwnership;
  status: BookStatus;
  color: string;
  needsDate?: boolean;
}

const OPTIONS: Option[] = [
  { label: "Read", ownership: "owned", status: "read", color: "#FFD700", needsDate: true },
  { label: "Reading", ownership: "owned", status: "reading", color: "#34D399" },
  { label: "Up next", ownership: "owned", status: "next_up", color: "#F59E0B" },
  { label: "On shelf", ownership: "owned", status: "unread", color: "#38BDF8" },
  { label: "Wishlist", ownership: "wishlist", status: "unread", color: "#C084FC" },
];

interface AddBookMenuProps {
  bookId: string;
  /** Optional callback fired after successful add */
  onAdded?: () => void;
  /** Visual size — "sm" for tray cards, "md" for detail panel */
  size?: "sm" | "md";
  /** Layout direction for the popover */
  align?: "start" | "end";
}

export function AddBookMenu({ bookId, onAdded, size = "sm", align = "start" }: AddBookMenuProps) {
  const { addToShelf } = useNebula();
  const [open, setOpen] = useState(false);
  const [pendingDateFor, setPendingDateFor] = useState<Option | null>(null);
  const [draftDate, setDraftDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setPendingDateFor(null);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const performAdd = useCallback(async (opts: AddToShelfOptions, optimisticPartial: Partial<{ ownership: BookOwnership; status: BookStatus; readAt: string | null }>) => {
    setBusy(true);
    const res = await addToNebulaShelf(bookId, opts);
    if (res.success) {
      addToShelf(bookId, optimisticPartial);
      setOpen(false);
      setPendingDateFor(null);
      onAdded?.();
    } else {
      console.error("[AddBookMenu] failed:", res.error);
    }
    setBusy(false);
  }, [bookId, addToShelf, onAdded]);

  const handleOptionClick = useCallback(async (opt: Option) => {
    if (opt.needsDate) {
      setPendingDateFor(opt);
      return;
    }
    await performAdd(
      { ownership: opt.ownership, status: opt.status },
      { ownership: opt.ownership, status: opt.status }
    );
  }, [performAdd]);

  const handleDateSave = useCallback(async () => {
    if (!pendingDateFor || !draftDate) return;
    await performAdd(
      { ownership: pendingDateFor.ownership, status: pendingDateFor.status, read_at: draftDate },
      { ownership: pendingDateFor.ownership, status: pendingDateFor.status, readAt: draftDate }
    );
  }, [pendingDateFor, draftDate, performAdd]);

  const triggerSize = size === "sm" ? "p-1 text-[9px]" : "px-2 py-1 text-[10px]";
  const iconSize = size === "sm" ? 10 : 12;

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        className={`${triggerSize} text-accent hover:text-accent/80 flex items-center gap-0.5`}
        disabled={busy}
        aria-label="Add to library"
      >
        <Plus size={iconSize} />
        {size === "md" && "Add"}
      </button>

      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className={`absolute bottom-full mb-1 ${align === "end" ? "right-0" : "left-0"} z-30 backdrop-blur-md bg-[#0A0E14]/95 border border-white/10 rounded-lg p-1.5 shadow-lg min-w-[140px]`}
        >
          {pendingDateFor ? (
            <div className="space-y-1.5">
              <p className="text-[9px] text-white/50 px-1">When did you read it?</p>
              <input
                type="date"
                value={draftDate}
                onChange={(e) => setDraftDate(e.target.value)}
                max={new Date().toISOString().slice(0, 10)}
                className="text-[10px] bg-surface-solid border border-border/30 rounded px-1.5 py-0.5 text-foreground w-full"
                disabled={busy}
              />
              <div className="flex justify-end gap-1">
                <button
                  onClick={() => { setPendingDateFor(null); setDraftDate(new Date().toISOString().slice(0, 10)); }}
                  className="text-[9px] text-white/40 hover:text-white/70 px-1.5 py-0.5"
                  disabled={busy}
                >
                  Back
                </button>
                <button
                  onClick={handleDateSave}
                  className="text-[9px] text-amber-300 hover:text-amber-200 px-1.5 py-0.5 flex items-center gap-0.5"
                  disabled={busy || !draftDate}
                >
                  <Check size={10} />
                  Save
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {OPTIONS.map((opt) => (
                <button
                  key={opt.label}
                  onClick={() => handleOptionClick(opt)}
                  disabled={busy}
                  className="flex items-center gap-2 px-2 py-1 rounded text-[10px] text-white/70 hover:bg-white/5 hover:text-white text-left"
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ background: opt.color }}
                  />
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
