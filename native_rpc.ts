import { Agent } from './agent.js';

// JSON-RPC 2.0 基础 Transport 类接口
export interface Transport {
    sendMessage(message: any): void;
    setMessageCallback(callback: (message: any) => void): void;
    addCloseListener?(callback: (error?: any) => void): void;
}

// Chrome Native Messaging Transport 实现
export class NativeTransport implements Transport {
    private application: string;
    private port: any = null;
    private messageCallback: ((msg: any) => void) | null = null;
    private status: { state: string; error?: string; port?: number } = { state: "disconnected" };

    constructor(application: string = "com.bridge.relay.host") {
        this.application = application;
        // 移除构造函数中的自动连接，改为由外部控制或在发送消息时自动连接
    }

    private updateStatus(state: string, error?: string, port?: number) {
        if (port) this.status.port = port;
        this.status.state = state;
        if (error !== undefined) this.status.error = error;

        chrome.runtime.sendMessage({
            type: "NATIVE_RELAY_STATUS_CHANGED",
            status: this.status
        }).catch(() => {});
    }

    sendMessage(message: any) {
        if (!this.port) {
            this.connect();
            if (!this.port) throw new Error("Native transport is disconnected");
        }
        try {
            this.port.postMessage(message);
        } catch (e: any) {
            this.port = null;
            this.updateStatus("disconnected", e.message);
            throw e;
        }
    }

    setMessageCallback(callback: (msg: any) => void) {
        this.messageCallback = callback;
    }

    disconnect() {
        if (this.port) {
            try {
                this.port.disconnect();
            } catch (e) {}
            this.port = null;
            this.updateStatus("disconnected");
        }
    }

    restart() {
        this.disconnect();
        // 延迟一小会儿确保进程已释放端口
        setTimeout(() => this.connect(), 3500);
    }

    connect() {
        if (this.port) return true;
        try {
            this.port = chrome.runtime.connectNative(this.application);
            
            // 只要没报错，先标记为已连接（等待 Host 汇报具体端口）
            this.updateStatus("connected");

            this.port.onMessage.addListener((msg: any) => {
                if (msg && msg.method === 'onNativeHostReady' && msg.params?.port) {
                    this.updateStatus("connected", undefined, msg.params.port);
                    return;
                }
                this.messageCallback?.(msg);
            });

            this.port.onDisconnect.addListener(() => {
                const err = chrome.runtime.lastError;
                this.port = null;
                this.updateStatus("disconnected", err?.message);
                console.warn("Native Messaging Transport disconnected:", err?.message);
                // 自动尝试重连
                setTimeout(() => this.connect(), 5000);
            });
            return true;
        } catch (e: any) {
            this.port = null;
            this.updateStatus("disconnected", e.message);
            return false;
        }
    }

    getStatus() {
        return this.status;
    }
}

// JSON-RPC 2.0 请求和通知路由类
export class JsonRpcRouter {
    private transport: Transport;
    private nextId: number = 1;
    private pendingRequests: Map<number, { resolve: (res: any) => void; reject: (err: any) => void }> = new Map();
    private requestHandlers: Map<string, { handler: (params: any) => Promise<any> | any, meta?: any }> = new Map();
    private eventHandlers: Map<string, ((params: any) => void)[]> = new Map();

    constructor(transport: Transport) {
        this.transport = transport;
        this.transport.setMessageCallback((msg: any) => {
            this.handleIncomingMessage(msg);
        });
        // 增强版 help：返回方法名、说明及参数参考
        this.registerRequestHandler('help', () => {
            const list: any[] = [];
            this.requestHandlers.forEach((val, key) => {
                list.push({
                    method: key,
                    description: val.meta?.description || "",
                    params: val.meta?.params || []
                });
            });
            return list.sort((a, b) => a.method.localeCompare(b.method));
        });
    }

    registerRequestHandler(method: string, handler: (params: any) => Promise<any> | any, meta?: any) {
        this.requestHandlers.set(method, { handler, meta });
    }

    registerRequestHandlerObject(obj: any) {
        if (!obj) return;
        
        // 如果对象自带元数据映射表，则优先使用
        const metadata = (obj as any)._rpcMetadata || {};
        
        // 1. 获取原型链上的方法
        let proto = Object.getPrototypeOf(obj);
        while (proto && proto !== Object.prototype) {
            const methods = Object.getOwnPropertyNames(proto)
                .filter(name => name !== 'constructor' && typeof (obj as any)[name] === 'function');
            for (const m of methods) {
                this.registerRequestHandler(m, (obj as any)[m].bind(obj), metadata[m]);
            }
            proto = Object.getPrototypeOf(proto);
        }

        // 2. 获取实例自身的属性方法
        const instanceMethods = Object.getOwnPropertyNames(obj)
            .filter(name => typeof (obj as any)[name] === 'function' && !name.startsWith('_'));
        for (const m of instanceMethods) {
            this.registerRequestHandler(m, (obj as any)[m].bind(obj), metadata[m]);
        }
    }

    addEventListener(event: string, callback: (params: any) => void) {
        const handlers = this.eventHandlers.get(event) || [];
        handlers.push(callback);
        this.eventHandlers.set(event, handlers);
    }

    sendNotification(method: string, params: any) {
        this.transport.sendMessage({
            jsonrpc: "2.0",
            method,
            params
        });
    }

    sendRequest(method: string, params: any): Promise<any> {
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            this.pendingRequests.set(id, { resolve, reject });
            try {
                this.transport.sendMessage({
                    jsonrpc: "2.0",
                    method,
                    params,
                    id
                });
            } catch (e) {
                this.pendingRequests.delete(id);
                reject(e);
            }
        });
    }

    private async handleIncomingMessage(msg: any) {
        if (!msg || typeof msg !== 'object') return;

        // 如果是一个单向通知或调用
        if ("method" in msg) {
            const { method, params, id } = msg;
            if (id === undefined) {
                // 通知
                const listeners = this.eventHandlers.get(method) || [];
                for (const cb of listeners) cb(params);
            } else {
                // 请求调用，执行本地 handler 并回复
                const entry = this.requestHandlers.get(method);
                if (!entry) {
                    this.transport.sendMessage({
                        jsonrpc: "2.0",
                        error: { code: -32601, message: `Method not found: ${method}` },
                        id
                    });
                    return;
                }
                try {
                    const result = await entry.handler(params);
                    this.transport.sendMessage({
                        jsonrpc: "2.0",
                        result,
                        id
                    });
                } catch (e: any) {
                    this.transport.sendMessage({
                        jsonrpc: "2.0",
                        error: { code: -32603, message: e.message || "Internal error" },
                        id
                    });
                }
            }
            return;
        }

        // 如果是一个响应结果
        if (msg.id !== undefined) {
            const pending = this.pendingRequests.get(msg.id);
            if (pending) {
                this.pendingRequests.delete(msg.id);
                if ("error" in msg) {
                    pending.reject(msg.error?.message || "Unknown RPC error");
                } else {
                    pending.resolve(msg.result);
                }
            }
        }
    }
}

// 具体的 Native Relay 功能 Handler 实现
export class NativeRelayHandler {
    private extensionInstanceId: string = "";
    private router: JsonRpcRouter | null = null;

    // 定义 RPC 方法的文档元数据
    public readonly _rpcMetadata: Record<string, { description: string, params?: string[] }> = {
        ping: { description: "测试连接，返回 'pong'" },
        getInfo: { description: "获取浏览器扩展程序的详细信息" },
        getTabs: { description: "获取当前所有打开的标签页列表" },
        getUserTabs: { description: "获取用户标签页列表（与 getTabs 相同）" },
        createTab: { 
            description: "创建一个新的浏览器标签页", 
            params: ["url: string (可选，默认 google.com)"] 
        },
        click: { 
            description: "根据 UID 点击页面元素（推荐使用，比坐标点击更精准）", 
            params: ["tabId: number", "uid: string", "dblClick: boolean (可选)"] 
        },
        fillForm: {
            description: "一次性填充多个表单元素（输入框、下拉框等）。比多次调用 click/type 快得多。",
            params: ["tabId: number", "elements: {uid: string, value: string}[]"]
        },
        emulateDevice: {
            description: "模拟特定设备环境，检查响应式布局或 Googlebot 渲染。",
            params: ["tabId: number", "profile: 'iphone'|'android'|'googlebot'|'desktop'"]
        },
        resizePage: {
            description: "精确调整页面的窗口视口尺寸（宽x高）。",
            params: ["tabId: number", "width: number", "height: number"]
        },
        listNetworkRequests: {
            description: "获取当前页面加载的所有网络资源列表，用于分析加载性能和 404 错误。",
            params: ["tabId: number"]
        },
        getCookies: {
            description: "获取当前页面的 Cookies 信息。",
            params: ["tabId: number"]
        },
        takeFullPageScreenshot: {
            description: "截取整个页面的长图（包括滚动条下方的隐藏内容）。",
            params: ["tabId: number", "format: 'png'|'jpeg'", "quality: number"]
        },
        pressKey: {
            description: "模拟物理按键或组合键。例如 'Enter', 'Tab', 'Control+A'。",
            params: ["tabId: number", "key: string"]
        },
        navigatePage: {
            description: "页面导航控制：前进、后退或刷新。",
            params: ["tabId: number", "type: 'back'|'forward'|'reload'"]
        },
        hover: {
            description: "悬停在指定 UID 的元素上，触发悬浮菜单或提示。",
            params: ["tabId: number", "uid: string"]
        },
        listConsoleMessages: {
            description: "获取页面的最近 100 条控制台日志和 JS 错误。",
            params: ["tabId: number"]
        },
        evaluateScript: {
            description: "在页面中执行自定义 JavaScript 代码并返回结果。",
            params: ["tabId: number", "script: string"]
        },
        drag: {
            description: "将一个元素拖拽到另一个元素位置。",
            params: ["tabId: number", "fromUid: string", "toUid: string"]
        },
        uploadFile: {
            description: "为指定的文件输入元素上传文件。",
            params: ["tabId: number", "uid: string", "filePath: string"]
        },
        clickAt: {
            description: "点击屏幕上的精确坐标位置。",
            params: ["tabId: number", "x: number", "y: number"]
        },
        selectPage: {
            description: "激活并置顶显示指定的标签页。",
            params: ["tabId: number"]
        },
        closePage: {
            description: "关闭指定的标签页。",
            params: ["tabId: number"]
        },
        typeText: {
            description: "模拟真实人类打字速度输入文本。用于绕过简单的机器人检测。",
            params: ["tabId: number", "text: string"]
        },
        handleDialog: {
            description: "手动处理页面弹出的对话框（alert, confirm, prompt）。",
            params: ["tabId: number", "action: 'accept'|'dismiss'", "promptText: string (可选)"]
        },
        getNetworkResponseBody: {
            description: "获取指定网络请求的响应正文内容。",
            params: ["tabId: number", "requestId: string"]
        },
        takeHeapSnapshot: {
            description: "抓取当前页面的堆内存快照并保存到本地文件。用于分析内存泄漏。",
            params: ["tabId: number", "filePath: string"]
        },
        getHeapSnapshotSummary: {
            description: "获取已保存堆快照文件的摘要分析（需提供文件路径）。",
            params: ["filePath: string"]
        },
        getHeapSnapshotClassNodes: {
            description: "加载堆快照并返回特定类的所有实例 ID。",
            params: ["filePath: string", "id: number (类的 ID)", "pageIdx: number", "pageSize: number"]
        },
        getHeapSnapshotDetails: {
            description: "获取堆快照的详细统计信息，包括聚合节点信息。",
            params: ["filePath: string", "pageIdx: number", "pageSize: number"]
        },
        getHeapSnapshotRetainers: {
            description: "获取特定节点的保留路径（Retainers），分析对象为何未被释放。",
            params: ["filePath: string", "nodeId: number", "pageIdx: number", "pageSize: number"]
        },
        waitFor: {
            description: "等待页面出现特定文字或 UID 元素。用于处理异步加载。",
            params: ["tabId: number", "text: string[] (可选，匹配任意一个即可)", "uid: string (可选)", "timeout: number (可选，默认 30000ms)"]
        },
        attach: { 
            description: "为指定标签页附加调试器（CDP）", 
            params: ["tabId: number"] 
        },
        detach: { 
            description: "断开指定标签页的调试器连接", 
            params: ["tabId: number"] 
        },
        executeCdp: { 
            description: "在指定标签页上直接执行 CDP 指令", 
            params: ["tabId: number", "method: string", "params: object"] 
        },
        takeScreenshot: { 
            description: "对指定标签页进行截图（基于 CDP）", 
            params: ["tabId: number", "format: 'png'|'jpeg' (默认 png)", "quality: number (0-100)"] 
        },
        moveMouse: { 
            description: "控制鼠标在页面上的移动", 
            params: ["tabId: number", "x: number", "y: number", "waitForArrival: boolean (可选)"] 
        },
        getUserHistory: { 
            description: "搜索用户的浏览器历史记录", 
            params: ["text: string (搜索关键词)", "maxResults: number (默认 100)"] 
        },
        claimUserTab: { 
            description: "接管现有用户标签页并自动 attach", 
            params: ["tabId: number"] 
        },
        finalizeTabs: { 
            description: "关闭除了指定 ID 以外的所有标签页", 
            params: ["keep: number[] (需要保留的 ID 数组)"] 
        },
        nameSession: {
            description: "为当前自动化会话命名",
            params: ["name: string"]
        },
        turnEnded: {
            description: "通知系统当前操作轮次已结束",
            params: ["any (可选数据)"]
        },
        restartRelay: { description: "重启 Native 桥接服务的连接" }
    };

    constructor() {
        chrome.storage.local.get("extensionInstanceId").then(data => {
            this.extensionInstanceId = data.extensionInstanceId || "";
            if (!this.extensionInstanceId) {
                this.extensionInstanceId = crypto.randomUUID();
                chrome.storage.local.set({ extensionInstanceId: this.extensionInstanceId });
            }
        });
    }

    public setRouter(router: JsonRpcRouter) {
        this.router = router;
    }

    ping() {
        return "pong";
    }

    async getInfo() {
        return {
            name: "Chrome",
            version: chrome.runtime.getManifest().version,
            type: "extension",
            metadata: {
                extensionId: chrome.runtime.id,
                extensionInstanceId: this.extensionInstanceId
            }
        };
    }

    async attach(params: { tabId: number }) {
        if (!params.tabId) throw new Error("Missing tabId");
        await Agent.ensureDebuggerAttached(params.tabId);
        return { attached: true };
    }

    async detach(params: { tabId: number }) {
        if (!params.tabId) throw new Error("Missing tabId");
        return new Promise((resolve, reject) => {
            chrome.debugger.detach({ tabId: params.tabId }, () => {
                const err = chrome.runtime.lastError;
                if (err && !err.message?.includes("not attached")) reject(err);
                else resolve({ detached: true });
            });
        });
    }

    async click(params: { tabId: number; uid: string; dblClick?: boolean }) {
        if (!params.tabId || !params.uid) throw new Error("Missing tabId or uid");
        return await Agent.click(params.tabId, params.uid, { dblClick: params.dblClick });
    }

    async fillForm(params: { tabId: number; elements: { uid: string; value: string }[] }) {
        if (!params.tabId || !params.elements) throw new Error("Missing tabId or elements");
        return await Agent.fillForm(params.tabId, params.elements);
    }

    async emulateDevice(params: { tabId: number; profile: 'iphone' | 'android' | 'googlebot' | 'desktop' }) {
        if (!params.tabId || !params.profile) throw new Error("Missing tabId or profile");
        return await Agent.emulateDevice(params.tabId, params.profile);
    }

    async resizePage(params: { tabId: number; width: number; height: number }) {
        if (!params.tabId || !params.width || !params.height) throw new Error("Missing params");
        return await Agent.resizePage(params.tabId, params.width, params.height);
    }

    async listNetworkRequests(params: { tabId: number }) {
        if (!params.tabId) throw new Error("Missing tabId");
        return await Agent.listNetworkRequests(params.tabId);
    }

    async getCookies(params: { tabId: number }) {
        if (!params.tabId) throw new Error("Missing tabId");
        return await Agent.getCookies(params.tabId);
    }

    async takeFullPageScreenshot(params: { tabId: number; format?: string; quality?: number }) {
        if (!params.tabId) throw new Error("Missing tabId");
        return await Agent.takeFullPageScreenshot(params.tabId, params);
    }

    async pressKey(params: { tabId: number; key: string }) {
        if (!params.tabId || !params.key) throw new Error("Missing tabId or key");
        return await Agent.pressKey(params.tabId, params.key);
    }

    async navigatePage(params: { tabId: number; type: 'back' | 'forward' | 'reload' }) {
        if (!params.tabId || !params.type) throw new Error("Missing tabId or type");
        return await Agent.navigatePage(params.tabId, params.type);
    }

    async hover(params: { tabId: number; uid: string }) {
        if (!params.tabId || !params.uid) throw new Error("Missing tabId or uid");
        return await Agent.hover(params.tabId, params.uid);
    }

    async listConsoleMessages(params: { tabId: number }) {
        if (!params.tabId) throw new Error("Missing tabId");
        return await Agent.listConsoleMessages(params.tabId);
    }

    async evaluateScript(params: { tabId: number; script: string }) {
        if (!params.tabId || !params.script) throw new Error("Missing tabId or script");
        return await Agent.evaluateScript(params.tabId, params.script);
    }

    async drag(params: { tabId: number; fromUid: string; toUid: string }) {
        if (!params.tabId || !params.fromUid || !params.toUid) throw new Error("Missing params");
        return await Agent.drag(params.tabId, params.fromUid, params.toUid);
    }

    async uploadFile(params: { tabId: number; uid: string; filePath: string }) {
        if (!params.tabId || !params.uid || !params.filePath) throw new Error("Missing params");
        return await Agent.uploadFile(params.tabId, params.uid, params.filePath);
    }

    async clickAt(params: { tabId: number; x: number; y: number }) {
        if (!params.tabId) throw new Error("Missing tabId");
        return await Agent.clickAt(params.tabId, params.x, params.y);
    }

    async selectPage(params: { tabId: number }) {
        if (!params.tabId) throw new Error("Missing tabId");
        return await Agent.selectPage(params.tabId);
    }

    async closePage(params: { tabId: number }) {
        if (!params.tabId) throw new Error("Missing tabId");
        return await Agent.closePage(params.tabId);
    }

    async typeText(params: { tabId: number; text: string }) {
        if (!params.tabId || !params.text) throw new Error("Missing params");
        return await Agent.typeText(params.tabId, params.text);
    }

    async handleDialog(params: { tabId: number; action: 'accept' | 'dismiss'; promptText?: string }) {
        if (!params.tabId || !params.action) throw new Error("Missing params");
        return await Agent.handleDialog(params.tabId, params.action, params.promptText);
    }

    async getNetworkResponseBody(params: { tabId: number; requestId: string }) {
        if (!params.tabId || !params.requestId) throw new Error("Missing params");
        return await Agent.getNetworkResponseBody(params.tabId, params.requestId);
    }

    async takeHeapSnapshot(params: { tabId: number; filePath: string }) {
        if (!params.tabId || !params.filePath) throw new Error("Missing params");
        
        // 这是一个流式操作。我们需要通过 Notification 通知 Host 开启文件写入
        this.router?.sendNotification("onStartHeapSnapshot", { filePath: params.filePath });
        
        const result = await Agent.takeHeapSnapshot(params.tabId, (chunk: string) => {
            this.router?.sendNotification("onHeapSnapshotChunk", { chunk });
        });

        this.router?.sendNotification("onEndHeapSnapshot", { filePath: params.filePath });
        return result;
    }

    async getHeapSnapshotSummary(params: { filePath: string }) {
        // 这个操作由 Native Host 端实现更合适，因为需要解析大 JSON
        if (!this.router) throw new Error("Router not initialized");
        return await this.router.sendRequest("host.getHeapSnapshotSummary", params);
    }

    async getHeapSnapshotClassNodes(params: { filePath: string; id: number; pageIdx?: number; pageSize?: number }) {
        if (!this.router) throw new Error("Router not initialized");
        return await this.router.sendRequest("host.getHeapSnapshotClassNodes", params);
    }

    async getHeapSnapshotDetails(params: { filePath: string; pageIdx?: number; pageSize?: number }) {
        if (!this.router) throw new Error("Router not initialized");
        return await this.router.sendRequest("host.getHeapSnapshotDetails", params);
    }

    async getHeapSnapshotRetainers(params: { filePath: string; nodeId: number; pageIdx?: number; pageSize?: number }) {
        if (!this.router) throw new Error("Router not initialized");
        return await this.router.sendRequest("host.getHeapSnapshotRetainers", params);
    }

    async waitFor(params: { tabId: number; text?: string[]; uid?: string; timeout?: number }) {
        if (!params.tabId) throw new Error("Missing tabId");
        return await Agent.waitFor(params.tabId, { text: params.text, uid: params.uid, timeout: params.timeout });
    }

    async executeCdp(params: { tabId: number; method: string; params: any }) {
        if (!params.tabId || !params.method) throw new Error("Missing tabId or method");
        return await Agent.sendCDP(params.tabId, params.method, params.params || {});
    }

    async getTabs() {
        const tabs = await chrome.tabs.query({});
        return tabs.map(t => ({
            id: t.id,
            windowId: t.windowId,
            url: t.url,
            title: t.title,
            active: t.active
        }));
    }

    async getUserTabs() {
        return await this.getTabs();
    }

    async getUserHistory(params: { text?: string; maxResults?: number }) {
        return new Promise((resolve) => {
            chrome.history.search({
                text: params.text || "",
                maxResults: params.maxResults || 100
            }, (results) => {
                resolve(results);
            });
        });
    }

    async claimUserTab(params: { tabId: number }) {
        if (!params.tabId) throw new Error("Missing tabId");
        await Agent.ensureDebuggerAttached(params.tabId);
        return { claimed: true, tabId: params.tabId };
    }

    async createTab(params?: { url?: string }) {
        const url = params?.url || "https://www.google.com";
        const tab = await chrome.tabs.create({ url });
        return { id: tab.id, url: tab.url };
    }

    async finalizeTabs(params: { keep: number[] }) {
        if (!params || !Array.isArray(params.keep)) throw new Error("finalizeTabs requires a keep array");
        const tabs = await chrome.tabs.query({});
        const closeTabs = tabs.filter(t => t.id && !params.keep.includes(t.id));
        for (const t of closeTabs) {
            if (t.id) await chrome.tabs.remove(t.id);
        }
        return { success: true };
    }

    async takeScreenshot(params: { tabId: number; format?: string; quality?: number }) {
        if (!params.tabId) throw new Error("Missing tabId");
        // CDP screenshot is more powerful
        const result = await Agent.sendCDP(params.tabId, "Page.captureScreenshot", {
            format: params.format || "png",
            quality: params.quality || 80,
            fromSurface: true
        });
        return result;
    }

    async nameSession(params: { name: string }) {
        return { success: true, name: params.name };
    }

    async turnEnded(params: any) {
        return { success: true };
    }

    async restartRelay() {
        // 这个方法将由 NativeRelayExtension 实例调用其 transport 的 restart
        // 我们在 NativeRelayExtension 中会进行特殊的绑定或者在此处抛出一个事件
        // 但最简单的是在 NativeRelayExtension constructor 中注入重启函数
        return { success: true, message: "Relay restart initiated" };
    }

    async moveMouse(params: { tabId: number; x: number; y: number; waitForArrival?: boolean; session_id?: string; turn_id?: string }) {
        if (!params.tabId) throw new Error("Missing tabId");
        
        try {
            await chrome.tabs.sendMessage(params.tabId, {
                type: "MOVE_MOUSE",
                x: params.x,
                y: params.y,
                waitForArrival: params.waitForArrival !== false
            });
        } catch (e) {
            // 退化到直接使用 CDP 事件注入
            await Agent.sendCDP(params.tabId, "Input.dispatchMouseEvent", {
                type: "mouseMoved",
                x: params.x,
                y: params.y
            });
        }
        return { success: true };
    }
}

// 统一的 Native Relay Integration 管理类
export class NativeRelayExtension extends JsonRpcRouter {
    private transportInstance: NativeTransport;

    constructor(application: string = "com.bridge.relay.host") {
        const transport = new NativeTransport(application);
        super(transport);
        this.transportInstance = transport;
        const handler = new NativeRelayHandler();
        handler.setRouter(this);
        
        // 覆盖默认的 restartRelay 以执行实际的重启
        const originalRestart = handler.restartRelay.bind(handler);
        handler.restartRelay = async () => {
            const res = await originalRestart();
            // 先返回响应再重启，否则连接断了响应发不出去
            setTimeout(() => this.transportInstance.restart(), 100);
            return res;
        };

        this.registerRequestHandlerObject(handler);

        // 监听下载事件并推送
        chrome.downloads.onCreated.addListener((downloadItem) => {
            this.sendNotification("onDownloadChange", {
                id: String(downloadItem.id),
                filename: downloadItem.filename,
                url: downloadItem.finalUrl || downloadItem.url,
                status: "started"
            });
        });

        chrome.downloads.onChanged.addListener((delta) => {
            let status = "updated";
            if (delta.state?.current === "complete") status = "complete";
            else if (delta.state?.current === "interrupted") status = "failed";

            this.sendNotification("onDownloadChange", {
                id: String(delta.id),
                status
            });
        });
    }

    getStatus() {
        return this.transportInstance.getStatus();
    }

    async restartRelay() {
        this.transportInstance.restart();
        return { success: true, message: "Relay restart initiated" };
    }

    sendCdpEvent(event: { source: { tabId: number }; method: string; params: any }) {
        this.sendNotification("onCDPEvent", event);
    }
}
