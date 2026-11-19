"use client";

/**
 * Orchestrator. Picks the 2D or 3D scene based on `viewMode` from context,
 * and mounts the HTML overlays that are shared across both modes (search,
 * detail panel, attribution footer, action buttons, etc.).
 */

import { useRef, useCallback, useEffect } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useNebula } from "@/lib/nebula/nebula-context";
import { NebulaView3D } from "./NebulaView3D";
import { NebulaView2D } from "./NebulaView2D";
import { BookDetailPanel } from "./BookDetailPanel";
import { NebulaSearch } from "./NebulaSearch";
import { AttributionFooter } from "./AttributionFooter";
import { SpacingSlider } from "./SpacingSlider";
import { ViewModeToggle } from "./ViewModeToggle";
import { NebulaUploadPanel } from "./NebulaUploadPanel";
import { PathBooksTray } from "./PathBooksTray";
import { NebulaCompass } from "./NebulaCompass";
import { NebulaPathStats } from "./NebulaPathStats";
import { SimilarReadsTray } from "./SimilarReadsTray";
import { TasteProfilePanel } from "./TasteProfilePanel";
import { BridgeBooksPill } from "./BridgeBooksPill";
import { EmptyShelfPrompt } from "./EmptyShelfPrompt";
import { MissingRegionsBanner } from "./MissingRegionsBanner";
import { computeNebulaPath } from "@/app/(nebula)/nebula/actions";
import { Upload, BookOpen, Route, Globe } from "lucide-react";

/** Wide centred view — drives the Galaxy button. Mirrors the HOME_TARGET
 *  constant inside nebula-context so the button delivers exactly the same
 *  framing as the initial render. */
const GALAXY_HOME: { x: number; y: number; z: number; cameraDistance: number } = {
  x: 0,
  y: 0,
  z: 0,
  cameraDistance: 4,
};

export function NebulaView() {
  const {
    books, regions,
    flyToBook,
    showMyShelf, setShowMyShelf,
    showUploadPanel, setShowUploadPanel,
    showPath, setShowPath, setUserPath,
    userLibrary, userPath,
    viewMode,
    setFlyTarget,
    setSelectedBook,
  } = useNebula();
  const is3D = viewMode === "3d";

  // Deep link from /library: ?book=<id> → fly to it once, then strip the param
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const handledBookParam = useRef<string | null>(null);
  useEffect(() => {
    const bookParam = searchParams.get("book");
    if (!bookParam || handledBookParam.current === bookParam) return;
    if (books.length === 0) return; // wait for data
    handledBookParam.current = bookParam;
    flyToBook(bookParam);
    router.replace(pathname, { scroll: false });
  }, [searchParams, books, flyToBook, router, pathname]);

  const handleTogglePath = useCallback(async () => {
    if (showPath) {
      setShowPath(false);
      return;
    }
    setShowPath(true);
    const path = await computeNebulaPath();
    setUserPath(path);
  }, [showPath, setShowPath, setUserPath]);

  return (
    <div className="relative w-full h-full">
      {/* Render mode swap. Both views fill the parent. The key forces a clean
          remount on mode change; the wrapper fades in so the swap doesn't
          snap. We don't keep the inactive view mounted because the 3D R3F
          tree and the 2D force-graph are both heavy — mounting only one at
          a time keeps idle CPU near zero. */}
      <div
        key={viewMode}
        className="w-full h-full animate-in fade-in duration-200"
      >
        {is3D ? <NebulaView3D /> : <NebulaView2D />}
      </div>

      {/* HTML overlays shared across both modes */}
      <AttributionFooter />
      <ViewModeToggle />
      <NebulaSearch />
      <BookDetailPanel />
      <NebulaUploadPanel />
      <PathBooksTray />
      <SimilarReadsTray />
      <BridgeBooksPill />
      <NebulaPathStats />
      <TasteProfilePanel />
      <EmptyShelfPrompt />
      <MissingRegionsBanner />

      {/* 3D-specific UI: spacing slider + compass don't apply in 2D. */}
      {is3D && <SpacingSlider />}
      {is3D && <NebulaCompass />}

      {/* Stats */}
      <div className="absolute top-4 left-4 z-10 pointer-events-none">
        <p className="text-[10px] text-white/40">
          {books.length.toLocaleString()} books · {regions.length} regions
          {userLibrary.size > 0 && ` · ${userLibrary.size} on shelf`}
          {showPath && userPath.length > 0 && ` · ${userPath.length} on path`}
        </p>
      </div>

      {/* Top-right buttons */}
      <div className="absolute top-4 right-4 z-20 pointer-events-auto flex gap-1.5">
        <button
          onClick={() => {
            // Clear any lingering selection so OrbitControls + the HTML
            // detail panel don't snap right back to it on the next frame.
            setSelectedBook(null);
            setFlyTarget(GALAXY_HOME);
          }}
          className="flex items-center gap-1 px-2.5 py-1 text-[10px] rounded-full backdrop-blur-md bg-white/10 text-white/70 border border-white/20 hover:bg-white/15 hover:text-white transition-all"
          title="Back to galaxy view"
        >
          <Globe size={10} />
          Galaxy
        </button>
        {userLibrary.size > 0 && (
          <button
            onClick={handleTogglePath}
            className={`flex items-center gap-1 px-2.5 py-1 text-[10px] rounded-full backdrop-blur-md transition-all ${
              showPath
                ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                : "bg-white/10 text-white/70 border border-white/20 hover:bg-white/15 hover:text-white"
            }`}
          >
            <Route size={10} />
            Path
          </button>
        )}
        <button
          onClick={() => setShowMyShelf(!showMyShelf)}
          className={`flex items-center gap-1 px-2.5 py-1 text-[10px] rounded-full backdrop-blur-md transition-all ${
            showMyShelf
              ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
              : "bg-white/10 text-white/70 border border-white/20 hover:bg-white/15 hover:text-white"
          }`}
        >
          <BookOpen size={10} />
          My Shelf
        </button>
        <button
          onClick={() => setShowUploadPanel(!showUploadPanel)}
          className={`flex items-center gap-1 px-2.5 py-1 text-[10px] rounded-full backdrop-blur-md transition-all ${
            showUploadPanel
              ? "bg-white/20 text-white border border-white/30"
              : "bg-white/10 text-white/70 border border-white/20 hover:bg-white/15 hover:text-white"
          }`}
        >
          <Upload size={10} />
          Upload
        </button>
      </div>
    </div>
  );
}
