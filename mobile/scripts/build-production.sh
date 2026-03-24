#!/bin/bash
set -euo pipefail

# Inventory Manager Production Build Script
# This script builds the Android AAB for Play Store submission

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

echo "🚀 Building Inventory Manager for Play Store..."

# Set environment variables
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export PATH="$PATH:$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools"

# Get version from package.json
VERSION=$(grep '"version":' package.json | head -1 | cut -d'"' -f4)
echo "📦 Version: $VERSION"

# Regenerate native android/ from app.json (picks up version, permissions, plugins, signing)
echo "🔄 Running expo prebuild --clean to sync native files..."
KEYSTORE="inventory-manager-release.keystore"
npx expo prebuild --clean --platform android --no-install

# Copy keystore + properties so the withReleaseSigningConfig plugin's generated Gradle code can find them
echo "📝 Setting up production signing..."
cp "$KEYSTORE" android/app/
cat > android/keystore.properties << EOF
storeFile=$KEYSTORE
storePassword=inventorymanager123
keyAlias=inventory-manager-key
keyPassword=inventorymanager123
EOF

# Clean all previous Android outputs, then build the AAB
echo "📱 Building AAB for Play Store..."
bash "$SCRIPT_DIR/android-gradle-clean.sh"
cd android
./gradlew bundleRelease

echo "✅ Build successful!"

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
OUTPUT_FILE="InventoryManager-v${VERSION}-PlayStore-${TIMESTAMP}.aab"
cp app/build/outputs/bundle/release/app-release.aab "../$OUTPUT_FILE"

echo "📦 AAB created: $OUTPUT_FILE"
echo "📁 Location: $PROJECT_ROOT/$OUTPUT_FILE"
echo "📏 Size: $(ls -lh "../$OUTPUT_FILE" | awk '{print $5}')"

echo ""
echo "🎉 Inventory Manager production build completed successfully!"
echo "📱 The AAB is ready for Play Store submission."
echo ""
echo "🔑 Production Keystore Information:"
keytool -list -v -keystore "../$KEYSTORE" -alias inventory-manager-key -storepass inventorymanager123 | grep -E "SHA1:|SHA256:" || true
echo ""
echo "⚠️  IMPORTANT: Keep your keystore file safe! You'll need it for all future updates."
