#!/usr/bin/env bash
# Mutation check: introduce one deliberate privacy bug at a time and require the test
# suite to fail. A surviving mutant means the tests would not notice that bug.
set -u
cd "$(dirname "$0")/.."
BACKUP=$(mktemp -d)
cp -r src "$BACKUP/"
trap 'rm -rf src && cp -r "$BACKUP/src" . && rm -rf "$BACKUP"' EXIT

run() {
  local name="$1" file="$2" from="$3" to="$4"
  rm -rf src && cp -r "$BACKUP/src" .
  node -e '
    const fs = require("fs"); const [f, from, to] = process.argv.slice(1);
    const s = fs.readFileSync(f, "utf8");
    if (!s.includes(from)) { console.error("pattern not found in " + f + ": " + from); process.exit(2); }
    fs.writeFileSync(f, s.replace(from, to));
  ' "$file" "$from" "$to" || return
  if npx vitest run >/tmp/pii-mutant.log 2>&1; then
    echo "SURVIVED  $name"
  else
    echo "killed    $name  ($(grep -E "Tests " /tmp/pii-mutant.log | grep -oE "[0-9]+ failed"))"
  fi
}

run "Hebrew prefixes not handled (לדוד leaks)" src/mask.ts \
  "const HE_PREFIX = '[ושהבכלמ]{0,2}';" "const HE_PREFIX = '';"
run "Russian case forms not generated (Коэна leaks)" src/mask.ts \
  "return lang === 'ru' ? allForms(name, customer.gender, part === 'firstName' ? 'first' : 'last') : [name];" "return [name];"
run "first names declined as surnames (Ирины leaks)" src/ru-names.ts \
  "if (part === 'last' && gender === 'f' && /(ов|ев|ин|ын)а$/i.test(word)) {" "if (gender === 'f' && /(ов|ев|ин|ын)а$/i.test(word)) {"
run "names matched before e-mails (address split)" src/mask.ts \
  "export const RULES: Rule[] = [emails, customerKnownNumbers, customerNames," \
  "export const RULES: Rule[] = [customerNames, emails, customerKnownNumbers,"
run "tool returns the real date" src/tools.ts \
  "date: this.vault.token('DATE', c.date)," "date: c.date,"
run "restore accepts invented tokens" src/restore.ts \
  "problems.push({ kind: 'unknown-token', token: m[0] });" ""
run "restore shows internal tokens" src/restore.ts \
  "problems.push({ kind: 'internal-token', token: m[0] });" ""
run "tool accepts raw values" src/tools.ts \
  "if (!entry || entry.kind !== kind) return {" "if (false) return {"
