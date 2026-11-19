# ADR-001: Pin security-sensitive deps to exact versions
Date: 2026-05-14
Status: Accepted

## Context
Shai-Hulud-class npm supply-chain attacks exploit caret ranges (`^X.Y.Z`) on legitimate packages: a compromised maintainer publishes a patch version, `npm install` pulls it on the next run, the package's `postinstall` exfiltrates credentials. The dominant blast radius for this project sits in the deps that handle auth, secrets, money, or `.env` loading.

## Decision
Pin the following exactly (no caret) in `package.json`: `@anthropic-ai/sdk`, `@clerk/nextjs`, `@supabase/ssr`, `@supabase/supabase-js`, `next`, `openai`, `dotenv`, `mysql2`, `tsx`. Leave UI / build-time deps (`lucide-react`, `three`, `@react-three/*`, `@types/*`, ESLint, Tailwind, PostCSS) on caret — their blast radius is much smaller. `react` + `react-dom` are already exact due to React 19 churn.

## Consequences
Each pinned-dep upgrade requires reading the changelog + reviewing a Dependabot PR. PR volume bumps modestly. The supply-chain defence at the entry points of credential-touching code is real and verifiable.
