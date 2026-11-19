"use client";

import { useCallback, useState } from "react";
import { CameraCapture } from "@/components/CameraCapture";
import { scanSpine } from "@/app/actions/scan-spine";
import { matchNebulaBooks, type MatchResult } from "@/app/(nebula)/nebula/actions";
import { NebulaCsvReview } from "./NebulaCsvReview";

type Phase = "idle" | "capturing" | "scanning" | "matching" | "review" | "error";

interface Props {
  onDone: () => void;
}

export function NebulaSpineScan({ onDone }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [matches, setMatches] = useState<MatchResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleCapture = useCallback(async (images: Blob[]) => {
    if (images.length === 0) {
      setPhase("idle");
      return;
    }

    setError(null);
    setPhase("scanning");

    // 1. Send images to Claude Vision for spine reading
    const formData = new FormData();
    images.forEach((blob, i) => formData.append("images", blob, `spine-${i}.jpg`));
    const scan = await scanSpine(formData);
    if (scan.error) {
      setError(scan.error);
      setPhase("error");
      return;
    }
    if (scan.results.length === 0) {
      setError("No book spines detected. Try a clearer photo.");
      setPhase("error");
      return;
    }

    // 2. Match each spine against the Nebula corpus
    setPhase("matching");
    const candidates = scan.results.map((r) => ({
      title: r.title,
      author: r.author && r.author !== "Unknown" ? r.author : undefined,
    }));
    const results = await matchNebulaBooks(candidates);
    setMatches(results);
    setPhase("review");
  }, []);

  const reset = useCallback(() => {
    setPhase("idle");
    setMatches(null);
    setError(null);
  }, []);

  if (phase === "idle") {
    return (
      <div className="space-y-2">
        <p className="text-[10px] text-muted">
          Take a photo or short video of your bookshelf. Claude reads the spines and matches them to the Nebula.
        </p>
        <p className="text-[9px] text-muted/50">
          Up to ~20 books per scan · costs a few cents per scan
        </p>
        <button
          onClick={() => setPhase("capturing")}
          className="w-full px-3 py-1.5 text-[10px] rounded-full bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 transition-colors border border-emerald-500/30"
        >
          Start a scan
        </button>
      </div>
    );
  }

  if (phase === "capturing") {
    return <CameraCapture onCapture={handleCapture} onCancel={reset} />;
  }

  if (phase === "scanning") {
    return <p className="text-[10px] text-muted animate-pulse">Reading spines…</p>;
  }

  if (phase === "matching") {
    return <p className="text-[10px] text-muted animate-pulse">Matching against the Nebula…</p>;
  }

  if (phase === "error") {
    return (
      <div className="space-y-2">
        <p className="text-[10px] text-red-400">{error ?? "Something went wrong."}</p>
        <button
          onClick={reset}
          className="text-[10px] text-accent hover:text-accent/80"
        >
          Try again
        </button>
      </div>
    );
  }

  if (phase === "review" && matches) {
    return (
      <NebulaCsvReview
        matches={matches}
        onDone={() => { reset(); onDone(); }}
      />
    );
  }

  return null;
}
