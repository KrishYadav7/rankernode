#!/usr/bin/env bash
# Combine the self-test reports + screenshots into publish/ and print annotations. Never fails the build.
set +e +o pipefail
VERSION="${VERSION:-0.0.0}"
mkdir -p publish
R="publish/windows-test-report-${VERSION}.txt"
{
  echo "RankerNode Windows app ${VERSION} — test report"
  echo "Built: $(date -u '+%Y-%m-%d %H:%M UTC') · commit ${GITHUB_SHA:0:7}"
  echo
  echo "=== 1. Built app (dist/win-unpacked) ==="
  cat selftest/built/report.txt 2>/dev/null || echo "FAIL  no report"
  echo
  echo "=== 2. Installed with the setup file ==="
  cat selftest/installed/install-report.txt 2>/dev/null || echo "FAIL  no install report"
  cat selftest/installed/report.txt 2>/dev/null || echo "FAIL  no report from the installed app"
} | tr -d '\r' > "$R"
for d in built installed; do
  for f in selftest/$d/*.png; do
    if [ -f "$f" ]; then cp "$f" "publish/windows-test-$d-$(basename "$f")"; fi
  done
done
cp desktop-app/dist/RankerNode-Setup-*.exe publish/ 2>/dev/null
ls -la publish
cat "$R"
FAILS=$(grep -c '^FAIL' "$R")
[ -z "$FAILS" ] && FAILS=0
echo "fails=$FAILS" >> "$GITHUB_OUTPUT"
grep '^FAIL' "$R" | head -10 | while read -r l; do echo "::warning title=Windows self-test::$l"; done
grep '^RESULT' "$R" | while read -r l; do echo "::notice title=Windows self-test::$l"; done
echo "::notice title=Windows app::RankerNode-Setup-${VERSION}.exe built · ${FAILS} failed check(s)"
exit 0
