#!/bin/bash
set -euo pipefail

# Inventory Manager Local Production Build Script
# This script builds the Android APK with production configuration

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

echo "🚀 Building Inventory Manager for Production (Local)..."

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export PATH="$PATH:$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools"

VERSION=$(grep '"version":' package.json | head -1 | cut -d'"' -f4)
echo "📦 Version: $VERSION"

# Create production keystore if it doesn't exist
KEYSTORE="inventory-manager-release.keystore"
if [ ! -f "$KEYSTORE" ]; then
    echo "🔑 Creating production keystore..."
    keytool -genkey -v -keystore "$KEYSTORE" -alias inventory-manager-key -keyalg RSA -keysize 2048 -validity 10000 -storepass inventorymanager123 -keypass inventorymanager123 -dname "CN=Inventory Manager, OU=Development, O=Inventory Manager, L=City, ST=State, C=IN"
fi

# Get keystore SHA fingerprints
echo "🔍 Production Keystore Fingerprints:"
keytool -list -v -keystore "$KEYSTORE" -alias inventory-manager-key -storepass inventorymanager123 | grep -E "SHA1:|SHA256:"

# Regenerate native android/ from app.json (picks up version, permissions, plugins, signing)
echo "🔄 Running expo prebuild --clean to sync native files..."
npx expo prebuild --clean --platform android --no-install

# Copy keystore + properties so the withReleaseSigningConfig plugin's generated Gradle code can find them
cp "$KEYSTORE" android/app/
cat > android/keystore.properties << EOF
storeFile=$KEYSTORE
storePassword=inventorymanager123
keyAlias=inventory-manager-key
keyPassword=inventorymanager123
EOF

echo "📱 Building APK with production configuration..."
bash "$SCRIPT_DIR/android-gradle-clean.sh"

# Build release APK via Gradle directly (expo run:android can fail
# resolving the app identifier with per-CPU splits enabled).
cd android
./gradlew assembleRelease
cd ..

echo "✅ Build successful!"

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")

# With enableSeparateBuildPerCPUArchitecture the APK is per-ABI; grab the universal or first available
APK_DIR="android/app/build/outputs/apk/release"
APK_FILE=$(find "$APK_DIR" -name "*.apk" | head -1)
if [ -z "$APK_FILE" ]; then
    echo "❌ No APK found in $APK_DIR"
    exit 1
fi

OUTPUT_FILE="InventoryManager-v${VERSION}-Production-${TIMESTAMP}.apk"
cp "$APK_FILE" "$OUTPUT_FILE"

echo "📦 APK created: $OUTPUT_FILE"
echo "📁 Location: $PROJECT_ROOT/$OUTPUT_FILE"
echo "📏 Size: $(ls -lh "$OUTPUT_FILE" | awk '{print $5}')"

echo ""
echo "🎉 Inventory Manager production build completed successfully!"
echo "📱 The APK is ready for testing and distribution."
echo ""
echo "🔑 Production Keystore Information:"
keytool -list -v -keystore "$KEYSTORE" -alias inventory-manager-key -storepass inventorymanager123 | grep -E "SHA1:|SHA256:" || true
echo ""
echo "⚠️  IMPORTANT: Keep your keystore file safe! You'll need it for all future updates."
echo "📱 For Play Store AAB, use: bash scripts/build-production.sh"
