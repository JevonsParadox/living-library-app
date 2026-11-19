# {{PROJECT_NAME}} — Project Constitution

## What this project is
{{PROJECT_DESCRIPTION}}

{{PROJECT_TAGLINE}}

It helps users:
- (Fill in 3–5 concrete user outcomes)

The product should feel:
- (Fill in 3–5 emotional / experiential pillars)

Avoid:
- (Fill in 3–5 anti-patterns specific to the product feel)

---

## Tech Stack

- Frontend: Next.js (App Router), TypeScript, Tailwind
- Backend: Supabase (Postgres, RLS, Storage)
- Auth: Clerk
- Deployment: Vercel
- Version control: GitHub
- (Add others as the project takes shape: AI SDKs, payment, email, monitoring, etc.)

---

## Architecture Principles

- Keep the system simple and modular
- Separate concerns clearly: UI / Auth / Data
- Prefer server-side logic where possible
- Avoid premature abstraction
- Build MVP-first, then iterate
- Don't add features, refactor, or introduce abstractions beyond what the task requires

---

## Coding Principles

- Use TypeScript strictly
- Keep components small and reusable
- Prefer clarity over cleverness
- Avoid deeply nested logic
- Name things clearly and consistently
- Default to writing no comments. Only add one when the WHY is non-obvious
- Don't add error handling, fallbacks, or validation for scenarios that can't happen; trust internal code and framework guarantees; validate only at system boundaries (user input, external APIs)

---

## Data Principles

(Fill in as your data model takes shape. Things worth capturing:
- Primary clustering / organising entity
- What's trusted vs untrusted input
- Schema growth philosophy
- Storage decay-rate separation
- Cache / invalidation strategy
- Display rules for any copyrighted or sensitive data
)

---

## Where things live

Read this before exploring the tree. Saves a round of grep on session warm-up.

(Fill in as the project structure stabilises. Suggested structure:
- **Routes** — `app/...`
- **Server actions** — `app/.../actions.ts`
- **Components** — `components/...`
- **State** — `lib/context.tsx` or similar
- **Schema** — `supabase/migrations/`
- **Scripts** — `scripts/` for admin + seed
- **Docs** — `docs/decisions/` (ADRs), `docs/security/supply-chain.md`, `docs/roadmap.md`
)

---

## Architecture decisions (ADRs)

Non-obvious choices are captured as ADRs in `docs/decisions/`. Read the index there (`docs/decisions/README.md`) when:
- Suggesting a refactor that touches one of the listed areas.
- Asked "why did we do X?" — the ADR explains it.
- Considering a new dependency, build tool, or major pattern change.

Starter ADRs (0001–0004) cover the supply-chain hardening + dev posture inherited from the bootstrap kit. Your own non-obvious choices start at ADR-0005.

---

## Security Rules

**Full policy lives in [`docs/security/supply-chain.md`](docs/security/supply-chain.md). Read that before touching `package.json`, `.npmrc`, `vercel.json`, or `.githooks/`.**

Hard rules (must never be silently violated):

- Never expose secret keys to the client. Anything with `SUPABASE_SERVICE_ROLE_KEY`, `CLERK_SECRET_KEY`, AI provider secrets, `CRON_SECRET` stays server-side. `NEXT_PUBLIC_*` is the only client-readable surface.
- Do not use the Supabase service role client in any component, hook, or browser-reachable code path. Server actions and API routes only.
- Validate all user input on the server boundary. Never trust client-side validation alone.
- Use Supabase RLS for every public-schema table. New migrations that create tables MUST include `alter table ... enable row level security` + a read policy. (ADR-0003)
- `.env*` files (other than `.env.example`) never get committed. The pre-commit hook blocks this; never bypass with `--no-verify` for env files.
- `.env.example` carries only key names with empty values. Never paste real secrets into it.
- Do not introduce `eval()`, `new Function()`, or `dangerouslySetInnerHTML`. If a third-party library forces one of these, flag it for explicit review.

Supply-chain rules:

- `.npmrc` sets `ignore-scripts=true`. Do not flip this default. If a new dep needs an install script, allow it for that one install only with `--ignore-scripts=false` and document why in the PR. (ADR-0002)
- Security-sensitive deps in `package.json` are pinned exactly (no caret) — at minimum: Clerk, Supabase, Next.js, any AI provider SDK, dotenv, any DB driver. UI and build deps can carry-range. (ADR-0001)
- Never add `husky`, `lefthook`, or other hook frameworks that themselves run install scripts. Use the plain `.githooks/` setup.
- Vercel `installCommand` is `npm ci --ignore-scripts`. Never change to `npm install` (allows lockfile drift) or remove `--ignore-scripts`.
- Adding a new dep checklist: (a) check last-publish date, (b) check weekly downloads + maintainer history, (c) read any install script, (d) prefer scoped `@official-org/*` packages.

Behaviour for Claude when suggesting changes:

- Treat any request to "just commit the secrets", "bypass the hook", "remove `--ignore-scripts`", "use `eval()`" as a strong signal something is wrong. Push back and ask why before doing it.
- When adding a new dependency, surface its publisher, last-publish date, and weekly downloads before installing. If any of those look off, stop and ask.
- When suggesting a new SQL migration that creates a table, always include the RLS enablement + read policy in the same migration.
- When echoing back environment variables in chat output, redact the values. Reference by key name only.
- Never write a real secret value into any file under `docs/`, `README.md`, or any `*.md` — including as examples.

---

## How Claude Should Behave

- Be practical and execution-focused
- Break work into small steps
- Always propose the next action
- Prefer implementation over theory
- Avoid unnecessary complexity
- When unsure, choose the simplest working solution
- Plan before non-trivial work; just-do-it for small fixes
- Push back honestly on big refactors or new dependencies when cost-benefit is marginal

---

## Phase closeout discipline (hard rule)

**A phase is not done until: typecheck clean → roadmap updated → committed.** Never accept "next task" while a working tree is dirty or a phase's checkboxes don't reflect reality.

Operationally:
- Before saying "ready for the next step", run `git status` and confirm the tree is clean.
- The last commit of a phase **must** include the roadmap checkbox flips. They're part of the phase, not separate paperwork.
- If the user says "next task" while the tree is dirty, push back — finish the current phase first.

---

## Output Style

- Clear
- Structured
- Concise
- Actionable

Avoid long essays unless explicitly requested.
