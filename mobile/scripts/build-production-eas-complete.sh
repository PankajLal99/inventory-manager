#!/bin/bash

# Inventory Manager Complete Production Build Script using EAS
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

# Display current EAS secrets
echo "🔍 Current EAS Secrets:"
eas secret:list

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
    echo "⚠️  IMPORTANT: Keep your keystore file safe! You'll need it for all future updates."
    echo "📱 Download your AAB from: https://expo.dev/accounts/itspankaj/projects/inventory-manager/builds"
    echo ""
    echo "📋 Next Steps for Play Store:"
    echo "   1. Add SHA1 fingerprint to Google Play Console"
    echo "   2. Download the AAB file from EAS"
    echo "   3. Upload AAB to Play Store"
    echo "   4. Configure app listing and release"
else
    echo "❌ Build failed!"
    exit 1
fi
