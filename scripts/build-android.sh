#!/usr/bin/env bash
# Builds Pulse for Android on this computer — no Expo account or cloud build needed.
#
#   npm run build:android
#
# The finished app lands in dist/pulse.apk. Copy it to a phone and open it to install.
set -euo pipefail

cd "$(dirname "$0")/.."

export JAVA_HOME="${JAVA_HOME:-$(ls -d "$HOME"/.local/jdk/jdk-17* | head -1)}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"

# The android folder is generated from app.json; make it if it is missing.
[ -d android ] || CI=1 npx expo prebuild --platform android --no-install

# Real phones only (not emulators), which roughly halves the build time.
(cd android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a,armeabi-v7a)

mkdir -p dist
cp android/app/build/outputs/apk/release/app-release.apk dist/pulse.apk
echo
echo "Done: dist/pulse.apk"
