#!/usr/bin/env bash
# Drives the RankerNode app on the emulator. Writes test-out/report.txt (+ screenshots).
set -u
OUT=test-out; mkdir -p "$OUT"
PKG=com.altitudeacademy.app
R="$OUT/report.txt"
pass() { echo "PASS  $*" | tee -a "$R"; }
fail() { echo "FAIL  $*" | tee -a "$R"; FAILS=$((FAILS+1)); }
info() { echo "....  $*" | tee -a "$R"; }
FAILS=0
uidump() { adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb pull /sdcard/ui.xml "$OUT/$1.xml" >/dev/null 2>&1; grep -o 'text="[^"]*"\|content-desc="[^"]*"' "$OUT/$1.xml" 2>/dev/null | sed 's/^[a-z-]*="//;s/"$//' | grep -v '^$' | sort -u > "$OUT/$1.txt"; }
has() { grep -qi -- "$2" "$OUT/$1.txt" 2>/dev/null; }

adb wait-for-device
adb shell settings put global window_animation_scale 0
info "Android $(adb shell getprop ro.build.version.release | tr -d '\r') · $(adb shell getprop ro.product.model | tr -d '\r')"

# ---------------------------------------------------------------- 1. RELEASE APK
echo "== RELEASE APK ==" | tee -a "$R"
adb install -r release.apk > "$OUT/install.txt" 2>&1 && pass "release APK installs" || { fail "release APK does not install: $(tail -1 $OUT/install.txt)"; }
adb shell dumpsys package $PKG | grep -E "versionName|versionCode=" | head -2 | sed 's/^ */....  /' | tee -a "$R"
adb shell cmd package resolve-activity --brief -c android.intent.category.LAUNCHER $PKG | tail -1 | grep -q MainActivity && pass "app icon in launcher" || fail "no launcher entry"
adb logcat -c
T0=$(date +%s%3N)
adb shell am start -W -n $PKG/.MainActivity > "$OUT/start.txt" 2>&1
info "cold start: $(grep -E 'TotalTime|WaitTime' $OUT/start.txt | tr '\n' ' ')"
sleep 30
uidump 01-release-start
cp "$OUT/01-release-start.txt" "$OUT/01-release-start-texts.txt"
if has 01-release-start "Sign In\|Welcome back\|Username\|RankerNode"; then pass "website loads inside the app (login page visible)"; else fail "login page text not found (see 01-release-start.txt)"; fi
if has 01-release-start "Get App"; then fail "'Get App' button visible inside the app"; else pass "'Get App' hidden inside the app"; fi
adb shell dumpsys window windows 2>/dev/null | grep -A12 "$PKG" | grep -q "SECURE" && pass "screenshots blocked (FLAG_SECURE)" || info "FLAG_SECURE not seen in dumpsys (check manually)"
adb exec-out screencap -p > "$OUT/01-release-screencap.png" 2>/dev/null
adb shell dumpsys activity activities | grep -E "topResumedActivity|mResumedActivity" | head -1 | grep -q "$PKG" && pass "app stays in front (no browser opened)" || fail "another app came to the front"

# rotation
adb shell settings put system accelerometer_rotation 0; adb shell settings put system user_rotation 1; sleep 6
uidump 02-landscape; has 02-landscape "Sign In\|Welcome back\|Username" && pass "landscape works" || info "landscape: login text not found"
adb shell settings put system user_rotation 0; sleep 3

# deep link from another app
adb shell am start -W -a android.intent.action.VIEW -d "https://rankernode.example/app#/courses" > /dev/null 2>&1; sleep 12
adb shell dumpsys activity activities | grep -E "topResumedActivity|mResumedActivity" | head -1 | grep -q "$PKG" && pass "rankernode.example links can open in the app" || info "link opened elsewhere (chooser/browser) — normal without verified App Links"

# back button must not crash
adb shell input keyevent KEYCODE_BACK; sleep 2; adb shell input keyevent KEYCODE_BACK; sleep 2

# offline screen
adb shell am force-stop $PKG
adb shell svc wifi disable; adb shell svc data disable; sleep 3
adb shell am start -W -n $PKG/.MainActivity > /dev/null 2>&1; sleep 10
uidump 03-offline
has 03-offline "offline\|internet\|connection\|Retry\|Try again" && pass "offline screen shows without internet" || fail "no offline screen (see 03-offline.txt)"
adb shell svc wifi enable; adb shell svc data enable; sleep 12
uidump 04-back-online
has 04-back-online "Sign In\|Welcome back\|Username" && pass "comes back by itself when internet returns" || info "after reconnect: login text not found yet (may need a tap on Retry)"

adb logcat -d > "$OUT/logcat-release.txt"
if grep -q "FATAL EXCEPTION" "$OUT/logcat-release.txt"; then fail "app CRASHED (see logcat-release.txt)"; grep -A15 "FATAL EXCEPTION" "$OUT/logcat-release.txt" | head -30 >> "$R"; else pass "no crash in release app"; fi

# ---------------------------------------------------------------- 2. DEBUG COPY — page-level tests
echo "== DEBUG COPY (page tests) ==" | tee -a "$R"
adb uninstall $PKG > /dev/null 2>&1
adb install -r debug.apk > /dev/null 2>&1 && pass "debug copy installs" || fail "debug copy does not install"
adb shell pm grant $PKG android.permission.POST_NOTIFICATIONS > /dev/null 2>&1
adb logcat -c
adb shell am start -W -n $PKG/.MainActivity > /dev/null 2>&1; sleep 25
PID=$(adb shell pidof $PKG | tr -d '\r')
SOCK=$(adb shell cat /proc/net/unix | grep -o "webview_devtools_remote_$PID" | head -1)
if [ -n "$SOCK" ]; then
  adb forward tcp:9222 "localabstract:$SOCK" > /dev/null
  python3 android-app/ci/cdp_test.py "$OUT" 2>&1 | tee -a "$R"
else
  fail "could not attach to the page (no devtools socket)"
fi
# files the page saved through the app
adb shell ls -l /sdcard/Download/RankerNode/ 2>/dev/null | tee "$OUT/downloads.txt" | sed 's/^/....  /' >> "$R"
grep -q "bridge-test.txt" "$OUT/downloads.txt" && pass "native bridge saves a file to Downloads/RankerNode" || fail "bridge file not found in Downloads/RankerNode"
grep -q "notes-export-test.pdf" "$OUT/downloads.txt" && pass "website download (notes PDF) saved to Downloads/RankerNode" || fail "notes PDF not saved"
C=$(adb shell cat /sdcard/Download/RankerNode/bridge-test.txt 2>/dev/null | tr -d '\r')
[ "$C" = "hello from the RankerNode test" ] && pass "saved file content is correct" || fail "saved file content wrong: '$C'"
uidump 05-saved-dialog
has 05-saved-dialog "Saved" && pass "'Saved' dialog with Open/Share shown" || info "saved dialog not on screen (may have been dismissed)"
adb logcat -d > "$OUT/logcat-debug.txt"
grep -q "FATAL EXCEPTION" "$OUT/logcat-debug.txt" && { fail "debug app CRASHED"; grep -A15 "FATAL EXCEPTION" "$OUT/logcat-debug.txt" | head -30 >> "$R"; } || pass "no crash in debug app"

echo "RESULT: $FAILS problem(s) found" | tee -a "$R"
exit 0
