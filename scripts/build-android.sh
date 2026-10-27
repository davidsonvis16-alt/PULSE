#!/usr/bin/env bash
# Builds Pulse for Android on this computer — no Expo account or cloud build needed.
#
#   npm run build:android
#
# The finished app lands in release/pulse.apk. Send that file to a phone and open it to install.
#
# It is signed with Pulse's own key from ~/.pulse (kept outside the project so
# it never reaches git). Every version must be signed with that same key, or
# phones refuse to install an update over the old one — so back that folder up.
set -euo pipefail

cd "$(dirname "$0")/.."

export JAVA_HOME="${JAVA_HOME:-$(ls -d "$HOME"/.local/jdk/jdk-17* | head -1)}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"

SIGNING="$HOME/.pulse/signing.properties"
if [ ! -f "$SIGNING" ]; then
  echo "No signing key found at $SIGNING." >&2
  echo "Restore your backup of ~/.pulse, or make a new key (new installs only)." >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$SIGNING"

# The android folder is generated from app.json; regenerate it so it always
# matches the current config.
CI=1 npx expo prebuild --platform android --clean --no-install

# Real phones only (not emulators), which roughly halves the build time. The
# build tool's default 2 GB runs out while packing the app's code, so it gets 4.
(cd android && ./gradlew assembleRelease \
  -Dorg.gradle.jvmargs="-Xmx4g -XX:MaxMetaspaceSize=1g -Dfile.encoding=UTF-8" \
  -PreactNativeArchitectures=arm64-v8a,armeabi-v7a \
  -Pandroid.injected.signing.store.file="$PULSE_KEYSTORE" \
  -Pandroid.injected.signing.store.password="$PULSE_KEYSTORE_PASSWORD" \
  -Pandroid.injected.signing.key.alias="$PULSE_KEY_ALIAS" \
  -Pandroid.injected.signing.key.password="$PULSE_KEYSTORE_PASSWORD")

mkdir -p release
cp android/app/build/outputs/apk/release/app-release.apk release/pulse.apk
echo
echo "Done: release/pulse.apk"
