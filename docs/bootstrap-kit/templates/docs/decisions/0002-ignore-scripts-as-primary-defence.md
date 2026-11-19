# ADR-0002: `ignore-scripts=true` as primary supply-chain defence
Date: (set when you adopt this in your project)
Status: Accepted

## Context
Shai-Hulud's exfil payload runs via `postinstall` scripts during `npm install`. Blocking script execution removes the dominant attack vector regardless of which package gets compromised. Most packages that legitimately need install scripts (typically those with native bindings — `sharp`, `esbuild`, `fsevents`, `better-sqlite3`, etc.) ship platform-specific binaries via `optionalDependencies` as a non-script fallback that works under this policy.

## Decision
`.npmrc` sets `ignore-scripts=true` repo-wide. `vercel.json` extends it to CI with `"installCommand": "npm ci --ignore-scripts"`. Future packages that genuinely need scripts get a one-off explicit `--ignore-scripts=false` per install (and a note in the PR explaining why), never a default flip. `CLAUDE.md`'s Security Rules capture this hard rule.

## Consequences
A future legitimate package that doesn't ship binaries via `optionalDependencies` won't work until manually allowed. The trade-off is acceptable — the alternative is a permanently open hole that requires zero attacker creativity to exploit.
