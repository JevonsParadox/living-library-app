# ADR-0001: Pin security-sensitive deps to exact versions
Date: (set when you adopt this in your project)
Status: Accepted

## Context
Shai-Hulud-class npm supply-chain attacks exploit caret ranges (`^X.Y.Z`) on legitimate packages: a compromised maintainer publishes a patch version, `npm install` pulls it on the next run, the package's `postinstall` exfiltrates credentials. The dominant blast radius for any project sits in the deps that handle auth, secrets, money, or `.env` loading.

## Decision
Pin the following exactly (no caret) in `package.json`: all packages that handle authentication, billing, AI provider credentials, database connections, or `.env` loading. At minimum this includes: your Clerk packages, your Supabase packages, any AI provider SDK (Anthropic, OpenAI, Vertex, etc.), `dotenv`, any database driver (`mysql2`, `pg`, etc.), `next` itself, and `tsx` if you run scripts with full env access. Leave UI / build-time deps (`lucide-react`, charting libs, ESLint, Tailwind, PostCSS, `@types/*`) on caret — their blast radius is much smaller.

## Consequences
Each pinned-dep upgrade requires reading the changelog + reviewing a Dependabot PR. PR volume bumps modestly. The supply-chain defence at the entry points of credential-touching code is real and verifiable.
