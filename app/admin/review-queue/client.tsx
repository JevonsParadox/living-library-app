"use client";

import { useState, useTransition, useCallback } from "react";
import {
  dismissReviewItem,
  listReviewQueue,
  mergeReviewItem,
  type ReviewQueueItem,
  type ReviewQueueBookSide,
} from "@/app/(nebula)/nebula/actions";
import { ArrowLeftRight, X, Check, Trash2, Sparkles } from "lucide-react";

type Status = "pending" | "merged" | "dismissed";

const TIMESTAMP_FMT = new Intl.DateTimeFormat("en-AU", {
  timeZone: "Australia/Sydney",
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function fmtTs(iso: string): string {
  return TIMESTAMP_FMT.format(new Date(iso));
}

interface Props {
  initial: { items: ReviewQueueItem[]; total: number; error?: string };
  initialStatus: Status;
}

export function ReviewQueueClient({ initial, initialStatus }: Props) {
  const [status, setStatus] = useState<Status>(initialStatus);
  const [items, setItems] = useState<ReviewQueueItem[]>(initial.items);
  const [total, setTotal] = useState(initial.total);
  const [error, setError] = useState<string | null>(initial.error ?? null);
  const [isPending, startTransition] = useTransition();
  const [actingOn, setActingOn] = useState<string | null>(null);

  const refresh = useCallback((next: Status) => {
    startTransition(async () => {
      const res = await listReviewQueue({ status: next, limit: 50 });
      setItems(res.items);
      setTotal(res.total);
      setError(res.error ?? null);
      setStatus(next);
    });
  }, []);

  const handleMerge = async (item: ReviewQueueItem, keep: "left" | "right") => {
    if (!item.canonical || !item.duplicate) return;
    setActingOn(item.id);
    const res = await mergeReviewItem(item.id, keep);
    setActingOn(null);
    if (!res.ok) {
      setError(res.error ?? "merge failed");
      return;
    }
    setItems((prev) => prev.filter((x) => x.id !== item.id));
    setTotal((t) => Math.max(0, t - 1));
  };

  const handleDismiss = async (item: ReviewQueueItem) => {
    setActingOn(item.id);
    const res = await dismissReviewItem(item.id);
    setActingOn(null);
    if (!res.ok) {
      setError(res.error ?? "dismiss failed");
      return;
    }
    setItems((prev) => prev.filter((x) => x.id !== item.id));
    setTotal((t) => Math.max(0, t - 1));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1">
        {(["pending", "merged", "dismissed"] as Status[]).map((s) => (
          <button
            key={s}
            onClick={() => refresh(s)}
            className={`text-xs px-3 py-1.5 rounded-full transition-colors ${
              status === s
                ? "bg-white/15 text-white"
                : "bg-white/5 text-white/50 hover:bg-white/10 hover:text-white/80"
            }`}
          >
            {s}
          </button>
        ))}
        <span className="text-[10px] text-muted ml-3">
          {isPending ? "loading…" : `${total} ${status}`}
        </span>
      </div>

      {error && (
        <div className="text-xs text-red-400 px-3 py-2 rounded bg-red-500/10 border border-red-500/20">
          {error}
        </div>
      )}

      {items.length === 0 && !isPending && (
        <p className="text-xs text-muted">No items.</p>
      )}

      <ul className="space-y-3">
        {items.map((item) => (
          <li
            key={item.id}
            className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3"
          >
            <div className="flex items-center justify-between">
              <div className="text-[11px] text-muted">
                <span className="text-accent/80">{item.source}</span>
                {item.similarity != null ? ` · sim ${item.similarity.toFixed(3)}` : ""}
                {item.signal_breakdown
                  ? ` · ${formatBreakdown(item.signal_breakdown)}`
                  : ""}
              </div>
              <div className="text-[10px] text-muted/60">
                {fmtTs(item.created_at)}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <BookCard side={item.canonical} label="Canonical" />
              <BookCard
                side={item.duplicate}
                incoming={item.duplicate ? null : item.incoming}
                label="Duplicate"
              />
            </div>

            {status === "pending" && (
              <div className="flex flex-wrap gap-2 pt-1">
                {item.canonical && item.duplicate ? (
                  <>
                    <button
                      onClick={() => handleMerge(item, "left")}
                      disabled={actingOn === item.id}
                      className="text-[11px] px-3 py-1.5 rounded-full bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 transition-colors disabled:opacity-50 inline-flex items-center gap-1.5"
                    >
                      <ArrowLeftRight size={11} /> Merge → keep left
                    </button>
                    <button
                      onClick={() => handleMerge(item, "right")}
                      disabled={actingOn === item.id}
                      className="text-[11px] px-3 py-1.5 rounded-full bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 transition-colors disabled:opacity-50 inline-flex items-center gap-1.5"
                    >
                      <ArrowLeftRight size={11} /> Merge → keep right
                    </button>
                  </>
                ) : (
                  <span className="text-[11px] text-muted italic">
                    Cannot merge — only one side resolves to a work
                  </span>
                )}
                <button
                  onClick={() => handleDismiss(item)}
                  disabled={actingOn === item.id}
                  className="text-[11px] px-3 py-1.5 rounded-full bg-white/5 text-white/60 hover:bg-white/10 transition-colors disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  <X size={11} /> Distinct works (dismiss)
                </button>
              </div>
            )}

            {status !== "pending" && (
              <div className="text-[10px] text-muted pt-1 inline-flex items-center gap-1">
                {status === "merged" ? <Check size={10} className="text-emerald-400" /> : <Trash2 size={10} />}
                {status} {item.resolved_at ? `· ${fmtTs(item.resolved_at)}` : ""}
                {item.resolved_by ? ` · ${item.resolved_by.slice(0, 12)}…` : ""}
                {item.notes ? ` · ${item.notes}` : ""}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

interface BookCardProps {
  side: ReviewQueueBookSide | null;
  incoming?: ReviewQueueItem["incoming"];
  label: string;
}

function BookCard({ side, incoming, label }: BookCardProps) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/2 p-3 flex gap-3 min-h-[100px]">
      {side?.cover_image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={side.cover_image_url}
          alt=""
          className="w-12 h-16 rounded object-cover shrink-0"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
      ) : (
        <div className="w-12 h-16 rounded bg-white/5 shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[9px] text-muted uppercase tracking-widest mb-0.5">{label}</p>
        {side ? (
          <>
            <p className="text-xs text-foreground truncate">{side.title}</p>
            <p className="text-[11px] text-muted truncate">
              {side.author_name ?? "Unknown author"}
              {side.publication_year ? ` · ${side.publication_year}` : ""}
            </p>
            <p className="text-[10px] text-muted/70 mt-1">
              pop {side.popularity_score.toFixed(0)}
              {" · "}eng {side.engagement_score.toFixed(1)}
              {side.isbn_13 ? ` · ${side.isbn_13}` : side.isbn_10 ? ` · ${side.isbn_10}` : ""}
            </p>
            <p className="text-[9px] text-muted/40 mt-0.5 truncate">id {side.id.slice(0, 12)}…</p>
          </>
        ) : incoming ? (
          <>
            <p className="text-xs text-foreground truncate inline-flex items-center gap-1">
              <Sparkles size={10} className="text-accent" />
              {incoming.title ?? "Unknown"}
            </p>
            <p className="text-[11px] text-muted truncate">{incoming.author ?? "Unknown author"}</p>
            <p className="text-[10px] text-muted/70 mt-1">
              {incoming.isbn_13 ?? "no ISBN"}
            </p>
            <p className="text-[9px] text-muted/40 italic">incoming · not yet a work</p>
          </>
        ) : (
          <p className="text-[11px] text-muted/40 italic">missing — possibly already merged</p>
        )}
      </div>
    </div>
  );
}

function formatBreakdown(b: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(b)) {
    if (typeof v === "number") parts.push(`${k} ${v.toFixed(2)}`);
  }
  return parts.join(" · ");
}
