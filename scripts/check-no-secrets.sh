#!/usr/bin/env bash
# Pre-publish / pre-merge safety checks: no secrets, no personal data, no internal files.
#
#   bash scripts/check-no-secrets.sh
#
# Optional: LEAK_PATTERNS_FILE=/path/to/patterns.txt (one extended regex per line) lets
# maintainers keep project-specific strings (company names, internal domains, personal data)
# OUTSIDE the repository and have them checked too. Never commit that file.
# Exit code 0 = clean, 1 = findings.
set -u
cd "$(dirname "$0")/.."
fail=0
note() { printf '\n== %s\n' "$1"; }
bad()  { printf 'FINDING: %s\n' "$1"; fail=1; }

GREP_EXCLUDES=(--exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=coverage \
  --exclude=package-lock.json --exclude=check-no-secrets.sh --exclude=LICENSE)

note "1. secret scanners (working tree and git history)"
if command -v gitleaks >/dev/null; then
  gitleaks detect --source . --no-banner --redact >/dev/null 2>&1 || bad "gitleaks reported findings (run: gitleaks detect --source . -v --redact)"
  gitleaks detect --source . --no-git --no-banner --redact >/dev/null 2>&1 || bad "gitleaks (working tree) reported findings"
else
  echo "gitleaks not installed: skipped (install from https://github.com/gitleaks/gitleaks)"
fi
if command -v trufflehog >/dev/null; then
  out=$(trufflehog git "file://$PWD" --no-update --fail --no-verification 2>&1) || { bad "trufflehog reported findings"; echo "$out" | tail -5; }
else
  echo "trufflehog not installed: skipped (install from https://github.com/trufflesecurity/trufflehog)"
fi

note "2. forbidden files tracked by git"
files=$(git ls-files 2>/dev/null || find . -type f -not -path './node_modules/*' -not -path './.git/*')
files=$(echo "$files" | sed 's#^\./##')
# Findings are read with process substitution (not a pipe) so that bad() can set $fail in this shell.
while read -r f; do bad "env file: $f"; done < <(echo "$files" | grep -E '(^|/)\.env($|\.)' | grep -v '\.env\.example$')
while read -r f; do bad "forbidden file: $f"; done < <(echo "$files" | grep -iE '\.(pem|key|p12|pfx|sql|dump|bak)$|(^|/)(CLAUDE|CONTEXT|ESTADO)[^/]*\.md$|(^|/)\.claude/|napkin' | grep -v '^prisma/migrations/')

note "3. e-mail addresses outside the fictional allow-list"
while read -r l; do bad "e-mail: $l"; done < <(grep -rInoE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' "${GREP_EXCLUDES[@]}" . \
  | grep -viE '@(example\.(com|org)|exemplo\.com|a\.com|b\.com|x\.com|tenant-a\.com|conta\.com|empresa\.com|acme\.com|dev\.local|users\.noreply\.github\.com|s\.whatsapp\.net|g\.us|github\.com|\w+\.local)\b' \
  | grep -vE '@(fastify|prisma|types|vitest|modelcontextprotocol)/')

note "4. phone numbers outside the fictional allow-list"
while read -r l; do bad "phone-like number: $l"; done < <(grep -rInoE '\b55[0-9]{10,11}\b' "${GREP_EXCLUDES[@]}" . \
  | grep -vE ':(5544999990000|5544999990001|5544988880000|5544000000000|5544911110000|554499990000|5511999999999|5544977770013|554477770013|554466660042)$')

note "5. public-looking IPv4 addresses"
while read -r l; do bad "IPv4: $l"; done < <(grep -rInoE '\b([0-9]{1,3}\.){3}[0-9]{1,3}\b' "${GREP_EXCLUDES[@]}" . \
  | grep -vE ':(8\.8\.8\.8|93\.184\.216\.34)$' \
  | grep -vE ':(127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.0\.2\.|169\.254\.|255\.|1\.0\.0\.|2\.1\.0)')

note "6. private project-specific patterns (LEAK_PATTERNS_FILE)"
if [ -n "${LEAK_PATTERNS_FILE:-}" ] && [ -f "$LEAK_PATTERNS_FILE" ]; then
  while IFS= read -r pat; do
    [ -z "$pat" ] && continue
    hits=$(grep -rInE "$pat" "${GREP_EXCLUDES[@]}" . | head -3)
    [ -n "$hits" ] && bad "pattern '$pat' matched:" && echo "$hits"
    git log --all --format='%an %ae %cn %ce %s' 2>/dev/null | grep -qE "$pat" && bad "pattern '$pat' matched in commit metadata"
  done < "$LEAK_PATTERNS_FILE"
else
  echo "LEAK_PATTERNS_FILE not set: skipped"
fi

note "7. commit authorship"
if git rev-parse --git-dir >/dev/null 2>&1; then
  git log --all --format='%an <%ae> | %cn <%ce>' | sort -u
  while read -r e; do bad "non-noreply commit e-mail: $e"; done < <(git log --all --format='%ae%n%ce' | sort -u | grep -vE '@users\.noreply\.github\.com$|^noreply@github\.com$')
fi

echo
if [ "$fail" -eq 0 ]; then echo "OK: no findings"; else echo "FAILED: see findings above"; fi
exit "$fail"
