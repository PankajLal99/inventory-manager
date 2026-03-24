#!/usr/bin/env bash
# Full Gradle clean of the Android tree (build/, intermediates, reports).
# Run from any cwd; resolves repo root from this file's location.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export PATH="$PATH:$ANDROID_HOME/platform-tools"

if [[ ! -x "$PROJECT_ROOT/android/gradlew" ]]; then
  echo "⚠️  android/gradlew not found. Run: npx expo prebuild --platform android"
  exit 1
fi

echo "🧹 Removing CMake/native cache (app/.cxx)..."
rm -rf "$PROJECT_ROOT/android/app/.cxx"

echo "🧹 Gradle clean (skipping externalNativeBuildClean* — those re-run CMake and fail when codegen jni dirs are missing)..."
node ./scripts/ensure-android-local-properties.cjs
(
  cd "$PROJECT_ROOT/android"
  ./gradlew clean \
    -x :app:externalNativeBuildCleanDebug \
    -x :app:externalNativeBuildCleanDebugOptimized \
    -x :app:externalNativeBuildCleanRelease \
    -x :expo-modules-core:externalNativeBuildCleanDebug \
    -x :expo-modules-core:externalNativeBuildCleanRelease \
    -x :react-native-gesture-handler:externalNativeBuildCleanDebug \
    -x :react-native-gesture-handler:externalNativeBuildCleanRelease \
    -x :react-native-screens:externalNativeBuildCleanDebug \
    -x :react-native-screens:externalNativeBuildCleanRelease
)
