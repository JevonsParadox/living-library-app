# ADR-002: `ignore-scripts=true` as primary supply-chain defence
Date: 2026-05-14
Status: Accepted

## Context
Shai-Hulud's exfil payload runs via `postinstall` scripts during `npm install`. Blocking script execution removes the dominant attack vector regardless of which package gets compromised. The five packages in the current lockfile that have install scripts (`@clerk/shared`, `esbuild`, `fsevents`, `sharp`, `unrs-resolver`) all ship platform-specific binaries via `optionalDependencies`, which works without scripts — the scripts are fallbacks for older systems we don't have.

## Decision
`.npmrc` sets `ignore-scripts=true` repo-wide. `vercel.json` extends it to CI with `"installCommand": "npm ci --ignore-scripts"`. Future packages that genuinely need scripts get a one-off explicit `--ignore-scripts=false` per install, never a default flip. CLAUDE.md's Security Rules capture this hard rule.

## Consequences
A future legitimate package that doesn't ship binaries via `optionalDependencies` won't work until manually allowed. The trade-off is acceptable — the alternative is a permanently open hole that requires zero attacker creativity to exploit.
