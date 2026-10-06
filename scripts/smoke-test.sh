#!/usr/bin/env bash
# ============================================================
# RankerNode staging smoke test  —  run BEFORE every push to the VPS
#   BASE_URL=http://localhost:5001 bash scripts/smoke-test.sh
# Optional deeper checks with a real student session:
#   STUDENT_TOKEN=<jwt from sessionStorage.aero_token> STUDENT_ID=<_id> bash scripts/smoke-test.sh
# Exit code 0 = all checks passed.
# ============================================================
BASE_URL="${BASE_URL:-http://localhost:5001}"
FAKE_ID="000000000000000000000000"
pass=0; fail=0
ok()   { echo "  ✅ $1"; pass=$((pass+1)); }
bad()  { echo "  ❌ $1"; fail=$((fail+1)); }
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }

echo "Smoke-testing $BASE_URL"
echo "— Public pages"
[ "$(code "$BASE_URL/")" = "200" ] && ok "GET / → 200" || bad "GET / is not 200"
[ "$(code "$BASE_URL/app")" = "200" ] && ok "GET /app → 200" || bad "GET /app is not 200"
curl -s "$BASE_URL/app" | grep -Eq 'app\.js\?v=[0-9a-f]{10}' && ok "index.html carries a content-hash for app.js" || bad "app.js?v=<hash> not injected"
[ "$(code "$BASE_URL/api/version")" = "200" ] && ok "GET /api/version → 200" || bad "/api/version failed"
[ "$(code "$BASE_URL/api/courses")" = "200" ] && ok "GET /api/courses → 200" || bad "/api/courses failed"
curl -s "$BASE_URL/api/courses" | grep -q 'res.cloudinary.com' && bad "course list leaks Cloudinary URLs" || ok "course list has no raw Cloudinary URLs"
[ "$(code "$BASE_URL/api/definitely-not-a-route")" = "404" ] && ok "unknown /api route → JSON 404" || bad "unknown /api route not 404"

echo "— Protected routes must refuse anonymous callers"
for spec in \
  "GET /api/user/me/$FAKE_ID" \
  "GET /api/user/analytics/$FAKE_ID" \
  "GET /api/user/notifications/$FAKE_ID" \
  "GET /api/user/video-progress" \
  "POST /api/user/video-progress" \
  "POST /api/user/progress/$FAKE_ID/$FAKE_ID" \
  "POST /api/upload/init" \
  "POST /api/create-order" \
  "POST /api/subscribe/verify-order" \
  "POST /api/courses/$FAKE_ID/doubts" \
  "POST /api/ai/solve-doubt" \
  "GET /api/students" \
  "POST /api/admin/students/bulk" \
  "PUT /api/courses/$FAKE_ID/doubts/$FAKE_ID"; do
  m="${spec%% *}"; p="${spec#* }"
  c=$(code -X "$m" -H 'Content-Type: application/json' -d '{}' "$BASE_URL$p")
  [ "$c" = "401" ] && ok "$m $p → 401" || bad "$m $p → $c (expected 401)"
done

echo "— NoSQL operator injection is stripped"
c=$(code -X POST -H 'Content-Type: application/json' -d '{"username":{"$ne":null},"password":{"$ne":null}}' "$BASE_URL/api/login")
[ "$c" = "400" ] && ok "login with {\$ne:null} → 400" || bad "login operator payload → $c (expected 400)"

echo "— Compressed static assets"
sleep 2
enc=$(curl -s -o /dev/null -D - -H 'Accept-Encoding: br, gzip' "$BASE_URL/app.js" | tr -d '\r' | awk -F': ' 'tolower($1)=="content-encoding"{print $2}')
[ -n "$enc" ] && ok "app.js served with Content-Encoding: $enc" || bad "app.js not compressed"

if [ -n "$STUDENT_TOKEN" ] && [ -n "$STUDENT_ID" ]; then
  echo "— Student session checks"
  AUTH="Authorization: Bearer $STUDENT_TOKEN"
  [ "$(code -H "$AUTH" "$BASE_URL/api/user/me/$STUDENT_ID")" = "200" ] && ok "own profile → 200" || bad "own profile not 200"
  [ "$(code -H "$AUTH" "$BASE_URL/api/user/me/$FAKE_ID")" = "403" ] && ok "someone else's profile → 403" || bad "IDOR check failed (expected 403)"
  [ "$(code -H "$AUTH" "$BASE_URL/api/user/video-progress")" = "200" ] && ok "video progress → 200" || bad "video progress not 200"
  [ "$(code -H "$AUTH" "$BASE_URL/api/students")" = "403" ] && ok "student → admin route → 403" || bad "student reached an admin route"
fi

echo
echo "Passed: $pass   Failed: $fail"
[ "$fail" -eq 0 ]
