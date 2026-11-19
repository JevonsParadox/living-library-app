#!/bin/bash
set -e

echo "=============================="
echo "LIVING LIBRARY — LIVE CONTEXT"
echo "=============================="

echo
echo "Branch:"
git branch --show-current 2>/dev/null || echo "unknown"

echo
echo "Recent commits:"
git log --oneline -n 5 2>/dev/null || echo "no commits yet"

echo
echo "Modified files:"
git status --short 2>/dev/null || echo "no changes"

echo
echo "Top-level structure:"
find . -maxdepth 2 -type d | sed 's#^\./##' | sort

echo
echo "Key files:"
find . -maxdepth 2 -type f | sed 's#^\./##' | sort | head -n 50

echo
echo "=============================="
echo "END CONTEXT"
echo "=============================="
