const fs = require('fs');
const path = require('path');
const net = require('net');

const LOG_FILE = path.join(__dirname, 'host.log');
const CONFIG_FILE = path.join(__dirname, 'config.json');
const START_PORT = 9333;

let SECRET_TOKEN = 'bridge-relay-secure-token-2026';

// 尝试从配置文件加载 Token
try {
    if (fs.existsSync(CONFIG_FILE)) {
        const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        if (config.token) {
            SECRET_TOKEN = config.token;
        }
    }
} catch (e) {
    // 加载失败则保持默认
}

let externalSocket = null;
let stdinBuffer = Buffer.alloc(0);
let chromeConnected = true;

function log(msg) {
    try {
        fs.appendFileSync(LOG_FILE, `[${new Date().toLocaleString()}] ${msg}\n`);
    } catch (e) {}
}

function checkExitConditions() {
    // 如果 Chrome 已断开，且没有外部 CLI 连接，则退出
    if (!chromeConnected && !externalSocket) {
        log('No Chrome and no active CLI, exiting...');
        // 给日志留一点写入时间
        setTimeout(() => process.exit(0), 100);
    }
}

const server = net.createServer((socket) => {
    log(`Incoming TCP connection from ${socket.remoteAddress}`);
    socket.isAuthenticated = false;

    socket.on('data', (data) => {
        try {
            const raw = data.toString().trim();
            if (!socket.isAuthenticated) {
                if (raw === SECRET_TOKEN) {
                    socket.isAuthenticated = true;
                    externalSocket = socket;
                    socket.write(JSON.stringify({ status: 'authenticated' }) + '\n');
                    log(`Auth Success: ${socket.remoteAddress}`);
                } else {
                    log(`Auth Failed: ${socket.remoteAddress}`);
                    socket.write(JSON.stringify({ error: 'Unauthorized' }) + '\n');
                    socket.destroy();
                }
                return;
            }

            const req = JSON.parse(raw);
            log(`From Remote CLI (${socket.remoteAddress}): ${raw}`);
            
            // 处理特殊管理指令
            if (req.method === 'ping') {
                socket.write(JSON.stringify({ jsonrpc: "2.0", id: req.id, result: "pong" }) + '\n');
            } else if (req.method === 'getHostStatus') {
                socket.write(JSON.stringify({ 
                    jsonrpc: "2.0", 
                    id: req.id, 
                    result: { chromeConnected, pid: process.pid } 
                }) + '\n');
            } else if (req.method === 'shutdown') {
                log('Shutdown requested via TCP');
                socket.write(JSON.stringify({ jsonrpc: "2.0", id: req.id, result: "ok" }) + '\n');
                setTimeout(() => process.exit(0), 100);
            } else {
                sendToChrome(req);
            }
        } catch (e) {
            log(`TCP Logic Error: ${e.message}`);
        }
    });

    socket.on('error', (err) => log(`Socket Error: ${err.message}`));
    socket.on('end', () => {
        log('CLI disconnected');
        if (externalSocket === socket) {
            externalSocket = null;
            checkExitConditions(); // CLI 断开时检查是否需要退出
        }
    });
});

process.stdin.on('end', () => {
    chromeConnected = false;
    log('Chrome disconnected (stdin end)');
    // 延迟检查，给可能的重连或后续指令留一点缓冲
    setTimeout(checkExitConditions, 3000);
});

process.stdin.on('error', (err) => {
    log(`Stdin Error: ${err.message}`);
    chromeConnected = false;
    checkExitConditions();
});

function startServer(port) {
    const checkClient = new net.Socket();
    let isHandled = false;

    checkClient.setTimeout(800);
    checkClient.on('connect', () => {
        checkClient.write(SECRET_TOKEN);
    });

    checkClient.on('data', (data) => {
        if (isHandled) return;
        const raw = data.toString();
        
        if (raw.includes('authenticated')) {
            // 发送状态查询
            checkClient.write(JSON.stringify({ jsonrpc: "2.0", id: "check", method: 'getHostStatus' }) + '\n');
        } else if (raw.includes('getHostStatus')) {
            isHandled = true;
            try {
                const status = JSON.parse(raw).result;
                if (status.chromeConnected === false) {
                    log(`Port ${port} is a zombie (orphaned). Sending shutdown...`);
                    checkClient.write(JSON.stringify({ jsonrpc: "2.0", id: "die", method: 'shutdown' }) + '\n');
                    // 等待一会儿后重试该端口
                    setTimeout(() => {
                        checkClient.destroy();
                        startServer(port);
                    }, 500);
                } else {
                    log(`Port ${port} is an active session (PID: ${status.pid}). Skipping...`);
                    checkClient.destroy();
                    startServer(port + 1);
                }
            } catch (e) {
                checkClient.destroy();
                startServer(port + 1);
            }
        }
    });

    checkClient.on('error', () => {
        if (isHandled) return;
        isHandled = true;
        checkClient.destroy();
        // 端口真正空闲，启动服务
        server.listen(port, '0.0.0.0', () => {
            log(`Success: Listening on 0.0.0.0:${server.address().port}`);
            sendToChrome({ method: "onNativeHostReady", params: { port: server.address().port } });
        });
    });

    checkClient.on('timeout', () => {
        if (isHandled) return;
        isHandled = true;
        checkClient.destroy();
        log(`Port ${port} occupancy check timeout, assuming busy by others.`);
        startServer(port + 1);
    });

    checkClient.connect(port, '127.0.0.1');
}

server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
        // 这个逻辑现在被上面的 pre-check 覆盖了，但保留作为兜底
        log(`Unexpected EADDRINUSE on ${e.port}`);
    } else {
        log(`Server Fatal Error: ${e.message}`);
    }
});

function sendToChrome(msg) {
    try {
        const buffer = Buffer.from(JSON.stringify(msg));
        const lenBuffer = Buffer.alloc(4);
        lenBuffer.writeUInt32LE(buffer.length, 0);
        process.stdout.write(lenBuffer);
        process.stdout.write(buffer);
    } catch (e) {
        log(`Stdio Write Error: ${e.message}`);
    }
}

async function handleChromeRequest(req) {
    const { method, params, id } = req;

    // 只要没有 method 且有 id，或者明确包含 result/error，就视为响应
    const isResponse = !method && (id !== undefined || req.result !== undefined || req.error !== undefined);

    if (isResponse) {
        log(`Response from Chrome for ID: ${id}`);
        if (externalSocket && externalSocket.writable) {
            externalSocket.write(JSON.stringify(req) + '\n');
        }
        return;
    }

    // 如果还是没有 method，说明这是一个异常消息或不规范的通知
    if (!method) {
        log(`DEBUG - Received malformed message from Chrome: ${JSON.stringify(req)}`);
        return;
    }

    log(`Request from Chrome: ${method} (ID: ${id})`);

    try {
        let result;
        switch (method) {
            case 'ping':
                result = 'pong';
                break;
            case 'runCommand':
                const { exec } = require('child_process');
                return new Promise((resolve) => {
                    exec(params.command, (error, stdout, stderr) => {
                        resolve(sendToChrome({
                            jsonrpc: "2.0",
                            id,
                            result: { stdout, stderr, code: error ? error.code : 0 }
                        }));
                    });
                });
            default:
                // 如果不是本地处理的方法，则尝试转发给外部 CLI (如果有的话)
                if (externalSocket && externalSocket.writable) {
                    externalSocket.write(JSON.stringify(req) + '\n');
                    return; // 异步处理由 externalSocket 回复
                }
                if (id !== undefined) {
                    throw new Error(`Method ${method} not supported by Host`);
                }
        }

        if (id !== undefined) {
            sendToChrome({ jsonrpc: "2.0", id, result });
        }
    } catch (e) {
        if (id !== undefined) {
            sendToChrome({ jsonrpc: "2.0", id, error: { code: -32603, message: e.message } });
        }
    }
}

process.stdin.on('readable', () => {
    let chunk;
    while ((chunk = process.stdin.read()) !== null) {
        stdinBuffer = Buffer.concat([stdinBuffer, chunk]);
        while (stdinBuffer.length >= 4) {
            const msgLen = stdinBuffer.readUInt32LE(0);
            if (stdinBuffer.length >= 4 + msgLen) {
                const messageData = stdinBuffer.slice(4, 4 + msgLen);
                stdinBuffer = stdinBuffer.slice(4 + msgLen);
                const msgStr = messageData.toString();
                try {
                    const msg = JSON.parse(msgStr);
                    // 判断是发给 Host 的请求还是转发给外部的
                    handleChromeRequest(msg);
                } catch (e) {
                    log(`Chrome Msg Parse Error: ${e.message}`);
                }
            } else break;
        }
    }
});

process.on('uncaughtException', (err) => log(`FATAL: ${err.stack}`));
startServer(START_PORT);
