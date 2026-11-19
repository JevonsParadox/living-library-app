"use client";

/**
 * Permanent site-wide attribution for the compounding catalog. Small, muted,
 * bottom-of-Nebula row. Legal requirement for ISFDB CC BY 4.0 attribution.
 */

export function AttributionFooter() {
  return (
    <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 pointer-events-auto">
      <p className="text-[9px] text-white/25 text-center max-w-xl px-2 leading-relaxed">
        Genre metadata ©{" "}
        <a
          href="https://www.isfdb.org"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-white/60"
        >
          ISFDB
        </a>
        {" "}contributors,{" "}
        <a
          href="https://creativecommons.org/licenses/by/4.0/"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-white/60"
        >
          CC BY 4.0
        </a>
        . Editions from OpenLibrary + Google Books. Descriptions AI-paraphrased.
      </p>
    </div>
  );
}
