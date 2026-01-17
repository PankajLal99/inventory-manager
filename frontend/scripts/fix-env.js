// Node.js 25+ introduces a partial localStorage implementation that breaks @typescript/vfs
// This script detects the broken implementation and removes it so libraries fall back to their own polyfills

if (typeof localStorage !== 'undefined') {
    try {
        if (typeof localStorage.getItem !== 'function') {
            console.log('Detected broken localStorage (missing getItem), removing it to fix @typescript/vfs compatibility.');
            // Deleting the global reference
            delete global.localStorage;
        }
    } catch (e) {
        console.error('Error checking localStorage:', e);
    }
}
