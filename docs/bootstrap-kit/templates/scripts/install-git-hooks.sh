#!/bin/bash
# Install the repo's pre-commit hooks. Run once after cloning:
#   bash scripts/install-git-hooks.sh
# (or `npm run install-hooks` once the script entry is added to package.json)
#
# Documented in docs/security/supply-chain.md.

set -e
cd "$(dirname "$0")/.."

git config core.hooksPath .githooks
chmod +x .githooks/pre-commit

echo "✓ Git hooks installed (using .githooks/)"
echo
echo "  Pre-commit blocks:"
echo "  - .env*    (except .env.example)"
echo "  - Known secret patterns (Anthropic, OpenAI, AWS, Clerk, Supabase, GitHub PATs, Google)"
echo "  - package-lock.json with non-npmjs resolved URLs"
echo
echo "  Bypass if needed (NOT recommended): git commit --no-verify"
