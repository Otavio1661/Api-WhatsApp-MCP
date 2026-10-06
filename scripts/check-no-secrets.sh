#!/usr/bin/env bash
# Verificações de segurança antes de publicar / fazer merge: sem segredos, sem dados pessoais, sem arquivos internos.
#
#   bash scripts/check-no-secrets.sh
#
# Opcional: LEAK_PATTERNS_FILE=/caminho/patterns.txt (uma regex estendida por linha) permite que
# os mantenedores guardem termos específicos do projeto (nomes de empresas, domínios internos,
# dados pessoais) FORA do repositório e também os verifiquem. Nunca faça commit desse arquivo.
# Código de saída 0 = limpo, 1 = achados.
set -u
cd "$(dirname "$0")/.."
fail=0
note() { printf '\n== %s\n' "$1"; }
bad()  { printf 'ACHADO: %s\n' "$1"; fail=1; }

GREP_EXCLUDES=(--exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=coverage \
  --exclude=package-lock.json --exclude=check-no-secrets.sh --exclude=LICENSE)

note "1. scanners de segredos (árvore de arquivos e histórico do git)"
if command -v gitleaks >/dev/null; then
  gitleaks detect --source . --no-banner --redact >/dev/null 2>&1 || bad "o gitleaks reportou achados (rode: gitleaks detect --source . -v --redact)"
  gitleaks detect --source . --no-git --no-banner --redact >/dev/null 2>&1 || bad "o gitleaks (árvore de arquivos) reportou achados"
else
  echo "gitleaks não instalado: ignorado (instale em https://github.com/gitleaks/gitleaks)"
fi
if command -v trufflehog >/dev/null; then
  out=$(trufflehog git "file://$PWD" --no-update --fail --no-verification 2>&1) || { bad "o trufflehog reportou achados"; echo "$out" | tail -5; }
else
  echo "trufflehog não instalado: ignorado (instale em https://github.com/trufflesecurity/trufflehog)"
fi

note "2. arquivos proibidos rastreados pelo git"
files=$(git ls-files 2>/dev/null || find . -type f -not -path './node_modules/*' -not -path './.git/*')
files=$(echo "$files" | sed 's#^\./##')
# Os achados são lidos com substituição de processo (e não com pipe) para que bad() consiga definir $fail neste shell.
while read -r f; do bad "arquivo de ambiente: $f"; done < <(echo "$files" | grep -E '(^|/)\.env($|\.)' | grep -v '\.env\.example$')
while read -r f; do bad "arquivo proibido: $f"; done < <(echo "$files" | grep -iE '\.(pem|key|p12|pfx|sql|dump|bak)$|(^|/)\.claude/|napkin' | grep -v '^prisma/migrations/')
# Arquivos de notas internas são comparados com diferenciação de maiúsculas (CLAUDE.md, CONTEXT*.md, ESTADO*.md), então docs como clients/claude-code.md não são marcados.
while read -r f; do bad "arquivo proibido: $f"; done < <(echo "$files" | grep -E '(^|/)(CLAUDE|CONTEXT|ESTADO)[^/]*\.md$')

note "3. endereços de e-mail fora da lista de fictícios permitidos"
while read -r l; do bad "e-mail: $l"; done < <(grep -rInoE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' "${GREP_EXCLUDES[@]}" . \
  | grep -viE '@(example\.(com|org)|exemplo\.com|a\.com|b\.com|x\.com|tenant-a\.com|conta\.com|empresa\.com|acme\.com|dev\.local|users\.noreply\.github\.com|s\.whatsapp\.net|g\.us|github\.com|\w+\.local)\b' \
  | grep -vE '@(fastify|prisma|types|vitest|modelcontextprotocol)/')

note "4. números de telefone fora da lista de fictícios permitidos"
while read -r l; do bad "número parecido com telefone: $l"; done < <(grep -rInoE '\b55[0-9]{10,11}\b' "${GREP_EXCLUDES[@]}" . \
  | grep -vE ':(5544999990000|5544999990001|5544988880000|5544000000000|5544911110000|554499990000|5511999999999|5544977770013|554477770013|554466660042)$')

note "5. endereços IPv4 que parecem públicos"
while read -r l; do bad "IPv4: $l"; done < <(grep -rInoE '\b([0-9]{1,3}\.){3}[0-9]{1,3}\b' "${GREP_EXCLUDES[@]}" . \
  | grep -vE ':(8\.8\.8\.8|93\.184\.216\.34)$' \
  | grep -vE ':(127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.0\.2\.|169\.254\.|255\.|1\.0\.0\.|2\.1\.0)')

note "6. padrões privados específicos do projeto (LEAK_PATTERNS_FILE)"
if [ -n "${LEAK_PATTERNS_FILE:-}" ] && [ -f "$LEAK_PATTERNS_FILE" ]; then
  while IFS= read -r pat; do
    [ -z "$pat" ] && continue
    hits=$(grep -rInE "$pat" "${GREP_EXCLUDES[@]}" . | head -3)
    [ -n "$hits" ] && bad "o padrão '$pat' encontrou:" && echo "$hits"
    git log --all --format='%an %ae %cn %ce %s' 2>/dev/null | grep -qE "$pat" && bad "o padrão '$pat' encontrou nos metadados de commit"
  done < "$LEAK_PATTERNS_FILE"
else
  echo "LEAK_PATTERNS_FILE não definido: ignorado"
fi

note "7. autoria dos commits"
if git rev-parse --git-dir >/dev/null 2>&1; then
  git log --all --format='%an <%ae> | %cn <%ce>' | sort -u
  while read -r e; do bad "e-mail de commit que não é noreply: $e"; done < <(git log --all --format='%ae%n%ce' | sort -u | grep -vE '@users\.noreply\.github\.com$|^noreply@github\.com$')
fi

echo
if [ "$fail" -eq 0 ]; then echo "OK: nenhum achado"; else echo "FALHOU: veja os achados acima"; fi
exit "$fail"
