#!/usr/bin/env node

function printUsage() {
    console.log(`Usage:
  node skills/browser-remote-control/scripts/read-login-env.js [options]

Options:
  --site <name>       Site prefix, e.g. xhs reads XHS_EMAIL, XHS_USERNAME, XHS_ACCOUNT, XHS_PASSWORD
  --prefix <name>     Explicit env prefix. Overrides --site
  --env-file <path>   Load variables from a .env file before reading credentials
  --reveal-secret     Include password in output. Use only immediately before form filling
  --help              Show this help

Generic env names:
  LOGIN_EMAIL, LOGIN_USERNAME, LOGIN_ACCOUNT, LOGIN_PASSWORD
  BROWSER_LOGIN_EMAIL, BROWSER_LOGIN_USERNAME, BROWSER_LOGIN_ACCOUNT, BROWSER_LOGIN_PASSWORD

Site-prefixed env names:
  <PREFIX>_EMAIL, <PREFIX>_USERNAME, <PREFIX>_ACCOUNT, <PREFIX>_PASSWORD
`);
}

const fs = require('fs');
const path = require('path');

function findRootDir() {
    const candidates = [
        process.cwd(),
        path.resolve(__dirname, '..', '..', '..'),
        path.resolve(__dirname, '..')
    ];
    for (const dir of candidates) {
        if (fs.existsSync(path.join(dir, 'manifest.json')) || fs.existsSync(path.join(dir, 'package.json'))) return dir;
    }
    return process.cwd();
}

function parseArgs(argv) {
    const options = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const next = () => {
            if (i + 1 >= argv.length) throw new Error(`Missing value for ${arg}`);
            return argv[++i];
        };

        if (arg === '--help' || arg === '-h') options.help = true;
        else if (arg === '--site') options.site = next();
        else if (arg === '--prefix') options.prefix = next();
        else if (arg === '--env-file') options.envFile = next();
        else if (arg === '--reveal-secret') options.revealSecret = true;
        else throw new Error(`Unknown argument: ${arg}`);
    }
    return options;
}

function parseDotenvValue(raw) {
    let value = String(raw || '').trim();
    if (!value) return '';

    const quote = value[0];
    if ((quote === '"' || quote === "'") && value[value.length - 1] === quote) {
        value = value.slice(1, -1);
        if (quote === '"') {
            value = value.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
        }
        return value;
    }

    const hashIndex = value.search(/\s#/);
    if (hashIndex !== -1) value = value.slice(0, hashIndex).trim();
    return value;
}

function loadDotenvFile(filePath) {
    if (!fs.existsSync(filePath)) return false;
    const content = fs.readFileSync(filePath, 'utf8');
    for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
        if (!match) continue;
        const key = match[1];
        if (process.env[key] !== undefined) continue;
        process.env[key] = parseDotenvValue(match[2]);
    }
    return true;
}

function loadDotenv(options) {
    const rootDir = findRootDir();
    const candidates = [];
    if (options.envFile) candidates.push(path.resolve(rootDir, options.envFile));
    candidates.push(path.join(rootDir, '.env'));
    candidates.push(path.join(process.cwd(), '.env'));
    candidates.push(path.resolve(__dirname, '..', '.env'));

    const loaded = [];
    for (const file of [...new Set(candidates)]) {
        if (loadDotenvFile(file)) loaded.push(file);
    }
    return loaded;
}

function normalizePrefix(value) {
    return String(value || '')
        .trim()
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toUpperCase();
}

function firstEnv(names) {
    for (const name of names) {
        const value = process.env[name];
        if (value !== undefined && value !== '') return { name, value };
    }
    return null;
}

function readLoginEnv(options) {
    const envFiles = loadDotenv(options);
    const prefix = normalizePrefix(options.prefix || options.site);
    const prefixed = (field) => prefix ? [`${prefix}_${field}`] : [];

    const fields = {
        email: firstEnv([...prefixed('EMAIL'), 'LOGIN_EMAIL', 'BROWSER_LOGIN_EMAIL']),
        username: firstEnv([...prefixed('USERNAME'), 'LOGIN_USERNAME', 'BROWSER_LOGIN_USERNAME']),
        account: firstEnv([...prefixed('ACCOUNT'), 'LOGIN_ACCOUNT', 'BROWSER_LOGIN_ACCOUNT']),
        password: firstEnv([...prefixed('PASSWORD'), 'LOGIN_PASSWORD', 'BROWSER_LOGIN_PASSWORD'])
    };

    const result = {
        ok: Object.values(fields).some(Boolean),
        prefix: prefix || null,
        envFiles,
        fields: {},
        sources: {}
    };

    for (const [field, entry] of Object.entries(fields)) {
        if (!entry) continue;
        result.sources[field] = entry.name;
        if (field === 'password' && !options.revealSecret) {
            result.fields[field] = { present: true, redacted: true, length: entry.value.length };
        } else {
            result.fields[field] = entry.value;
        }
    }

    return result;
}

try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        printUsage();
        process.exit(0);
    }
    console.log(JSON.stringify(readLoginEnv(options), null, 2));
} catch (error) {
    console.error(`Error: ${error.message}`);
    printUsage();
    process.exit(1);
}
