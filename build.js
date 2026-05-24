const fs = require('fs-extra');
const path = require('path');
const { execSync } = require('child_process');
const { glob } = require('glob');

const DIST_DIR = path.join(__dirname, 'dist');
const SRC_DIR = __dirname;

async function build() {
    console.log('Starting standalone bridge build...');

    // 1. Clear dist folder
    if (fs.existsSync(DIST_DIR)) {
        await fs.remove(DIST_DIR);
    }
    await fs.ensureDir(DIST_DIR);

    // 2. Run TypeScript compiler
    console.log('Compiling TypeScript...');
    try {
        execSync('npx tsc', { stdio: 'inherit', cwd: SRC_DIR });
    } catch (err) {
        console.warn('TypeScript compilation finished (check for errors above).');
    }

    // 3. Define files to copy (non-TS assets)
    const assets = [
        'manifest.json',
        'popup.html',
        'icons/**',
        'host/**',
        'skills/**',
        'LICENSE',
        'README.md'
    ];

    console.log('Copying assets...');
    for (const pattern of assets) {
        const files = await glob(pattern, { cwd: SRC_DIR, nodir: true });
        for (const file of files) {
            const srcPath = path.join(SRC_DIR, file);
            const destPath = path.join(DIST_DIR, file);
            await fs.ensureDir(path.dirname(destPath));
            await fs.copy(srcPath, destPath);
        }
    }

    console.log('\nBridge build completed! Output is in bridge/dist');
}

build().catch(err => {
    console.error('Build failed:', err);
    process.exit(1);
});
