#!/usr/bin/env bash
# SELECTA — poste candidat verrouillé (mode kiosque Chrome/Chromium)
# Usage : ./selecta-poste-candidat.sh http://192.168.1.10:8069
SERVER="${1:-http://192.168.1.10:8069}"
PROFILE="$(mktemp -d /tmp/selecta-kiosk-XXXX)"
BROWSER="$(command -v google-chrome || command -v chromium || command -v chromium-browser || command -v microsoft-edge)"
[[ -n "$BROWSER" ]] || { echo "Chrome, Chromium ou Edge est requis."; exit 1; }
exec "$BROWSER" --kiosk "$SERVER/selecta/exam" \
  --user-data-dir="$PROFILE" \
  --unsafely-treat-insecure-origin-as-secure="$SERVER" \
  --use-fake-ui-for-media-stream \
  --no-first-run --no-default-browser-check --disable-extensions \
  --disable-features=Translate,TranslateUI --overscroll-history-navigation=0 --incognito
