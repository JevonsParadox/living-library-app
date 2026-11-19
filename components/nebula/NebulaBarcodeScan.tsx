"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { BookOpen, Check, Sparkles } from "lucide-react";
import { lookupNebulaBookByIsbn, type CreatedShell, type NebulaIsbnLookupResult } from "@/app/(nebula)/nebula/actions";
import { useNebula } from "@/lib/nebula/nebula-context";
import { AddBookMenu } from "./AddBookMenu";
import { AddToUniverseDialog } from "./AddToUniverseDialog";

// BarcodeDetector isn't in TS lib by default
interface BarcodeDetectorResult { rawValue: string }
interface BarcodeDetectorInstance { detect: (source: HTMLVideoElement) => Promise<BarcodeDetectorResult[]> }
interface BarcodeDetectorConstructor { new (opts: { formats: string[] }): BarcodeDetectorInstance }

interface FoundBook extends NebulaIsbnLookupResult {
  status: "added" | "ready";
}

interface ScanMessage {
  id: number;
  text: string;
  type: "info" | "error";
}

export function NebulaBarcodeScan() {
  const { isOnShelf, addBookToGalaxy } = useNebula();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanningRef = useRef(true);
  const recentRef = useRef(new Set<string>());
  const messageIdRef = useRef(0);

  const [found, setFound] = useState<FoundBook | null>(null);
  const [messages, setMessages] = useState<ScanMessage[]>([]);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isLooking, setIsLooking] = useState(false);
  const [missIsbn, setMissIsbn] = useState<string | null>(null);

  const pushMessage = useCallback((text: string, type: "info" | "error") => {
    const id = ++messageIdRef.current;
    setMessages((m) => [...m.slice(-2), { id, text, type }]);
    setTimeout(() => setMessages((m) => m.filter((x) => x.id !== id)), 3500);
  }, []);

  const handleDetection = useCallback(async (isbn: string) => {
    if (recentRef.current.has(isbn)) return;
    recentRef.current.add(isbn);
    setTimeout(() => recentRef.current.delete(isbn), 5000);

    setIsLooking(true);
    const res = await lookupNebulaBookByIsbn(isbn);
    setIsLooking(false);

    if (res.error) {
      pushMessage(`ISBN ${isbn}: ${res.error}`, "error");
      return;
    }
    if (!res.book) {
      // Not in the universe. Instead of dead-ending, offer Add-to-Universe.
      setMissIsbn(isbn);
      return;
    }
    setFound({ ...res.book, status: isOnShelf(res.book.bookId) ? "added" : "ready" });
  }, [pushMessage, isOnShelf]);

  const handleShellAdded = useCallback((shell: CreatedShell) => {
    if (shell.justCreated && shell.x !== null && shell.y !== null && shell.z !== null) {
      addBookToGalaxy({
        id: shell.bookId,
        title: shell.title,
        canonical_genre: shell.canonicalGenre,
        popularity_score: shell.popularityScore,
        engagement_score: 0,
        cover_image_url: shell.coverUrl,
        publication_year: shell.publicationYear,
        page_count: shell.pageCount,
        author_name: shell.authorName,
        series_id: shell.seriesId,
        series_order: shell.seriesOrder,
        x: shell.x,
        y: shell.y,
        z: shell.z,
        region_id: shell.regionId,
      });
    }
    setFound({
      bookId: shell.bookId,
      title: shell.title,
      authorName: shell.authorName,
      coverUrl: shell.coverUrl,
      isbn13: null,
      isbn10: null,
      status: "ready",
    });
    pushMessage(
      shell.justCreated ? `Added ${shell.title} to the universe — enriching…` : `Found ${shell.title}`,
      "info",
    );
  }, [addBookToGalaxy, pushMessage]);

  // Camera + detector loop
  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      } catch {
        setCameraError("Camera access denied. Please allow camera permissions.");
        return;
      }

      const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
      if (!Detector) {
        setCameraError("Barcode detection isn't supported in this browser yet. Try Chrome, Edge, or Brave.");
        return;
      }

      const detector = new Detector({ formats: ["ean_13", "ean_8"] });

      async function loop() {
        if (!scanningRef.current || !videoRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          for (const c of codes) {
            if (c.rawValue && c.rawValue.length >= 10) {
              await handleDetection(c.rawValue);
            }
          }
        } catch {
          // detection error per frame — ignore
        }
        timeoutId = setTimeout(loop, 500);
      }

      videoRef.current?.addEventListener("loadeddata", () => loop(), { once: true });
    }

    start();

    return () => {
      cancelled = true;
      scanningRef.current = false;
      if (timeoutId) clearTimeout(timeoutId);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [handleDetection]);

  if (cameraError) {
    return <p className="text-[10px] text-red-400">{cameraError}</p>;
  }

  return (
    <div className="space-y-2">
      <div className="relative rounded-lg overflow-hidden bg-black aspect-video">
        <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-40 h-20 border-2 border-accent/40 rounded-lg" />
        </div>
        {isLooking && (
          <div className="absolute top-2 right-2 flex items-center gap-1.5 bg-black/60 rounded-full px-2 py-1">
            <div className="w-2 h-2 border border-accent/50 border-t-accent rounded-full animate-spin" />
            <span className="text-[10px] text-white">Looking up…</span>
          </div>
        )}
      </div>

      <p className="text-[10px] text-muted text-center">Point the camera at a book&apos;s ISBN-13 barcode</p>

      {/* Found-book confirm card */}
      {found && (
        <div className="rounded-lg border border-border/30 bg-foreground/3 p-2 flex items-start gap-2">
          {found.coverUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={found.coverUrl}
              alt=""
              className="w-10 h-14 rounded object-cover shrink-0"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          ) : (
            <div className="w-10 h-14 rounded bg-surface-solid border border-border/20 flex items-center justify-center shrink-0">
              <BookOpen size={10} className="text-muted/30" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-xs text-foreground truncate">{found.title}</p>
            <p className="text-[10px] text-muted truncate">{found.authorName ?? ""}</p>
            <div className="mt-1">
              {found.status === "added" ? (
                <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                  <Check size={10} /> Already in your library
                </span>
              ) : (
                <AddBookMenu
                  bookId={found.bookId}
                  size="md"
                  onAdded={() => {
                    pushMessage(`Added ${found.title}`, "info");
                    setFound((f) => f ? { ...f, status: "added" } : f);
                  }}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Not-in-universe CTA */}
      {missIsbn && (
        <div className="rounded-lg border border-accent/30 bg-accent/5 p-2 flex items-start gap-2">
          <Sparkles size={14} className="text-accent shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-foreground">ISBN {missIsbn} isn&apos;t in this universe yet</p>
            <p className="text-[10px] text-muted mt-0.5">We can add it from OpenLibrary or Google Books.</p>
          </div>
          <button
            onClick={() => {/* dialog opens via state below */}}
            className="text-[10px] text-accent hover:text-accent/80 shrink-0"
          >
            Add
          </button>
        </div>
      )}
      {missIsbn && (
        <AddToUniverseDialog
          seed={{ kind: "isbn", isbn: missIsbn }}
          onClose={() => setMissIsbn(null)}
          onAdded={(shell) => {
            handleShellAdded(shell);
            setMissIsbn(null);
          }}
        />
      )}

      {/* Toasts */}
      {messages.map((m) => (
        <div
          key={m.id}
          className={`text-[10px] px-2.5 py-1.5 rounded-lg ${
            m.type === "error" ? "bg-red-500/10 text-red-400" : "bg-emerald-500/10 text-emerald-400"
          }`}
        >
          {m.text}
        </div>
      ))}
    </div>
  );
}
