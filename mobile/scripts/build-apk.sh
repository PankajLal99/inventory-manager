#!/usr/bin/env bash
set -euo pipefail

# Inventory Manager APK Build Script
# This script builds the Android APK

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

echo "🚀 Building Inventory Manager APK..."

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export PATH="$PATH:$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools"

VERSION=$(grep '"version":' package.json | head -1 | cut -d'"' -f4)
echo "📦 Version: $VERSION"

bash "$SCRIPT_DIR/android-gradle-clean.sh"
echo "📱 Building APK..."
npx expo run:android --variant release

echo "✅ Build successful!"
OUTPUT_FILE="InventoryManager-v${VERSION}.apk"
cp android/app/build/outputs/apk/release/app-release.apk "$OUTPUT_FILE"

echo "📦 APK created: $OUTPUT_FILE"
echo "📁 Location: $(pwd)/$OUTPUT_FILE"
echo "📏 Size: $(ls -lh "$OUTPUT_FILE" | awk '{print $5}')"
echo ""
echo "🎉 Inventory Manager APK build completed successfully!"
