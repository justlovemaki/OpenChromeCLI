const fs = require('fs-extra');
const path = require('path');
const { execSync } = require('child_process');
const { glob } = require('glob');

const DIST_DIR = path.join(__dirname, 'dist');
const SRC_DIR = __dirname;
const SKILL_EXTENSION_ZIP = path.join(SRC_DIR, 'skills', 'browser-remote-control', 'assets', 'bridge-extension.zip');
const PACK_DIR = path.join(SRC_DIR, '.tmp-bridge-extension-pack');

function makeCrc32Table() {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) {
            c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[i] = c >>> 0;
    }
    return table;
}

const CRC32_TABLE = makeCrc32Table();

function crc32(buffer) {
    let crc = 0xffffffff;
    for (const byte of buffer) {
        crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

async function addZipEntry(zipPath, relativePath, data, offset) {
    const nameBuffer = Buffer.from(relativePath.replace(/\\/g, '/'));
    const dataBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const checksum = crc32(dataBuffer);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(0, 12);
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(dataBuffer.length, 18);
    header.writeUInt32LE(dataBuffer.length, 22);
    header.writeUInt16LE(nameBuffer.length, 26);
    header.writeUInt16LE(0, 28);
    await fs.appendFile(zipPath, Buffer.concat([header, nameBuffer, dataBuffer]));
    return {
        relativePath: relativePath.replace(/\\/g, '/'),
        nameBuffer,
        checksum,
        size: dataBuffer.length,
        offset
    };
}

async function makeStoredZip(sourceDir, zipPath) {
    await fs.ensureDir(path.dirname(zipPath));
    await fs.remove(zipPath);
    const files = await glob('**/*', { cwd: sourceDir, nodir: true, ignore: ['**/*.zip'] });
    const entries = [];
    let offset = 0;
    for (const file of files) {
        const data = await fs.readFile(path.join(sourceDir, file));
        entries.push(await addZipEntry(zipPath, file, data, offset));
        offset += 30 + Buffer.byteLength(file.replace(/\\/g, '/')) + data.length;
    }

    const centralDirectoryParts = [];
    let centralDirectorySize = 0;
    for (const entry of entries) {
        const header = Buffer.alloc(46);
        header.writeUInt32LE(0x02014b50, 0);
        header.writeUInt16LE(20, 4);
        header.writeUInt16LE(20, 6);
        header.writeUInt16LE(0, 8);
        header.writeUInt16LE(0, 10);
        header.writeUInt16LE(0, 12);
        header.writeUInt16LE(0, 14);
        header.writeUInt32LE(entry.checksum, 16);
        header.writeUInt32LE(entry.size, 20);
        header.writeUInt32LE(entry.size, 24);
        header.writeUInt16LE(entry.nameBuffer.length, 28);
        header.writeUInt16LE(0, 30);
        header.writeUInt16LE(0, 32);
        header.writeUInt16LE(0, 34);
        header.writeUInt16LE(0, 36);
        header.writeUInt32LE(0, 38);
        header.writeUInt32LE(entry.offset, 42);
        const part = Buffer.concat([header, entry.nameBuffer]);
        centralDirectoryParts.push(part);
        centralDirectorySize += part.length;
    }

    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(centralDirectorySize, 12);
    end.writeUInt32LE(offset, 16);
    end.writeUInt16LE(0, 20);

    await fs.appendFile(zipPath, Buffer.concat([...centralDirectoryParts, end]));
}

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

    console.log('Packing bundled extension for skill...');
    await fs.remove(PACK_DIR);
    await fs.ensureDir(PACK_DIR);
    const packFiles = await glob('**/*', {
        cwd: DIST_DIR,
        nodir: true,
        ignore: [
            'skills/browser-remote-control/assets/bridge-extension.zip'
        ]
    });
    for (const file of packFiles) {
        await fs.copy(path.join(DIST_DIR, file), path.join(PACK_DIR, file));
    }
    await makeStoredZip(PACK_DIR, SKILL_EXTENSION_ZIP);
    await fs.copy(SKILL_EXTENSION_ZIP, path.join(DIST_DIR, 'skills', 'browser-remote-control', 'assets', 'bridge-extension.zip'));
    await fs.remove(PACK_DIR);

    console.log('\nBridge build completed! Output is in bridge/dist');
}

build().catch(err => {
    console.error('Build failed:', err);
    process.exit(1);
});
