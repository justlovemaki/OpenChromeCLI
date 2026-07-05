#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const net = require('net');
const { pathToFileURL } = require('url');
const { execFileSync, spawn } = require('child_process');

function findRootDir() {
    const candidates = [
        path.resolve(__dirname, '..', '..', '..'),
        path.resolve(__dirname, '..')
    ];
    for (const dir of candidates) {
        if (fs.existsSync(path.join(dir, 'manifest.json'))) return dir;
    }
    return path.resolve(__dirname, '..', '..', '..');
}

const rootDir = findRootDir();

function printUsage() {
    console.log(`Usage:
  node skills/browser-remote-control/scripts/launch-fingerprint-browser.js --browser <path> [options]
  node skills/browser-remote-control/scripts/launch-fingerprint-browser.js --cloakbrowser [options]

Required:
  --browser <path>              Chromium-compatible browser executable path, unless --cloakbrowser is used

Options:
  --cloakbrowser                Resolve the browser executable from CloakBrowser CLI
  --cloakbrowser-cli <value>    CloakBrowser CLI command. Default: auto (npx, then python)
  --profile <dir>               User data dir. Default: .browser-profiles/default
  --fresh-profile               Create a new user data dir for this launch
  --extension <dir>             Extension dir to load. Default: dist, or bundled skill zip fallback
  --extra-extension <dir>       Additional extension dir. Can be repeated
  --url <url>                   Initial URL. Default: about:blank
  --proxy-server <value>        Browser proxy server, e.g. http://127.0.0.1:7890
  --geoip                       CloakBrowser SDK mode: match timezone/locale to proxy IP
  --humanize                    CloakBrowser SDK mode: human-like mouse, keyboard, scroll
  --cloak-sdk                   Force CloakBrowser SDK persistent-context launch mode
  --no-cloak-sdk                Disable SDK mode and launch CloakBrowser binary directly
  --remote-debugging-port <n>   Open CDP port. Default: disabled
  --window-size <w,h>           Browser window size, e.g. 1280,900
  --headless                    Start headless mode if supported by the browser
  --arg <value>                 Extra browser argument. Can be repeated
  --wait-bridge-port            Wait for Agent Browser Bridge native port and print it
  --bridge-host <host>          Bridge host. Default: 127.0.0.1
  --bridge-start-port <n>       First bridge port to scan. Default: config or 9333
  --bridge-scan-count <n>       Number of ports to scan. Default: 50
  --bridge-token <value>        Bridge auth token. Default: config or built-in token
  --bridge-timeout <ms>         Wait timeout for bridge port. Default: 30000
  --dry-run                     Print command only
  --help                        Show this help

Examples:
  node skills/browser-remote-control/scripts/launch-fingerprint-browser.js --browser "C:\\Path\\To\\FingerprintBrowser.exe" --profile .browser-profiles/xhs --url https://www.xiaohongshu.com
  node skills/browser-remote-control/scripts/launch-fingerprint-browser.js --cloakbrowser --profile .browser-profiles/xhs --url https://www.xiaohongshu.com --wait-bridge-port
  node skills/browser-remote-control/scripts/launch-fingerprint-browser.js --browser "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --proxy-server http://127.0.0.1:7890 --remote-debugging-port 9222
`);
}

function parseArgs(argv) {
    const options = {
        extraExtensions: [],
        args: []
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const next = () => {
            if (i + 1 >= argv.length) throw new Error(`Missing value for ${arg}`);
            return argv[++i];
        };

        if (arg === '--help' || arg === '-h') options.help = true;
        else if (arg === '--browser') options.browser = next();
        else if (arg === '--cloakbrowser') options.cloakbrowser = true;
        else if (arg === '--cloakbrowser-cli') options.cloakbrowserCli = next();
        else if (arg === '--profile') options.profile = next();
        else if (arg === '--fresh-profile') options.freshProfile = true;
        else if (arg === '--extension') options.extension = next();
        else if (arg === '--extra-extension') options.extraExtensions.push(next());
        else if (arg === '--url') options.url = next();
        else if (arg === '--proxy-server') options.proxyServer = next();
        else if (arg === '--geoip') options.geoip = true;
        else if (arg === '--humanize') options.humanize = true;
        else if (arg === '--cloak-sdk') options.cloakSdk = true;
        else if (arg === '--no-cloak-sdk') options.noCloakSdk = true;
        else if (arg === '--remote-debugging-port') options.remoteDebuggingPort = next();
        else if (arg === '--window-size') options.windowSize = next();
        else if (arg === '--headless') options.headless = true;
        else if (arg === '--arg') options.args.push(next());
        else if (arg === '--wait-bridge-port') options.waitBridgePort = true;
        else if (arg === '--bridge-host') options.bridgeHost = next();
        else if (arg === '--bridge-start-port') options.bridgeStartPort = Number(next());
        else if (arg === '--bridge-scan-count') options.bridgeScanCount = Number(next());
        else if (arg === '--bridge-token') options.bridgeToken = next();
        else if (arg === '--bridge-timeout') options.bridgeTimeout = Number(next());
        else if (arg === '--dry-run') options.dryRun = true;
        else throw new Error(`Unknown argument: ${arg}`);
    }

    return options;
}

function resolveExistingDir(value, label) {
    const dir = path.resolve(rootDir, value);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
        throw new Error(`${label} does not exist or is not a directory: ${dir}`);
    }
    return dir;
}

function extractStoredZip(zipPath, destDir) {
    const buffer = fs.readFileSync(zipPath);
    let offset = 0;
    fs.mkdirSync(destDir, { recursive: true });

    while (offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
        const method = buffer.readUInt16LE(offset + 8);
        const compressedSize = buffer.readUInt32LE(offset + 18);
        const uncompressedSize = buffer.readUInt32LE(offset + 22);
        const nameLength = buffer.readUInt16LE(offset + 26);
        const extraLength = buffer.readUInt16LE(offset + 28);
        const nameStart = offset + 30;
        const dataStart = nameStart + nameLength + extraLength;
        const name = buffer.slice(nameStart, nameStart + nameLength).toString('utf8');

        if (method !== 0) throw new Error(`Unsupported zip compression method for ${name}: ${method}`);
        if (compressedSize !== uncompressedSize) throw new Error(`Invalid stored zip entry size for ${name}`);

        const destPath = path.resolve(destDir, name);
        const relativeDest = path.relative(path.resolve(destDir), destPath);
        if (relativeDest.startsWith('..') || path.isAbsolute(relativeDest)) throw new Error(`Unsafe zip entry path: ${name}`);
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.writeFileSync(destPath, buffer.slice(dataStart, dataStart + compressedSize));

        offset = dataStart + compressedSize;
    }
}

function resolveExtensionDir(value) {
    if (value) return resolveExistingDir(value, 'Extension directory');

    const distDir = path.join(rootDir, 'dist');
    if (fs.existsSync(path.join(distDir, 'manifest.json'))) return distDir;

    const bundledZip = path.resolve(__dirname, '..', 'assets', 'bridge-extension.zip');
    if (!fs.existsSync(bundledZip)) {
        throw new Error(`Extension directory not found: ${distDir}. Bundled extension zip is also missing: ${bundledZip}`);
    }

    const extractedDir = path.join(rootDir, '.browser-profiles', '.bridge-extension');
    const markerFile = path.join(extractedDir, '.extracted-from-bundle');
    const zipStat = fs.statSync(bundledZip);
    const marker = `${zipStat.size}:${zipStat.mtimeMs}`;
    if (!fs.existsSync(path.join(extractedDir, 'manifest.json')) || !fs.existsSync(markerFile) || fs.readFileSync(markerFile, 'utf8') !== marker) {
        fs.rmSync(extractedDir, { recursive: true, force: true });
        extractStoredZip(bundledZip, extractedDir);
        fs.writeFileSync(markerFile, marker);
    }

    return extractedDir;
}

function resolveProfileDir(value) {
    const dir = path.resolve(rootDir, value);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function resolveLaunchProfileDir(options) {
    if (!options.freshProfile) return resolveProfileDir(options.profile || '.browser-profiles/default');

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const suffix = `${stamp}-${process.pid}`;
    const base = options.profile || '.browser-profiles/private';
    return resolveProfileDir(`${base}-${suffix}`);
}

function quote(value) {
    const text = String(value);
    if (!/[\s"]/g.test(text)) return text;
    return `"${text.replace(/"/g, '\\"')}"`;
}

function commandName(name) {
    if (process.platform === 'win32' && (name === 'npx' || name === 'npm')) return `${name}.cmd`;
    return name;
}

function runJsonCommand(command, args) {
    const output = execFileSync(commandName(command), args, {
        cwd: rootDir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    });
    return JSON.parse(output);
}

function findExecutablePath(value) {
    const candidates = [];
    const seen = new Set();

    const visit = (item, key = '') => {
        if (item === null || item === undefined) return;
        if (typeof item === 'string') {
            const lowerKey = key.toLowerCase();
            const lowerValue = item.toLowerCase();
            if (
                lowerKey.includes('executable') ||
                lowerKey.includes('binary') ||
                lowerKey.endsWith('path') ||
                lowerValue.endsWith('.exe') ||
                lowerValue.includes('/chromium') ||
                lowerValue.includes('\\chromium') ||
                lowerValue.includes('/chrome') ||
                lowerValue.includes('\\chrome')
            ) {
                candidates.push(item);
            }
            return;
        }
        if (typeof item !== 'object') return;
        if (seen.has(item)) return;
        seen.add(item);
        for (const [childKey, childValue] of Object.entries(item)) {
            visit(childValue, childKey);
        }
    };

    visit(value);
    for (const candidate of candidates) {
        const resolved = path.resolve(rootDir, candidate);
        if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) return resolved;
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
    return '';
}

function resolveCloakBrowserExecutable(options) {
    const attempts = [];
    if (options.cloakbrowserCli) {
        const parts = options.cloakbrowserCli.split(/\s+/).filter(Boolean);
        attempts.push({ command: parts[0], args: [...parts.slice(1), 'info', '--quick', '--json'] });
    } else {
        attempts.push({ command: 'npx', args: ['cloakbrowser', 'info', '--quick', '--json'] });
        attempts.push({ command: 'python', args: ['-m', 'cloakbrowser', 'info', '--quick', '--json'] });
        attempts.push({ command: 'python3', args: ['-m', 'cloakbrowser', 'info', '--quick', '--json'] });
    }

    const errors = [];
    for (const attempt of attempts) {
        try {
            const info = runJsonCommand(attempt.command, attempt.args);
            const executable = findExecutablePath(info);
            if (executable) return executable;
            errors.push(`${attempt.command} ${attempt.args.join(' ')}: no executable path found in JSON output`);
        } catch (error) {
            errors.push(`${attempt.command} ${attempt.args.join(' ')}: ${error.message}`);
        }
    }

    throw new Error(`Unable to resolve CloakBrowser executable. Install cloakbrowser first or pass --browser manually. Attempts: ${errors.join(' | ')}`);
}

function resolveCloakBrowserImportSpecifier() {
    const candidates = [
        path.join(rootDir, 'node_modules', 'cloakbrowser', 'dist', 'index.js'),
        path.join(path.dirname(process.execPath), 'node_modules', 'cloakbrowser', 'dist', 'index.js')
    ];

    try {
        const globalRoot = execFileSync(commandName('npm'), ['root', '-g'], {
            cwd: rootDir,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        }).trim();
        if (globalRoot) candidates.push(path.join(globalRoot, 'cloakbrowser', 'dist', 'index.js'));
    } catch {}

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return pathToFileURL(candidate).href;
    }

    throw new Error('CloakBrowser SDK module not found. Install the Node package with: npm install -g cloakbrowser playwright-core');
}

function loadBridgeConfig(options) {
    const configPath = path.join(rootDir, 'host', 'config.json');
    let config = {};
    try {
        if (fs.existsSync(configPath)) {
            config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        }
    } catch (error) {
        console.warn(`Warning: failed to read bridge config: ${error.message}`);
    }

    return {
        host: options.bridgeHost || '127.0.0.1',
        startPort: Number(options.bridgeStartPort || config.port || 9333),
        scanCount: Number(options.bridgeScanCount || 50),
        token: options.bridgeToken || config.token || process.env.SEO_TOKEN || 'bridge-relay-secure-token-2026',
        timeoutMs: Number(options.bridgeTimeout || 30000)
    };
}

function splitCommand(value) {
    return String(value || '').split(/\s+/).filter(Boolean);
}

function buildCloakSdkOptions(options, profileDir, extensionDirs, browserArgs) {
    return {
        userDataDir: profileDir,
        headless: options.headless === true ? true : false,
        proxy: options.proxyServer || undefined,
        geoip: !!options.geoip,
        humanize: !!options.humanize,
        extensionPaths: extensionDirs,
        args: browserArgs.filter(arg => !arg.startsWith('--user-data-dir=') && !arg.startsWith('--load-extension=') && !arg.startsWith('--disable-extensions-except=')),
        startUrl: options.url || 'about:blank'
    };
}

function createCloakSdkLauncher(options, profileDir, extensionDirs, browserArgs) {
    const launcherDir = path.join(rootDir, '.browser-profiles', '.launchers');
    fs.mkdirSync(launcherDir, { recursive: true });
    const launcherPath = path.join(launcherDir, `cloak-launch-${Date.now()}-${process.pid}.mjs`);
    const sdkOptions = buildCloakSdkOptions(options, profileDir, extensionDirs, browserArgs);
    const cloakImport = resolveCloakBrowserImportSpecifier();
    const code = `
import { launchPersistentContext } from ${JSON.stringify(cloakImport)};

const options = ${JSON.stringify(sdkOptions, null, 2)};

const context = await launchPersistentContext({
  userDataDir: options.userDataDir,
  headless: options.headless,
  proxy: options.proxy,
  geoip: options.geoip,
  humanize: options.humanize,
  extensionPaths: options.extensionPaths,
  args: options.args
});

const page = context.pages()[0] || await context.newPage();
if (options.startUrl && options.startUrl !== 'about:blank') {
  await page.goto(options.startUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
}

console.log(JSON.stringify({ status: 'started', pid: process.pid }));

const shutdown = async () => {
  try { await context.close(); } catch {}
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
setInterval(() => {}, 1 << 30);
`;
    fs.writeFileSync(launcherPath, code, 'utf8');
    return launcherPath;
}

function queryBridgePort(host, port, token, timeoutMs = 800) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        let buffer = '';
        let authenticated = false;
        let done = false;

        const finish = (value) => {
            if (done) return;
            done = true;
            socket.destroy();
            resolve(value);
        };

        socket.setTimeout(timeoutMs);
        socket.on('connect', () => {
            socket.write(`${token}\n`);
        });
        socket.on('data', (data) => {
            buffer += data.toString();
            let boundary;
            while ((boundary = buffer.indexOf('\n')) !== -1) {
                const line = buffer.slice(0, boundary).trim();
                buffer = buffer.slice(boundary + 1);
                if (!line) continue;

                let msg;
                try {
                    msg = JSON.parse(line);
                } catch (error) {
                    finish(null);
                    return;
                }

                if (!authenticated) {
                    if (msg.status === 'authenticated') {
                        authenticated = true;
                        socket.write(JSON.stringify({ jsonrpc: '2.0', id: 'status', method: 'getHostStatus' }) + '\n');
                        continue;
                    }
                    finish(null);
                    return;
                }

                if (msg.id === 'status' && msg.result?.chromeConnected) {
                    finish({ port, status: msg.result });
                    return;
                }
            }
        });
        socket.on('timeout', () => finish(null));
        socket.on('error', () => finish(null));
        socket.on('end', () => finish(null));
        socket.connect(port, host);
    });
}

async function scanBridgePorts(config) {
    const probes = [];
    for (let i = 0; i < config.scanCount; i++) {
        probes.push(queryBridgePort(config.host, config.startPort + i, config.token));
    }
    const results = await Promise.all(probes);
    return results.filter(Boolean).sort((a, b) => a.port - b.port);
}

async function waitForNewBridgePort(config, beforePorts) {
    const before = new Set(beforePorts.map(item => item.port));
    const started = Date.now();
    while (Date.now() - started < config.timeoutMs) {
        const current = await scanBridgePorts(config);
        const created = current.find(item => !before.has(item.port));
        if (created) return created;
        await new Promise(resolve => setTimeout(resolve, 800));
    }
    return null;
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        printUsage();
        return;
    }

    if (!options.browser && !options.cloakbrowser) throw new Error('Missing required --browser or --cloakbrowser');
    const useCloakSdk = options.cloakbrowser && !options.noCloakSdk;
    const browserPath = useCloakSdk
        ? ''
        : options.cloakbrowser
            ? resolveCloakBrowserExecutable(options)
            : path.resolve(rootDir, options.browser);
    if (!useCloakSdk && (!fs.existsSync(browserPath) || !fs.statSync(browserPath).isFile())) {
        throw new Error(`Browser executable does not exist: ${browserPath}`);
    }

    const profileDir = resolveLaunchProfileDir(options);
    const extensionDirs = [
        resolveExtensionDir(options.extension),
        ...options.extraExtensions.map(dir => resolveExistingDir(dir, 'Extra extension directory'))
    ];

    const browserArgs = [
        `--user-data-dir=${profileDir}`,
        `--disable-extensions-except=${extensionDirs.join(',')}`,
        `--load-extension=${extensionDirs.join(',')}`,
        '--no-first-run',
        '--no-default-browser-check'
    ];

    if (options.proxyServer && !useCloakSdk) browserArgs.push(`--proxy-server=${options.proxyServer}`);
    if (options.remoteDebuggingPort) browserArgs.push(`--remote-debugging-port=${options.remoteDebuggingPort}`);
    if (options.windowSize) browserArgs.push(`--window-size=${options.windowSize}`);
    if (options.headless && !useCloakSdk) browserArgs.push('--headless=new');
    browserArgs.push(...options.args);
    if (!useCloakSdk) browserArgs.push(options.url || 'about:blank');

    const bridgeConfig = loadBridgeConfig(options);
    const bridgePortsBefore = options.waitBridgePort && !options.dryRun
        ? await scanBridgePorts(bridgeConfig)
        : [];

    console.log('Launching browser:');
    if (useCloakSdk) {
        const launcherPath = createCloakSdkLauncher(options, profileDir, extensionDirs, browserArgs);
        console.log([quote(process.execPath), quote(launcherPath)].join(' '));
    } else {
        console.log([quote(browserPath), ...browserArgs.map(quote)].join(' '));
    }

    if (options.dryRun) return;

    const child = useCloakSdk
        ? spawn(process.execPath, [createCloakSdkLauncher(options, profileDir, extensionDirs, browserArgs)], {
            detached: true,
            stdio: 'ignore',
            cwd: rootDir
        })
        : spawn(browserPath, browserArgs, {
        detached: true,
        stdio: 'ignore'
    });
    child.unref();
    console.log(`Started browser process PID: ${child.pid}`);
    console.log(`Profile: ${profileDir}`);
    console.log(`Loaded extensions: ${extensionDirs.join(', ')}`);
    if (useCloakSdk) {
        console.log(`CloakBrowser SDK flags: proxy=${options.proxyServer ? 'set' : 'none'}, geoip=${!!options.geoip}, headless=${!!options.headless}, humanize=${!!options.humanize}`);
    }

    if (options.waitBridgePort) {
        console.log('Waiting for bridge port...');
        const bridge = await waitForNewBridgePort(bridgeConfig, bridgePortsBefore);
        if (!bridge) {
            console.log('Bridge port: not detected before timeout');
            process.exitCode = 2;
            return;
        }
        console.log(`Bridge port: ${bridge.port}`);
        console.log(JSON.stringify({ bridgePort: bridge.port, pid: bridge.status.pid }, null, 2));
    }
}

try {
    Promise.resolve(main()).catch((error) => {
        console.error(`Error: ${error.message}`);
        printUsage();
        process.exit(1);
    });
} catch (error) {
    console.error(`Error: ${error.message}`);
    printUsage();
    process.exit(1);
}
