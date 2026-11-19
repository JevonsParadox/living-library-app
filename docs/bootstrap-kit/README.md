# Bootstrap Kit

A drop-in starter pack for new **Next.js (App Router) + Supabase + Clerk + Vercel** projects, derived from Living Library's security hardening + documentation work. Includes pre-baked security configs, pre-commit hooks, an ADR template, behavioural rules for Claude Code, and a 9-step setup walkthrough.

## When to use

Starting a new product / side project and you want, on day one:

- Supply-chain hardening (`.npmrc ignore-scripts`, Socket Firewall in CI, pinned sensitive deps, Dependabot, pre-commit secret blocking, JWT-template failure surfaced loudly)
- Documentation patterns (`CLAUDE.md` "Where things live", `docs/decisions/` ADRs, `hindsight.md`, `primer.md`)
- Behavioural rules for Claude Code (Security Rules, plan-before-implementation, push-back on big refactors, logical commit splits)

## How to use

1. Read [`SETUP.md`](./SETUP.md) end-to-end before starting — you'll be clicking through Supabase, Clerk, Vercel, GitHub, and Socket dashboards.
2. Copy `templates/*` into your new project's repo (`cp -r .../bootstrap-kit/templates/. /path/to/new-project/`).
3. Find/replace placeholders across the copied files:
   - `{{PROJECT_NAME}}`
   - `{{PROJECT_DESCRIPTION}}`
   - `{{PROJECT_TAGLINE}}`
   - `{{SUPABASE_PROJECT_REF}}`
   - `{{VERCEL_PROJECT_REF}}`
   - `{{GITHUB_OWNER_REPO}}`
4. Walk through `SETUP.md` step-by-step.

Estimated time to "first commit on green main": **~45 minutes** if you know the stack.

## What's included

| Path | Purpose |
|---|---|
| `templates/CLAUDE.md` | Project constitution shell + security rules + Claude behavioural rules |
| `templates/primer.md` | Session warm-up template |
| `templates/hindsight.md` | ~12 universal lessons + ~12 universal anti-patterns |
| `templates/.npmrc` | `ignore-scripts=true` (primary supply-chain defence) |
| `templates/.gitignore` | Next/Vercel/Supabase/Clerk patterns |
| `templates/.env.example` | Empty-keys template (Clerk + Supabase + AI placeholders) |
| `templates/vercel.json` | `installCommand` pinned through Socket Firewall |
| `templates/.github/dependabot.yml` | Weekly grouped npm + actions PRs |
| `templates/.github/workflows/socket-security.yml` | Socket Firewall scans every PR + push |
| `templates/.githooks/pre-commit` | Blocks `.env*`, secret patterns, non-npmjs lockfile resolves |
| `templates/scripts/install-git-hooks.sh` | One-line hook installer |
| `templates/docs/decisions/README.md` | ADR index + format spec |
| `templates/docs/decisions/0001-0004*.md` | Four universal starter ADRs |
| `templates/docs/security/supply-chain.md` | Full security policy (project-agnostic) |
| `templates/docs/roadmap.md` | Phase A–F template |

## What's NOT included (and why)

- **No schemas or migrations.** Project-specific. The kit only includes the *pattern* (RLS in same migration as table — see ADR-0003) and naming convention (`00001_init.sql`, `00002_*`, etc.).
- **No specific dep versions.** They rot fast — a pinned version inside a template is worse than no version. The template's `package.json` notes are in `SETUP.md`'s Step 8; pin your own based on what's current at scaffold time.
- **No seed data.** New projects don't have any yet; add when needed.
- **No design tokens / Tailwind config.** Project-specific aesthetic choices.
- **No Three.js / R3F / force-graph.** Living Library-specific stack — most projects don't need 3D.

## Versioning

This kit lives inside `living-library` at `docs/bootstrap-kit/`. When we learn something new in Living Library, update both the source and this kit in the same commit. If it stabilises and grows useful, migrate to a standalone GitHub template repo and use `gh repo create --template`.

## Maintenance contract

Treat the kit as a *minimum viable starter*. Every new project will discover something missing — when that happens:

1. Fix it in the new project.
2. Decide if the lesson is universal (carries to *every* future project) or project-specific.
3. If universal, port the fix back to this kit + this Living Library copy.
4. Commit both in the same change.
