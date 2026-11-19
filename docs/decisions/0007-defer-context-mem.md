# ADR-007: Defer context-mem adoption; use built-in memory + ADRs instead
Date: 2026-05-15
Status: Accepted

## Context
Evaluated `jubakitiashvili/context-mem` (MCP server promising "99% token savings" via local markdown vault + 4-tier compression of tool-call history). The architecture is interesting: 3 deps, no install scripts, MIT, local-only, MCP-isolated. But the project is 8 weeks old with 31 versions, 12 stars, 4 forks, single independent maintainer on a gmail account. The promise is plausible; the maturity isn't.

## Decision
Defer. Use Claude Code's built-in `MEMORY.md` + auto-saved memory files (already configured at `~/.claude/projects/.../memory/`), plus a "Where things live" map in `CLAUDE.md`, plus `docs/decisions/` ADRs (this directory) to cover the same ground — cross-session memory + decision retention + codebase navigation. Zero supply-chain risk. Plain-text, version-controlled, in our trust boundary.

## Consequences
We don't get context-mem's compression of full tool-call history; if that proves valuable in 6 months we revisit. Trigger to revisit: context-mem reaches stable v5+, 200+ stars, a `SECURITY.md`, and either an audit or a co-maintainer. Logged in this ADR so we don't re-litigate.
