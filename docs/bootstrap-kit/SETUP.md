# Setup walkthrough

Nine steps from `gh repo create` to "first commit on green main with full security + docs scaffold". Estimated **~45 min** end-to-end if you know the stack and have all the accounts already.

---

## Prerequisites

**Tools** (installed + signed in):
- Node.js **24+** (recommended via `fnm` or `asdf`)
- `gh` CLI authed: `gh auth login -h github.com`
- `vercel` CLI: `npm i -g vercel@latest`
- `supabase` CLI (macOS: `brew install supabase/tap/supabase`, Linux: see docs)
- Cursor / Claude Code installed and authed

**Accounts:**
- GitHub
- Supabase
- Clerk
- Vercel
- Socket (free tier at https://socket.dev)

If you're missing any of these, get them all set up first — the steps below assume each is ready.

---

## Step 1 — Create the GitHub repo

```bash
gh repo create your-org/{{PROJECT_NAME_SLUG}} --private --description "{{PROJECT_DESCRIPTION}}"
cd ~/path/to/your/code/dir
gh repo clone your-org/{{PROJECT_NAME_SLUG}}
cd {{PROJECT_NAME_SLUG}}
```

Set the local git identity to a noreply email if your primary GitHub email is private (avoids GitHub blocking pushes):

```bash
git config --local user.email "USER_ID+USERNAME@users.noreply.github.com"
# Find your USER_ID at github.com/settings/emails
```

---

## Step 2 — Scaffold Next.js

```bash
npx create-next-app@latest . --typescript --tailwind --app --use-npm \
  --no-src-dir --turbopack --eslint
```

When it asks about overwriting `.gitignore` or `README.md`: **overwrite is fine** — the bootstrap kit will replace both in Step 3.

---

## Step 3 — Drop in the bootstrap files

Copy the kit's `templates/` into the project root. Adjust the source path to wherever the kit lives:

```bash
cp -r ~/path/to/living-library/docs/bootstrap-kit/templates/. .
chmod +x .githooks/pre-commit scripts/install-git-hooks.sh
```

Then find/replace the placeholders. Five tokens:

```bash
PROJECT_NAME="My New Project"
PROJECT_DESCRIPTION="A brief description of what this app does"
PROJECT_TAGLINE="What makes it different"
SUPABASE_PROJECT_REF="filled in after Step 4"
VERCEL_PROJECT_REF="filled in after Step 6"
GITHUB_OWNER_REPO="your-org/{{PROJECT_NAME_SLUG}}"

# macOS find/replace (use `sed -i ''`; on Linux drop the empty string)
find . -type f \( -name "*.md" -o -name "*.yml" -o -name "*.json" -o -name "*.example" \) \
  -not -path "./node_modules/*" -not -path "./.next/*" \
  -exec sed -i '' "s|{{PROJECT_NAME}}|$PROJECT_NAME|g; s|{{PROJECT_DESCRIPTION}}|$PROJECT_DESCRIPTION|g; s|{{PROJECT_TAGLINE}}|$PROJECT_TAGLINE|g; s|{{GITHUB_OWNER_REPO}}|$GITHUB_OWNER_REPO|g" {} +
```

Leave `{{SUPABASE_PROJECT_REF}}` and `{{VERCEL_PROJECT_REF}}` for now — you'll have them after Steps 4 and 6.

---

## Step 4 — Provision Supabase

1. https://supabase.com/dashboard → **New project** → fill in name + region + DB password. Wait ~2 min for provisioning.
2. **Project Settings → API**:
   - Copy **Project URL** → save for env vars (`NEXT_PUBLIC_SUPABASE_URL`)
   - Copy **anon public key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - Reveal + copy **service_role secret** → `SUPABASE_SERVICE_ROLE_KEY`
   - Reveal + copy **JWT Secret** → save somewhere (you'll paste it into Clerk in Step 5)
3. Note the **project ref** (the random slug in your project URL, e.g. `your-project-ref`).
4. Set it in your env:
   ```bash
   SUPABASE_PROJECT_REF="your-project-ref"
   sed -i '' "s|{{SUPABASE_PROJECT_REF}}|$SUPABASE_PROJECT_REF|g" \
     docs/security/supply-chain.md CLAUDE.md primer.md
   ```

For migrations: create `supabase/migrations/00001_init.sql` and design your schema. **Every public-schema table you create MUST include `alter table ... enable row level security` + a read policy** (per ADR-0003). Apply later with `supabase db push` or Dashboard SQL Editor.

---

## Step 5 — Provision Clerk **(critical step)**

This is the trap that cost two sessions in Living Library. If you skip this, the app appears to "work" but every server-side Supabase read returns empty arrays silently.

1. https://dashboard.clerk.com → **Create application**. Use **Development** instance to start. Production happens later.
2. **API Keys** page: copy **Publishable key** + **Secret key**.
3. **Configure → JWT Templates → New template → Supabase preset:**
   - **Name: exactly `supabase`** (lowercase, must match `lib/supabase-server.ts:auth().getToken({template:"supabase"})`)
   - **Signing algorithm: HS256**
   - **Signing key:** paste the **Supabase JWT Secret** from Step 4
   - Save.
4. Verify by clicking the template — claims should include `{ "aud": "authenticated", "role": "authenticated" }`.

**Repeat for Production Clerk instance before launch.** Same JWT secret if same Supabase project; different secret if different Supabase project.

---

## Step 6 — Vercel link + env vars

```bash
vercel link
```

Pick the team, accept "Create new project". Get the project ref from the output (or `cat .vercel/project.json` → `projectId`).

```bash
VERCEL_PROJECT_REF=$(python3 -c 'import json; print(json.load(open(".vercel/project.json"))["projectId"])')
sed -i '' "s|{{VERCEL_PROJECT_REF}}|$VERCEL_PROJECT_REF|g" \
  docs/security/supply-chain.md
```

Add env vars (use the dashboard or `vercel env add KEY` per key). At minimum:

| Key | Value |
|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | From Step 5 |
| `CLERK_SECRET_KEY` | From Step 5 |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | `/sign-in` |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | `/sign-up` |
| `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL` | `/home` (or wherever) |
| `NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL` | `/home` (or wherever) |
| `NEXT_PUBLIC_SUPABASE_URL` | From Step 4 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | From Step 4 |
| `SUPABASE_SERVICE_ROLE_KEY` | From Step 4 |
| `CRON_SECRET` | `openssl rand -hex 32` |

Add AI provider keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.) only when you actually use them.

Then sync them locally:

```bash
vercel env pull .env.local
```

Confirm `.env.local` is in `.gitignore` (the kit's `.gitignore` includes it).

---

## Step 7 — GitHub security toggles + Socket

In the GitHub repo's **Settings → Code security and analysis**:

- **Dependabot security updates** → Enable
- **Secret scanning** → Enable
- **Push protection** → Enable
- (Optional but recommended) **CodeQL** → "Set up" → default config

Install **Socket**:

1. https://socket.dev → "Add to GitHub" → install the app → select this repo.
2. Socket dashboard → **Settings → API tokens** → create a token (name: `github-actions`).
3. Copy the token.
4. GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**:
   - **Name:** `SOCKET_SECURITY_API_TOKEN`
   - **Value:** paste the token

The kit's `.github/workflows/socket-security.yml` will fire on the next PR + push.

---

## Step 8 — Update `package.json` + first install

Edit your scaffolded `package.json`:

1. Add `"engines": { "node": ">=24" }` at the top level.
2. Add `"install-hooks": "bash scripts/install-git-hooks.sh"` under `scripts`.
3. For security-sensitive deps you install during scaffold (Clerk, Supabase, dotenv, etc.), **pin them exactly** — no caret. See ADR-0001 for the pattern.

Install dependencies + wire hooks + first commit:

```bash
npm install
npm run install-hooks
npx tsc --noEmit       # verify cleanly
git add .
git commit -m "Initial scaffold from living-library bootstrap kit"
git push -u origin main
```

This is your first revertable baseline. Future commits can `git reset --hard` to here cleanly.

---

## Step 9 — Per-project customisation

Final pass to make the kit yours:

1. **`CLAUDE.md`** — fill in:
   - "What this project is" — product description + outcomes + pillars
   - "Tech Stack" — confirm or replace defaults
   - "Data Principles" — TODO section, replace with your own
   - "Where things live" — fill in as the codebase takes shape
2. **`primer.md`** — set current state + WIP
3. **`docs/roadmap.md`** — sketch phases A → F for this product
4. **`hindsight.md`** — leave alone for now; grow it as you learn
5. **Memory seed for Claude Code:**
   - Open the project in Claude Code, then add memories you want to carry forward (your working preferences, plan-before-implementation, logical-commit-splits, push-back-on-big-refactors).
   - The Living Library memory store at `~/.claude/projects/-Users-me-Cursor-Library/memory/` has carry-forward candidates — feedback files especially.
6. **Plan your first ADR-0005** — the first non-obvious decision you make for this project.

---

## Common pitfalls (from Living Library's actual experience)

| Symptom | Cause | Fix |
|---|---|---|
| `Error: No JWT template exists with name: supabase` | Step 5 skipped | Set up the Clerk JWT template named exactly `supabase` |
| Every UI element showing "Unknown" / empty / silent failure | Clerk JWT fails → anon Supabase client → RLS denies → empty arrays | Same: fix the JWT template |
| Socket workflow runs fail with `Input required: mode` | Old action config | Workflow file in this kit already includes `mode: firewall` |
| Build fails on Vercel with `cannot find module` for a dep with native binaries | `--ignore-scripts` broke the dep | Verify it ships binaries via `optionalDependencies`; if it genuinely needs a script, allowlist it explicitly (don't flip the global default) |
| `.env*` accidentally committed | Hook not installed | Run `npm run install-hooks` |
| Push blocked by GitHub email privacy | Primary email is private | Use the noreply email format (see Step 1) |
| New table is public-readable to anon | RLS forgotten in migration | Always include `enable row level security` + read policy in the same migration (ADR-0003) |

---

## After Step 9

You're set up. Welcome to the project. From here:

- Add your first product feature.
- Write ADR-0005 the first time you make a non-obvious choice.
- Update `primer.md` when you change focus.
- Add hindsight lessons as you learn them.

When something breaks in a way that surprises you and the surprise is universal, port the lesson back to the bootstrap kit in Living Library — keep the kit alive.
