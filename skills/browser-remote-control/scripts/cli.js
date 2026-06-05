const net = require('net');
const fs = require('fs');
const path = require('path');

let SECRET_TOKEN = process.env.SEO_TOKEN || 'bridge-relay-secure-token-2026';

// 如果环境变量没设，尝试从配置文件读取
if (SECRET_TOKEN === 'bridge-relay-secure-token-2026') {
    try {
        const configPath = path.join(__dirname, '..', '..', '..', 'native-host', 'config.json');
        if (fs.existsSync(configPath)) {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            if (config.token) {
                SECRET_TOKEN = config.token;
            }
        }
    } catch (e) {}
}

let PORT = 9333;

const args = process.argv.slice(2);
if (args.length < 1) {
    console.log('Usage: node cli.js <method> [params_json] [host] [port] [token]');
    console.log('   or: node cli.js <method> [params_json] [host:port] [token]');
    process.exit(1);
}

function tryParseRelaxedJson(str) {
    const trimmed = str.trim();
    if (!trimmed) return {};

    // 1. 尝试标准 JSON 解析
    try {
        return JSON.parse(trimmed);
    } catch (e) {}

    // 2. 尝试 JavaScript 对象求值（处理单引号或未加引号的键）
    try {
        const fn = new Function(`return (${trimmed});`);
        const val = fn();
        if (val && typeof val === 'object') {
            return val;
        }
    } catch (e) {}

    // 3. 智能解析大括号或纯键值对格式（对 URL 查询参数有防误切设计）
    try {
        let content = trimmed;
        const isBraced = trimmed.startsWith('{') && trimmed.endsWith('}');
        if (isBraced) {
            content = trimmed.slice(1, -1).trim();
        }

        // 大括号内参数只能以逗号分隔；非大括号下支持逗号和 & 分隔，但有防 URL 查询参数误判机制
        const keyRegex = isBraced 
            ? /(?:^|,)\s*['"]?([a-zA-Z0-9_$]+)['"]?\s*[:=]/g 
            : /(?:^|[,&])\s*['"]?([a-zA-Z0-9_$]+)['"]?\s*[:=]/g;

        const matches = [];
        let match;
        while ((match = keyRegex.exec(content)) !== null) {
            const key = match[1].trim();
            const index = match.index;
            const length = match[0].length;

            // 避坑：如果不是大括号包裹，并且前一个键的值包含了 "?"（说明进入了 URL Query 区域），
            // 此时如果遇到以 & 开头的匹配（例如 &opt=1），则需要判定为 URL 参数，不当作主参数的键
            if (!isBraced && matches.length > 0) {
                const prev = matches[matches.length - 1];
                const prevValueStart = prev.index + prev.length;
                const betweenStr = content.slice(prevValueStart, index);
                if (betweenStr.includes('?') && match[0].trim().startsWith('&')) {
                    continue;
                }
            }

            matches.push({
                key,
                index,
                length: match[0].length
            });
        }

        if (matches.length > 0) {
            const params = {};
            for (let i = 0; i < matches.length; i++) {
                const current = matches[i];
                const next = matches[i + 1];
                const valueStart = current.index + current.length;
                const valueEnd = next ? next.index : content.length;
                
                let valStr = content.slice(valueStart, valueEnd).trim();
                valStr = valStr.replace(/^[,&]+|[,&]+$/g, '').trim();
                valStr = valStr.replace(/^['"]|['"]$/g, '').trim();
                
                let val = valStr;
                if (valStr === 'true') val = true;
                else if (valStr === 'false') val = false;
                else if (valStr === 'null') val = null;
                else if (valStr === 'undefined') val = undefined;
                else if (!isNaN(Number(valStr)) && valStr !== '') val = Number(valStr);
                
                params[current.key] = val;
            }
            return params;
        }
    } catch (e) {}

    // 4. 尝试修复未加引号的极简值（后备兜底）
    try {
        let cleaned = trimmed;
        if (cleaned.startsWith('{') && cleaned.endsWith('}')) {
            cleaned = cleaned.replace(/'/g, '"');
            cleaned = cleaned.replace(/([{,]\s*)([a-zA-Z0-9_$]+)\s*:/g, '$1"$2":');
            cleaned = cleaned.replace(/:\s*([a-zA-Z_$][a-zA-Z0-9_\-$]*)\s*([,}])/g, ':"$1"$2');
            return JSON.parse(cleaned);
        }
    } catch (e) {}

    throw new Error("Could not parse parameters as JSON or Key-Value pairs.");
}

const method = args[0];
let params = {};
if (args[1] && args[1] !== "{}") {
    try {
        if (args[1].startsWith('@')) {
            const filePath = path.resolve(args[1].substring(1));
            if (!fs.existsSync(filePath)) {
                console.error(`Error: Parameter file does not exist: ${filePath}`);
                process.exit(1);
            }
            const fileContent = fs.readFileSync(filePath, 'utf8').trim();
            try {
                params = tryParseRelaxedJson(fileContent);
            } catch (e) {
                // 如果解析失败，且当前是脚本执行方法，则将其包装为 script 参数
                const scriptMethods = ['evaluatescript', 'evaluate_script', 'evaluate', 'eval', 'evaluate_code'];
                if (scriptMethods.includes(method.toLowerCase())) {
                    params = { script: fileContent };
                } else {
                    console.error('Invalid JSON/Key-Value params in file:', e.message);
                    process.exit(1);
                }
            }
        } else {
            params = tryParseRelaxedJson(args[1]);
        }

        // 遍历参数，处理字段值中以 @ 开头的文件路径引用
        if (params && typeof params === 'object') {
            for (const key of Object.keys(params)) {
                if (typeof params[key] === 'string' && params[key].startsWith('@')) {
                    const refPath = path.resolve(params[key].substring(1));
                    if (fs.existsSync(refPath)) {
                        params[key] = fs.readFileSync(refPath, 'utf8');
                    }
                }
            }
        }
    } catch (e) {
        console.error('Invalid JSON/Key-Value params:', e.message);
        process.exit(1);
    }
}

let targetHost = args[2] || '127.0.0.1';

// 支持从 host 参数中解析端口 (例如 127.0.0.1:9444)
if (targetHost.includes(':')) {
    const parts = targetHost.split(':');
    targetHost = parts[0];
    PORT = parseInt(parts[1], 10);
}

// 支持显式传递第 4 个参数作为端口
if (args[3]) {
    PORT = parseInt(args[3], 10);
}

// 显式传递第 5 个参数作为 Token
if (args[4]) {
    SECRET_TOKEN = args[4];
}

const client = new net.Socket();
let authenticated = false;
let responseBuffer = ''; // 用于处理分包数据

client.connect(PORT, targetHost, () => {
    client.write(SECRET_TOKEN);
});

client.on('data', (data) => {
    const raw = data.toString();
    
    if (!authenticated) {
        try {
            const res = JSON.parse(raw);
            if (res.status === 'authenticated') {
                authenticated = true;
                const request = {
                    jsonrpc: "2.0",
                    id: Date.now(),
                    method: method,
                    params: params
                };
                client.write(JSON.stringify(request));
            }
        } catch (e) {
            console.error('Auth response error:', raw);
            client.destroy();
        }
        return;
    }

    // 将收到的数据追加到缓冲区
    responseBuffer += raw;

    // 处理缓冲区中所有完整的 JSON 行
    let boundary;
    while ((boundary = responseBuffer.indexOf('\n')) !== -1) {
        const line = responseBuffer.slice(0, boundary).trim();
        responseBuffer = responseBuffer.slice(boundary + 1);

        if (!line) continue;

        try {
            const res = JSON.parse(line);
            // 只有当收到对应请求 ID 的结果时才关闭
            if (res.id || res.error) {
                console.log(JSON.stringify(res, null, 2));
                // 清除超时定时器，防止 Node.js 事件循环挂起
                clearTimeout(timeoutId);
                // 延迟一小会儿再关闭，给 TCP 缓冲区留出呼吸时间并正常退出进程
                setTimeout(() => {
                    client.destroy();
                    process.exit(0);
                }, 100);
            } else {
                console.log('--- Event ---');
                console.log(JSON.stringify(res, null, 2));
            }
        } catch (e) {
            // 如果解析失败，可能是数据还没接收完（虽然有换行符了），先保留
            console.error('JSON Parse Error on line:', line.substring(0, 100));
        }
    }
});

client.on('error', (err) => {
    // 忽略主动断开导致的重置
    if (err.code !== 'ECONNRESET') {
        console.error('Connection Error:', err.message);
    }
});

// 设置 60 秒超时并保存 ID 供清理
const timeoutId = setTimeout(() => {
    if (!client.destroyed) {
        console.error('Request timed out after 60s');
        client.destroy();
        process.exit(1);
    }
}, 60000);
