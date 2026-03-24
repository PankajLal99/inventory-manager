// Ensures android/local.properties exists with the correct sdk.dir
const fs = require('fs');
const path = require('path');
const os = require('os');

const androidDir = path.join(__dirname, '..', 'android');
const localProps = path.join(androidDir, 'local.properties');
const sdkDir = process.env.ANDROID_HOME || path.join(os.homedir(), 'Library', 'Android', 'sdk');

if (!fs.existsSync(androidDir)) {
  // android/ doesn't exist yet; prebuild will create it
  process.exit(0);
}

const content = `sdk.dir=${sdkDir}\n`;

if (fs.existsSync(localProps)) {
  const existing = fs.readFileSync(localProps, 'utf8');
  if (existing.includes('sdk.dir=')) {
    process.exit(0); // already set
  }
}

fs.writeFileSync(localProps, content);
console.log(`✅ Wrote sdk.dir to ${localProps}`);
