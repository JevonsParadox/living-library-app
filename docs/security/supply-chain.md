# Supply-Chain Security — Living Library

**This is the single source of truth for how we handle dependencies, secrets, and supply-chain risk. Read it before changing anything in `package.json`, `.npmrc`, `vercel.json`, or `.githooks/`.**

Last reviewed: 2026-05-14.

---

## 1. Threat model

The dominant risk is a Shai-Hulud-class npm supply-chain attack:

1. An attacker steals a maintainer's npm publish token.
2. They publish a malicious patch of a legitimate package (e.g. `lodash@4.17.99`). Caret-range deps (`^4.17.21`) auto-pull it on next `npm install`.
3. A `postinstall` script runs on the victim machine. It scans the filesystem with TruffleHog-style tools, grabs every `.env`, `~/.npmrc`, `~/.aws/credentials`, `~/.config/gh`, SSH key, etc.
4. It exfils them to a throwaway endpoint, then uses the stolen credentials to publish malicious versions of *other* packages the victim has rights on. The worm self-propagates.

For this project specifically, an attacker who runs code on the dev machine or Vercel build env could exfil:

- `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` — paid APIs, financial blast radius.
- `SUPABASE_SERVICE_ROLE_KEY` — full DB read/write, RLS-bypassing.
- `CLERK_SECRET_KEY` — auth bypass.
- `GOOGLE_BOOKS_API_KEY`, `CRON_SECRET` — lesser, but still leakable.
- GitHub PAT from `~/.config/gh` on dev — repo write access.
- Vercel deploy token if locally configured — production access.

**Out of scope** (handled separately):
- Database row-level security (covered by Supabase RLS policies in migrations).
- Auth bugs / IDOR (Clerk + manual review).
- Frontend XSS (React's default escaping + no `dangerouslySetInnerHTML`).
- DDoS (Vercel platform handles).

---

## 2. Defensive layers (current state)

Five independent layers. Each one stops a meaningful percentage of attacks even if every other layer fails.

### Layer 1 — Install-script blocking (`.npmrc`)

`.npmrc` sets `ignore-scripts=true` for **every install in this repo**, including `npm ci`, `npm install <pkg>`, etc.

This is the single biggest control. Shai-Hulud's payload runs via `postinstall`; blocking scripts blocks the payload.

**The five packages in our current lockfile that have install scripts** (`@clerk/shared`, `esbuild`, `fsevents`, `sharp`, `unrs-resolver`) all ship platform-specific binaries via `optionalDependencies`, which works without scripts. The install scripts are fallbacks for older setups we don't have.

If a new dep genuinely needs scripts:

1. Read the script. Confirm it's not exfiltrating anything.
2. Install it once with `npm install <pkg> --ignore-scripts=false`.
3. Document why in the PR description.
4. **Never** flip the default in `.npmrc`.

### Layer 2 — Version pinning (`package.json`)

Security-sensitive deps are pinned **exactly** (no caret). Auto-pulling a "patch" of `@anthropic-ai/sdk` is precisely the Shai-Hulud entry point we're closing.

Currently pinned exact:

- `@anthropic-ai/sdk` — handles auth + costs money
- `@clerk/nextjs` — auth
- `@supabase/ssr`, `@supabase/supabase-js` — DB access (incl. service role)
- `next` — framework, runs everywhere
- `openai` — auth + costs money
- `dotenv` — reads `.env*` files (highest-value target on disk)
- `mysql2` — DB driver
- `tsx` — runs scripts with full env access

Everything else (`@types/*`, ESLint, React Three Fiber, Tailwind, etc.) is allowed caret-range bumps because their blast radius is much smaller (build-time or UI-only).

`react` + `react-dom` are already exact because of React 19 RC churn.

**Bumping a pinned version:**

1. Read the changelog.
2. Skim the diff (`npm view <pkg>@<new> dist.tarball` → download → diff against current). For small bumps this is fast.
3. Update `package.json` to the new exact version.
4. Run `npm install`. Check `package-lock.json` diff.
5. Run the full test path locally before pushing.

Dependabot will open PRs for these — review each one as above, don't auto-merge.

### Layer 3 — Vercel install hardening (`vercel.json`)

`"installCommand": "npm ci --ignore-scripts"`.

This applies the same Layer 1 protection to Vercel's build environment, which is arguably more important than dev — production env vars (Anthropic, OpenAI, Supabase service role) live there.

`npm ci` uses the lockfile verbatim — no semver resolution, no surprise upgrades.

### Layer 4 — Pre-commit hook (`.githooks/pre-commit`)

Installed via `npm run install-hooks` (or `bash scripts/install-git-hooks.sh`) after cloning.

Blocks:

- Any `.env*` file except `.env.example`.
- Diffs containing secret patterns: Anthropic, OpenAI, AWS, Clerk live, Supabase service-role JWT, GitHub PATs (classic + fine-grained), Google API keys.
- `package-lock.json` with any `"resolved"` URL pointing outside `registry.npmjs.org`.

Bypass with `git commit --no-verify` — but always confirm what you're committing first.

### Layer 5 — Continuous monitoring

Things to **enable in the GitHub repo settings** (not in this repo's code):

1. **Dependabot security updates** — Settings → Security → Dependabot → "Dependabot security updates" = on. Auto-PRs when a known-vulnerable version is detected. Config in `.github/dependabot.yml`.
2. **Secret scanning + push protection** — Settings → Security → Code security and analysis → "Secret scanning" = on, "Push protection" = on. Blocks pushes containing known token patterns (more thorough than our pre-commit).
3. **Socket** — install the Socket GitHub App at https://socket.dev/. Free tier covers small private repos. Posts a PR comment on every dep change showing: install-script changes, network calls added, obfuscation, maintainer changes, age of new version. Catches Shai-Hulud-style patterns *before* you merge.
4. **CodeQL** — Settings → Security → Code scanning → "Set up" → CodeQL. Free for any repo. Catches first-party code smells (SSRF, SQL injection, XSS, etc.).

---

## 3. Operational rules (do / don't)

### Do

- ✅ Pin sensitive deps exactly. Bump via PR + changelog read.
- ✅ Keep `.env.local` local. Never paste secrets into chat, IDE files, or commit messages.
- ✅ Rotate secrets every ~90 days regardless of incidents. Anthropic + OpenAI + Supabase service role + Clerk secret.
- ✅ Use the Clerk / Supabase / Anthropic dashboards to revoke + reissue rather than reusing keys.
- ✅ Run `npm run install-hooks` once after cloning on a new machine.
- ✅ When adding a new dep: check the package's npm page for last-publish date, weekly download count (low + popular = suspicious), and maintainer history. Prefer @official-org packages.
- ✅ Review every Dependabot PR. Don't auto-merge.

### Don't

- ❌ Don't run `npm install --ignore-scripts=false` repo-wide. Allowlist per-install if absolutely needed.
- ❌ Don't add `husky`, `lefthook`, or any other "fancy git hooks" framework unless you've reviewed its install scripts. The plain `.githooks/` approach has zero install-time code.
- ❌ Don't store the Supabase service role key in client code. Server actions or API routes only.
- ❌ Don't put secret values in `.env.example`. Keys with empty values only.
- ❌ Don't commit `.vercel/`, `node_modules/`, or any `.env*` (already in `.gitignore`, but be aware).
- ❌ Don't use `eval()`, `new Function()`, or `dangerouslySetInnerHTML` without a security reviewer.
- ❌ Don't accept user-supplied URLs that the server then fetches without explicit allowlisting (SSRF vector).
- ❌ Don't `git commit --no-verify` to bypass the pre-commit hook without confirming the diff is clean.

---

## 4. Incident response — "I think I've been hit"

If a Shai-Hulud-style alert lands (npm advisory, GitHub Security alert, Socket flag, suspicious activity in Anthropic/OpenAI dashboards):

### Within the first hour

1. **Disconnect the dev machine from the internet.** Stops further exfil.
2. **Rotate every credential listed in the threat model above.** Don't wait to confirm exposure — assume compromise.
   - Anthropic → console.anthropic.com → revoke + create new
   - OpenAI → platform.openai.com → revoke + create new
   - Supabase → dashboard → Project Settings → API → "Reset API keys"
   - Clerk → dashboard → API keys → revoke secret + new
   - GitHub PAT → github.com/settings/tokens → revoke
   - Vercel → vercel.com/account/tokens → revoke
   - SSH keys → revoke from GitHub + regenerate
3. **Check Anthropic + OpenAI dashboards for unusual usage spikes.** That's the clearest "they used the key" signal.
4. **Check Supabase logs** for unusual queries (mass selects, dumps).
5. **Check GitHub audit log** for unexpected pushes / new repos / token creations.

### Within the first day

6. **Snapshot the dev machine** for forensics if you want to investigate later. Otherwise:
7. **`rm -rf node_modules` and `npm cache clean --force`.** Don't reinstall yet.
8. **Identify the malicious package** — check the GitHub advisory feed and `npm audit`. Pin away from the bad version.
9. **`npm ci --ignore-scripts`** to reinstall on the clean lockfile.
10. **Verify** with the audit checklist in section 5.

### Recovery

11. **Force-push a clean `main`** if there's any unauthorised commit. Re-create the branch from your last known-good commit.
12. **Re-deploy** with the new credentials.
13. **Tell affected parties** if user data was at risk (this is the legally fraught part — talk to a lawyer if real users were affected).

---

## 5. Audit checklist (quarterly + on incident)

Run this every quarter, or any time something feels off. Read-only — none of these change state.

```bash
# 1. npm audit
npm audit --audit-level=moderate

# 2. Packages with install scripts (should match the known 5)
python3 -c "
import json
lock = json.load(open('package-lock.json'))
for path, info in lock.get('packages', {}).items():
    if info.get('hasInstallScript'):
        print(path)
"

# 3. Non-npmjs resolved URLs (should return nothing)
grep -oE '\"resolved\": \"[^\"]*\"' package-lock.json | grep -v registry.npmjs.org

# 4. Recent lockfile churn (compare against intentional feature commits)
git log --oneline -10 -- package-lock.json

# 5. RLS status on every public table (should all be 'true')
# Run in Supabase SQL editor:
# select tablename, rowsecurity from pg_tables where schemaname = 'public';

# 6. Local credentials inventory
ls -la ~/.npmrc ~/.ssh/id_* ~/.config/gh ~/.aws/credentials ~/.config/gcloud 2>/dev/null

# 7. Pre-commit hook installed?
git config --get core.hooksPath  # should print: .githooks
```

If any of these surface something unexpected, treat as an incident (section 4).

---

## 6. What we explicitly chose NOT to do, and why

- **Lockfile-lint as an npm dep.** It's another supply-chain dep. The pre-commit hook's inline `grep` check covers the same ground for `package-lock.json`.
- **Husky.** Same reason — adds an install-script-running dep. Plain `.githooks/` + `git config core.hooksPath` gets us 95% of the value with zero new deps.
- **Pinning UI deps (Three.js, R3F, lucide).** Their blast radius is build-time / UI-only. Pinning them quadruples PR volume from Dependabot without proportional security gain.
- **Migrating to Go + HTMX.** Considered (notes from 2026-05-14). Would close ~70-80% of npm supply-chain surface but caps there because the 3D galaxy still requires JS (Three.js / R3F / force-graph). Cost: 5-8 weeks of rewrite. The hardening above achieves ~85% of the benefit in 2 days.

---

## 7. When to revisit this doc

- After any npm-advisory alert affecting one of our deps.
- After any Supabase security alert (RLS, exposed table, etc.).
- Quarterly, on the audit cadence.
- Before adding a new third-party SDK that handles credentials or money.
- If team size grows past 1 — the pre-commit-hook-only enforcement becomes weaker with more contributors, may want CI-level enforcement.
