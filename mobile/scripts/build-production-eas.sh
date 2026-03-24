#!/bin/bash

# Inventory Manager Production Build Script using EAS
# This script builds the Android AAB for Play Store submission using EAS Build

echo "🚀 Building Inventory Manager for Play Store using EAS..."

# Check if EAS CLI is installed
if ! command -v eas &> /dev/null; then
    echo "❌ EAS CLI not found. Installing..."
    npm install -g @expo/eas-cli
fi

# Check if user is logged in to EAS
if ! eas whoami &> /dev/null; then
    echo "🔐 Please login to EAS first:"
    echo "   eas login"
    exit 1
fi

# Create production keystore if it doesn't exist
KEYSTORE="inventory-manager-release.keystore"
if [ ! -f "$KEYSTORE" ]; then
    echo "🔑 Creating production keystore..."
    keytool -genkey -v -keystore "$KEYSTORE" -alias inventory-manager-key -keyalg RSA -keysize 2048 -validity 10000 -storepass inventorymanager123 -keypass inventorymanager123 -dname "CN=Inventory Manager, OU=Development, O=Inventory Manager, L=City, ST=State, C=IN"
fi

# Get keystore SHA fingerprints
echo "🔍 Getting production keystore fingerprints..."
keytool -list -v -keystore "$KEYSTORE" -alias inventory-manager-key -storepass inventorymanager123 | grep -E "SHA1:|SHA256:"

# Upload keystore to EAS
echo "📤 Uploading keystore to EAS..."
eas credentials:configure

# Build for production
echo "📱 Building AAB for Play Store..."
eas build --platform android --profile production --non-interactive

# Check if build was successful
if [ $? -eq 0 ]; then
    echo "✅ Build successful!"
    echo ""
    echo "🎉 Inventory Manager production build completed successfully!"
    echo "📱 The AAB is ready for Play Store submission."
    echo ""
    echo "🔑 Production Keystore Information:"
    keytool -list -v -keystore "$KEYSTORE" -alias inventory-manager-key -storepass inventorymanager123 | grep -E "SHA1:|SHA256:"
    echo ""
    echo "⚠️  IMPORTANT: Keep your keystore file safe! You'll need it for all future updates."
    echo "📱 Download your AAB from: https://expo.dev/accounts/itspankaj/projects/inventory-manager/builds"
else
    echo "❌ Build failed!"
    exit 1
fi
