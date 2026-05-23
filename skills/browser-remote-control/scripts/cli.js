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

const method = args[0];
let params = {};
if (args[1] && args[1] !== "{}") {
    try {
        params = JSON.parse(args[1]);
    } catch (e) {
        console.error('Invalid JSON params:', e.message);
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
                // 延迟一小会儿再关闭，给 TCP 缓冲区留出呼吸时间
                setTimeout(() => client.destroy(), 100);
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

// 设置 60 秒超时
setTimeout(() => {
    if (!client.destroyed) {
        console.error('Request timed out after 60s');
        client.destroy();
    }
}, 60000);
