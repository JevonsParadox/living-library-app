#!/bin/bash
set -e

echo "=============================="
echo "LIVING LIBRARY — SECURITY SWEEP"
echo "=============================="

echo
echo "[1] Checking for exposed secrets"
grep -RInE "(SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE|CLERK_SECRET_KEY|RESEND_API_KEY|PINECONE_API_KEY|SENTRY_AUTH_TOKEN)" . \
  --exclude-dir=node_modules \
  --exclude-dir=.git \
  --exclude=.env.example || echo "No obvious secrets found"

echo
echo "[2] Checking for risky public env usage"
grep -RInE "NEXT_PUBLIC_.*(SECRET|KEY|TOKEN)" . \
  --exclude-dir=node_modules \
  --exclude-dir=.git || echo "No risky public env usage"

echo
echo "[3] Checking for unsafe frontend patterns"
grep -RInE "dangerouslySetInnerHTML|innerHTML\s*=|eval\(" . \
  --exclude-dir=node_modules \
  --exclude-dir=.git || echo "No obvious unsafe patterns"

echo
echo "[4] Checking for open CORS or unsafe headers"
grep -RInE "Access-Control-Allow-Origin|cors\(" . \
  --exclude-dir=node_modules \
  --exclude-dir=.git || echo "No obvious CORS issues"

echo
echo "[5] Checking for security TODOs"
grep -RInE "TODO.*security|FIXME.*security|HACK" . \
  --exclude-dir=node_modules \
  --exclude-dir=.git || echo "No flagged TODOs"

echo
echo "=============================="
echo "SECURITY SWEEP COMPLETE"
echo "=============================="