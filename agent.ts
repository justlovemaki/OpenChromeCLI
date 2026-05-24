// @ts-nocheck
/**
 * AI Agent for reading and operating the webpage
 */
export const Agent: any = {

    refMetaCache: {} as any,
    debuggerSessions: {} as any,
    config: {
        primaryColor: '16,185,129',
        primaryColorHex: '#10B981'
    },

    setConfig(config) {
        if (!config) return;
        this.config = { ...this.config, ...config };
    },

    async getTabState(tabId: number) {
        try {
            return await chrome.tabs.get(tabId);
        } catch (e) {
            return null;
        }
    },

    isRestrictedUrl(url: string) {
        const value = String(url || "").toLowerCase();
        if (!value) return true;
        if (value.startsWith("http://") || value.startsWith("https://") || value.startsWith("file://")) {
            return value.includes("chrome.google.com/webstore") || value.includes("chromewebstore.google.com");
        }
        return true;
    },

    async normalizeTabOperationError(tabId: number, error: any) {
        const message = String(error?.message || error || "");
        const tab = await this.getTabState(tabId);
        const currentUrl = tab?.pendingUrl || tab?.url || "";

        if ((this as any).isRestrictedScriptingError(error) || (currentUrl && this.isRestrictedUrl(currentUrl))) {
            const suffix = currentUrl ? ` Current tab URL: ${currentUrl}` : "";
            return new Error((this as any).getRestrictedUrlErrorMessage(error) + suffix);
        }

        if (error instanceof Error) return error;
        return new Error(message || "Unknown browser operation error");
    },

    cacheRefMeta(tabId, pageUrl, refMeta) {
        if (!tabId || !refMeta || typeof refMeta !== "object") return;
        const existing = this.refMetaCache[tabId];
        const samePage = existing && existing.pageUrl === pageUrl;
        this.refMetaCache[tabId] = {
            pageUrl: pageUrl || existing?.pageUrl || "",
            refMeta: samePage ? { ...existing.refMeta, ...refMeta } : { ...refMeta }
        };
    },



    async ensureDebuggerAttached(tabId) {
        if (!tabId) throw new Error("tabId is required for debugger attach");

        const existing = this.debuggerSessions[tabId];
        if (existing?.attached) return;
        if (existing?.attaching) return await existing.attaching;

        const attaching = new Promise((resolve, reject) => {
            chrome.debugger.attach({ tabId: tabId }, "1.3", () => {
                const err = chrome.runtime.lastError;
                if (err && !err.message.includes("already attached")) {
                    delete this.debuggerSessions[tabId];
                    reject(err);
                    return;
                }

                this.debuggerSessions[tabId] = { attached: true, attaching: null, lastUsed: Date.now() };
                
                // Enable Page domain to receive dialog events
                chrome.debugger.sendCommand({ tabId: tabId }, "Page.enable", {}, () => {});
                // 开启日志和运行时域
                chrome.debugger.sendCommand({ tabId: tabId }, "Log.enable", {}, () => {});
                chrome.debugger.sendCommand({ tabId: tabId }, "Runtime.enable", {}, () => {});
                chrome.debugger.sendCommand({ tabId: tabId }, "HeapProfiler.enable", {}, () => {});

                if (!this._debuggerListenerAdded) {
                    chrome.debugger.onDetach.addListener((source, reason) => {
                        if (source.tabId) {
                            delete this.debuggerSessions[source.tabId];
                            console.log(`Debugger detached from tab ${source.tabId} due to: ${reason}`);
                        }
                    });
                    
                    // 监听日志消息
                    chrome.debugger.onEvent.addListener((source, method, params) => {
                        const sess = this.debuggerSessions[source.tabId];
                        if (!sess) return;
                        if (!sess.consoleMessages) sess.consoleMessages = [];

                        if (method === "Log.entryAdded") {
                            sess.consoleMessages.push({
                                source: "log",
                                level: params.entry.level,
                                text: params.entry.text,
                                timestamp: params.entry.timestamp
                            });
                        } else if (method === "Runtime.consoleAPICalled") {
                            const text = params.args?.map(a => a.value || a.description).join(' ');
                            sess.consoleMessages.push({
                                source: "console",
                                level: params.type,
                                text: text,
                                timestamp: Date.now()
                            });
                        } else if (method === "HeapProfiler.addHeapSnapshotChunk") {
                            // 将内存快照碎片转发给 Native Host 处理
                            if (this.onHeapSnapshotChunk) {
                                this.onHeapSnapshotChunk(params.chunk);
                            }
                        }

                        // 保持缓存不爆炸，只留最近 100 条
                        if (sess.consoleMessages.length > 100) sess.consoleMessages.shift();

                        if (method === "Page.javascriptDialogOpening") {
                            // 记录弹窗状态
                            sess.pendingDialog = {
                                type: params.type,
                                message: params.message,
                                defaultPrompt: params.defaultPrompt
                            };
                            
                            // 默认自动接受，除非开启了手动模式
                            if (!sess.manualDialogHandling) {
                                chrome.debugger.sendCommand(source, "Page.handleJavaScriptDialog", {
                                    accept: true
                                }, () => {});
                            }
                        }
                    });
                    
                    this._debuggerListenerAdded = true;
                }
                
                resolve();
            });
        });

        this.debuggerSessions[tabId] = { attached: false, attaching, consoleMessages: [] };
        return await attaching;
    },

    /**
     * Helper to send CDP (Chrome Devtools Protocol) events
     */
    async sendCDP(tabId, method, params) {
        const sendOnce = () => new Promise((resolve, reject) => {
            if (this.debuggerSessions[tabId]) {
                this.debuggerSessions[tabId].lastUsed = Date.now();
            }
            chrome.debugger.sendCommand({ tabId: tabId }, method, params, (result) => {
                const err = chrome.runtime.lastError;
                if (err) reject(err);
                else resolve(result);
            });
        });

        try {
            await this.ensureDebuggerAttached(tabId);
            return await sendOnce();
        } catch (error) {
            const message = String(error?.message || error || "");
            if (message.includes("not attached") || message.includes("Detached") || message.includes("already attached")) {
                delete this.debuggerSessions[tabId];
                try {
                    await this.ensureDebuggerAttached(tabId);
                    return await sendOnce();
                } catch (retryError) {
                    throw await this.normalizeTabOperationError(tabId, retryError);
                }
            }
            throw await this.normalizeTabOperationError(tabId, error);
        }
    },

    /**
     * Check if a tab is scriptable
     */
    async isTabScriptable(tabId) {
        if (!tabId) return false;
        try {
            const tab = await chrome.tabs.get(tabId);
            if (!tab) return false;
            const url = (tab.url || "").toLowerCase();
            const pendingUrl = (tab.pendingUrl || "").toLowerCase();
            const checkUrl = (u) => {
                if (!u) return false;
                if (u.startsWith('http://') || u.startsWith('https://') || u.startsWith('file://')) {
                    if (u.includes('chrome.google.com/webstore') || u.includes('chromewebstore.google.com')) return false;
                    return true;
                }
                return false;
            };
            if (url && !checkUrl(url)) return false;
            if (pendingUrl && !checkUrl(pendingUrl)) return false;
            return !!(url || pendingUrl);
        } catch (e) {
            return false;
        }
    },

    isRestrictedScriptingError(error) {
        const message = String(error?.message || error || "");
        return message.includes("Cannot access a chrome-extension:// URL") ||
            message.includes("Cannot access contents of url") ||
            message.includes("The extensions gallery cannot be scripted") ||
            message.includes("Missing host permission");
    },

    getRestrictedUrlErrorMessage(error) {
        const message = String(error?.message || error || "");
        if (message.includes("chrome-extension://")) return "Cannot operate on restricted URL (extension page).";
        if (message.includes("extensions gallery")) return "Cannot operate on restricted URL (Chrome Web Store).";
        return "Cannot operate on restricted browser-protected page.";
    },

    async executeScript(tabId, options) {
        try {
            return await chrome.scripting.executeScript({
                target: { tabId: tabId },
                ...options
            });
        } catch (error) {
            if (this.isRestrictedScriptingError(error)) throw await this.normalizeTabOperationError(tabId, error);
            throw error;
        }
    },

    /**
     * Enhanced Typing with human-like behavior
     */
    async cdpType(tabId, text) {
        const safeText = String(text || "");
        for (let i = 0; i < safeText.length; i++) {
            const char = safeText[i];
            
            // Simulating a mistake: 2% chance to type a random neighbor character and then backspace it
            if (Math.random() < 0.02 && i > 0 && i < safeText.length - 1) {
                const typos = "asdfghjklqwertyuiop";
                const typo = typos[Math.floor(Math.random() * typos.length)];
                await this.sendCDP(tabId, "Input.dispatchKeyEvent", { type: "char", text: typo });
                await new Promise(r => setTimeout(r, 100 + Math.random() * 200));
                await this.sendCDP(tabId, "Input.dispatchKeyEvent", { type: "keyDown", windowsVirtualKeyCode: 8, key: "Backspace" });
                await this.sendCDP(tabId, "Input.dispatchKeyEvent", { type: "keyUp", windowsVirtualKeyCode: 8, key: "Backspace" });
                await new Promise(r => setTimeout(r, 200 + Math.random() * 300));
            }

            await this.sendCDP(tabId, "Input.dispatchKeyEvent", { type: "keyDown", key: char });
            await this.sendCDP(tabId, "Input.dispatchKeyEvent", { type: "char", text: char, unmodifiedText: char });
            await this.sendCDP(tabId, "Input.dispatchKeyEvent", { type: "keyUp", key: char });

            // Human-like delay: baseline 30-80ms + occasional long pause (thinking/adjusting hands)
            let delay = 30 + Math.random() * 50;
            if (char === ' ' || char === '.' || char === ',') delay += 100 + Math.random() * 200; // Pause after punctuation
            if (Math.random() < 0.05) delay += 500; // Random "thinking" pause
            
            await new Promise(r => setTimeout(r, delay));
        }
    },

    async cdpInsertText(tabId, text) {
        const safeText = String(text || "");
        if (!safeText) return;
        try {
            await this.sendCDP(tabId, "Input.insertText", { text: safeText });
        } catch (e) {
            await this.cdpType(tabId, safeText);
        }
    },

    async detachDebugger(tabId) {
        return new Promise((resolve) => {
            if (this.debuggerSessions[tabId]) delete this.debuggerSessions[tabId];
            chrome.debugger.detach({ tabId: tabId }, () => {
                chrome.runtime.lastError;
                resolve();
            });
        });
    },

    /**
     * Suppress the "Leave site?" browser dialog
     */
    async suppressLeaveDialog(tabId: number) {
        try {
            if (!(await this.isTabScriptable(tabId))) return;
            await this.executeScript(tabId, {
                target: { tabId: tabId, allFrames: true },
                world: 'MAIN',
                func: () => {
                    try {
                        // 1. Nullify onbeforeunload
                        window.onbeforeunload = null;
                        
                        // 2. Override the property descriptor to prevent resetting
                        try {
                            Object.defineProperty(window, 'onbeforeunload', {
                                get: () => null,
                                set: () => {},
                                configurable: true
                            });
                        } catch (e) {}

                        // 3. Prevent adding beforeunload listeners
                        const originalAddEventListener = window.addEventListener;
                        window.addEventListener = function(type, listener, options) {
                            if (type === 'beforeunload') return;
                            return originalAddEventListener.call(this, type, listener, options);
                        };
                        
                        // 4. Aggressive capture phase listener to stop existing ones
                        window.addEventListener('beforeunload', (e) => {
                            e.stopImmediatePropagation();
                            delete e['returnValue'];
                        }, true);

                        // 5. Suppress standard JS dialogs (alert, confirm, prompt)
                        window.alert = function() {};
                        window.confirm = function() { return true; };
                        window.prompt = function() { return null; };
                    } catch (e) {}
                }
            });
        } catch (e) {}
    },

    cleanupIdleDebuggers(timeoutMs = 300000) {
        const now = Date.now();
        for (const [tabId, session] of Object.entries(this.debuggerSessions)) {
            if (session.attached && (now - session.lastUsed > timeoutMs)) {
                this.detachDebugger(Number(tabId));
            }
        }
    },

    init() {
        if (this._initialized) return;
        setInterval(() => this.cleanupIdleDebuggers(), 60000);
        this._initialized = true;
    },

    /**
     * Show a visual ripple effect
     */
    async showVisualAction(tabId, pos, type = 'click') {
        if (!pos || pos.x === undefined || pos.y === undefined) return;
        const color = this.config.primaryColor || '16,185,129';
        try {
            await this.executeScript(tabId, {
                func: (x, y, t, c) => {
                    const containerId = 'ai-visual-feedback-container';
                    let container = document.getElementById(containerId);
                    if (!container) {
                        container = document.createElement('div');
                        container.id = containerId;
                        container.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483647;';
                        document.documentElement.appendChild(container);
                    }
                    const ripple = document.createElement('div');
                    ripple.style.cssText = `
                        position:absolute;left:${x}px;top:${y}px;width:40px;height:40px;margin-left:-20px;margin-top:-20px;
                        border-radius:50%;background-color:${t === 'click' ? 'rgba(239, 68, 68, 0.4)' : `rgba(${c}, 0.4)`};
                        border:2px solid white;box-shadow:0 0 15px rgba(0,0,0,0.2);
                        transition:all 0.8s cubic-bezier(0.23, 1, 0.32, 1);transform:scale(0.1);opacity:1;
                    `;
                    container.appendChild(ripple);
                    ripple.offsetTop;
                    ripple.style.transform = 'scale(2)'; ripple.style.opacity = '0';
                    setTimeout(() => ripple.remove(), 800);
                },
                args: [pos.x, pos.y, type, color]
            });
        } catch (e) {}
    },

    /**
     * 根据 UID 点击页面元素
     */
    async click(tabId: number, uid: string, options: { dblClick?: boolean } = {}) {
        const cache = this.refMetaCache[tabId];
        if (!cache || !cache.refMeta || !cache.refMeta[uid]) {
            throw new Error(`Element with UID "${uid}" not found in current page cache. Please run readPage first.`);
        }

        const meta = cache.refMeta[uid];
        // 计算中心点坐标
        const x = Math.round(meta.x + meta.width / 2);
        const y = Math.round(meta.y + meta.height / 2);

        // 1. 显示视觉反馈（红圈涟漪）
        await this.showVisualAction(tabId, { x, y }, 'click');

        // 2. 执行物理点击 (按下 + 抬起)
        const clickCount = options.dblClick ? 2 : 1;
        
        await this.sendCDP(tabId, "Input.dispatchMouseEvent", {
            type: "mousePressed",
            x, y,
            button: "left",
            clickCount
        });

        await this.sendCDP(tabId, "Input.dispatchMouseEvent", {
            type: "mouseReleased",
            x, y,
            button: "left",
            clickCount
        });

        return { success: true, x, y };
    },

    /**
     * 等待页面出现特定文字或元素
     */
    async waitFor(tabId: number, options: { text?: string[]; uid?: string; timeout?: number }) {
        const timeout = options.timeout || 30000;
        const start = Date.now();
        const interval = 1000;

        while (Date.now() - start < timeout) {
            // 如果是等待文字
            if (options.text && options.text.length > 0) {
                try {
                    const results = await this.executeScript(tabId, {
                        func: (ts) => {
                            const bodyText = document.body.innerText;
                            return ts.some(t => bodyText.includes(t));
                        },
                        args: [options.text]
                    });
                    if (results?.[0]?.result) return { success: true, found: "text" };
                } catch (e) {}
            }

            // 如果是等待 UID 对应的元素（通常用于等待某个按钮加载出来）
            if (options.uid) {
                try {
                    // 重新运行一次轻量级 readPage 检查
                    const result = await this.readPage(tabId, "interactive", 10);
                    if (result && result.refMeta && result.refMeta[options.uid]) {
                        return { success: true, found: "element" };
                    }
                } catch (e) {}
            }

            await new Promise(r => setTimeout(r, interval));
        }

        throw new Error(`Wait timeout after ${timeout}ms`);
    },

    /**
     * 批量填充表单
     */
    async fillForm(tabId: number, elements: { uid: string; value: string }[]) {
        for (const item of elements) {
            // 1. 先点击元素进行聚焦
            await this.click(tabId, item.uid);
            
            // 2. 清空并输入内容
            // 我们先尝试全选并删除，确保输入框是空的
            await this.sendCDP(tabId, "Input.dispatchKeyEvent", { type: "keyDown", modifiers: 2, key: "a", windowsVirtualKeyCode: 65 }); // Ctrl+A
            await this.sendCDP(tabId, "Input.dispatchKeyEvent", { type: "keyUp", modifiers: 2, key: "a", windowsVirtualKeyCode: 65 });
            await this.sendCDP(tabId, "Input.dispatchKeyEvent", { type: "keyDown", windowsVirtualKeyCode: 8, key: "Backspace" }); // Backspace
            await this.sendCDP(tabId, "Input.dispatchKeyEvent", { type: "keyUp", windowsVirtualKeyCode: 8, key: "Backspace" });

            // 3. 模拟真实输入
            await this.cdpInsertText(tabId, item.value);
            
            // 4. 给一点点喘息时间，让前端框架响应变更
            await new Promise(r => setTimeout(r, 100));
        }
        return { success: true, count: elements.length };
    },

    /**
     * 模拟特定设备环境 (SEO 必备)
     */
    async emulateDevice(tabId: number, profile: 'iphone' | 'android' | 'googlebot' | 'desktop') {
        const profiles = {
            iphone: { width: 375, height: 667, ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/004.1", mobile: true },
            android: { width: 360, height: 640, ua: "Mozilla/5.0 (Linux; Android 10; Pixel 4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/81.0.4044.138 Mobile Safari/537.36", mobile: true },
            googlebot: { width: 1280, height: 800, ua: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", mobile: false },
            desktop: { width: 1920, height: 1080, ua: "", mobile: false } // 空 UA 表示恢复默认
        };

        const config = profiles[profile] || profiles.desktop;
        
        await this.sendCDP(tabId, "Network.setUserAgentOverride", { userAgent: config.ua });
        await this.sendCDP(tabId, "Emulation.setDeviceMetricsOverride", {
            width: config.width,
            height: config.height,
            deviceScaleFactor: config.mobile ? 2 : 1,
            mobile: config.mobile
        });
        
        return { success: true, profile };
    },

    /**
     * 调整页面视口尺寸
     */
    async resizePage(tabId: number, width: number, height: number) {
        await this.sendCDP(tabId, "Emulation.setDeviceMetricsOverride", {
            width: Math.round(width),
            height: Math.round(height),
            deviceScaleFactor: 1,
            mobile: false
        });
        return { success: true, width, height };
    },

    /**
     * 获取页面所有网络请求资源 (检查 404, 资源大小)
     */
    async listNetworkRequests(tabId: number) {
        // 利用浏览器 Performance API 获取资源列表，这比单纯监听事件更稳
        const results = await this.executeScript(tabId, {
            func: () => {
                return window.performance.getEntriesByType('resource').map(r => ({
                    url: r.name,
                    type: (r as any).initiatorType,
                    duration: Math.round(r.duration),
                    size: (r as any).encodedBodySize || 0,
                    transferSize: (r as any).transferSize || 0
                }));
            }
        });
        return results?.[0]?.result || [];
    },

    /**
     * 获取当前域名的 Cookies (管理登录状态)
     */
    async getCookies(tabId: number) {
        const result = await this.sendCDP(tabId, "Network.getCookies", {});
        return result.cookies || [];
    },

    /**
     * 截取全屏长图 (自动调整视口高度)
     */
    async takeFullPageScreenshot(tabId: number, options: { format?: string; quality?: number } = {}) {
        // 1. 获取页面内容高度
        const metrics = await this.sendCDP(tabId, "Page.getLayoutMetrics", {});
        const width = Math.ceil(metrics.contentSize.width);
        const height = Math.ceil(metrics.contentSize.height);

        // 2. 强制撑大视口到内容高度
        await this.sendCDP(tabId, "Emulation.setDeviceMetricsOverride", {
            width, height, deviceScaleFactor: 1, mobile: false
        });

        // 3. 截图
        const result = await this.sendCDP(tabId, "Page.captureScreenshot", {
            format: options.format || "png",
            quality: options.quality || 80,
            fromSurface: true,
            captureBeyondViewport: true
        });

        // 4. 恢复视口默认设置
        await this.sendCDP(tabId, "Emulation.clearDeviceMetricsOverride", {});

        return result;
    },

    /**
     * 物理按键模拟 (支持组合键)
     */
    async pressKey(tabId: number, key: string) {
        // 处理组合键，如 "Control+A"
        const modifiers = {
            Control: 2, Alt: 1, Shift: 8, Meta: 4
        };
        let currentModifiers = 0;
        let mainKey = key;

        if (key.includes('+')) {
            const parts = key.split('+');
            mainKey = parts.pop()!;
            parts.forEach(p => {
                if (modifiers[p]) currentModifiers |= modifiers[p];
            });
        }

        await this.sendCDP(tabId, "Input.dispatchKeyEvent", {
            type: "keyDown",
            modifiers: currentModifiers,
            key: mainKey,
            windowsVirtualKeyCode: mainKey.length === 1 ? mainKey.toUpperCase().charCodeAt(0) : undefined
        });
        await this.sendCDP(tabId, "Input.dispatchKeyEvent", {
            type: "keyUp",
            modifiers: currentModifiers,
            key: mainKey
        });
        return { success: true };
    },

    /**
     * 增强导航 (前进/后退/刷新)
     */
    async navigatePage(tabId: number, type: 'back' | 'forward' | 'reload') {
        if (type === 'reload') {
            await chrome.tabs.reload(tabId);
        } else if (type === 'back') {
            await chrome.tabs.goBack(tabId);
        } else if (type === 'forward') {
            await chrome.tabs.goForward(tabId);
        }
        return { success: true };
    },

    /**
     * 悬停在指定元素上
     */
    async hover(tabId: number, uid: string) {
        const cache = this.refMetaCache[tabId];
        if (!cache || !cache.refMeta || !cache.refMeta[uid]) {
            throw new Error(`Element with UID "${uid}" not found. Run readPage first.`);
        }
        const meta = cache.refMeta[uid];
        const x = Math.round(meta.x + meta.width / 2);
        const y = Math.round(meta.y + meta.height / 2);

        await this.showVisualAction(tabId, { x, y }, 'hover');
        await this.sendCDP(tabId, "Input.dispatchMouseEvent", {
            type: "mouseMoved",
            x, y
        });
        return { success: true };
    },

    /**
     * 获取最近的控制台日志
     */
    async listConsoleMessages(tabId: number) {
        await this.ensureDebuggerAttached(tabId);
        const sess = this.debuggerSessions[tabId];
        return sess?.consoleMessages || [];
    },

    /**
     * 执行任意 JavaScript 代码
     */
    async evaluateScript(tabId: number, script: string) {
        const results = await this.executeScript(tabId, {
            func: (code) => {
                try {
                    // 使用 eval 或 Function 来执行动态代码
                    const fn = new Function(code);
                    return { success: true, result: fn() };
                } catch (e: any) {
                    return { success: false, error: e.message };
                }
            },
            args: [script]
        });
        return results?.[0]?.result;
    },

    /**
     * 将一个元素拖拽到另一个元素
     */
    async drag(tabId: number, fromUid: string, toUid: string) {
        const cache = this.refMetaCache[tabId];
        if (!cache || !cache.refMeta || !cache.refMeta[fromUid] || !cache.refMeta[toUid]) {
            throw new Error("UID not found in cache. Run readPage first.");
        }
        const from = cache.refMeta[fromUid];
        const to = cache.refMeta[toUid];
        
        const fx = Math.round(from.x + from.width / 2);
        const fy = Math.round(from.y + from.height / 2);
        const tx = Math.round(to.x + to.width / 2);
        const ty = Math.round(to.y + to.height / 2);

        await this.sendCDP(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x: fx, y: fy });
        await this.sendCDP(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", x: fx, y: fy, button: "left", clickCount: 1 });
        // 模拟平滑移动
        await this.sendCDP(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x: tx, y: ty, button: "left" });
        await this.sendCDP(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", x: tx, y: ty, button: "left", clickCount: 1 });
        
        return { success: true };
    },

    /**
     * 物理上传文件
     */
    async uploadFile(tabId: number, uid: string, filePath: string) {
        // 首先需要获取 DOM 节点的 nodeId
        // 注意：这是一个高级操作，需要 CDP 的 DOM 域支持
        await this.sendCDP(tabId, "DOM.enable", {});
        const cache = this.refMetaCache[tabId];
        const meta = cache?.refMeta?.[uid];
        if (!meta) throw new Error("UID not found");

        // 通过坐标寻找后端节点 ID
        const { node } = await this.sendCDP(tabId, "DOM.getNodeForLocation", { x: Math.round(meta.x), y: Math.round(meta.y) });
        if (!node) throw new Error("Could not find DOM node at location");

        await this.sendCDP(tabId, "DOM.setFileInputFiles", {
            files: [filePath],
            nodeId: node.nodeId
        });
        return { success: true };
    },

    /**
     * 纯坐标点击
     */
    async clickAt(tabId: number, x: number, y: number) {
        await this.showVisualAction(tabId, { x, y }, 'click');
        await this.sendCDP(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
        await this.sendCDP(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
        return { success: true };
    },

    /**
     * 关闭指定标签页
     */
    async closePage(tabId: number) {
        await chrome.tabs.remove(tabId);
        return { success: true };
    },

    /**
     * 切换到指定标签页 (置顶显示)
     */
    async selectPage(tabId: number) {
        await chrome.tabs.update(tabId, { active: true });
        const tab = await chrome.tabs.get(tabId);
        if (tab.windowId) {
            await chrome.windows.update(tab.windowId, { focused: true });
        }
        return { success: true };
    },

    /**
     * 物理打字模拟 (人类速度)
     */
    async typeText(tabId: number, text: string) {
        await this.ensureDebuggerAttached(tabId);
        await this.cdpType(tabId, text);
        return { success: true };
    },

    /**
     * 手动处理弹窗
     */
    async handleDialog(tabId: number, action: 'accept' | 'dismiss', promptText?: string) {
        await this.ensureDebuggerAttached(tabId);
        const sess = this.debuggerSessions[tabId];
        // 开启手动模式
        sess.manualDialogHandling = true;
        
        await this.sendCDP(tabId, "Page.handleJavaScriptDialog", {
            accept: action === 'accept',
            promptText: promptText
        });
        
        delete sess.pendingDialog;
        return { success: true };
    },

    /**
     * 获取特定网络请求的响应体 (查看 API 返回数据)
     */
    async getNetworkResponseBody(tabId: number, requestId: string) {
        await this.ensureDebuggerAttached(tabId);
        const result = await this.sendCDP(tabId, "Network.getResponseBody", {
            requestId: requestId
        });
        return result;
    },

    /**
     * 开始抓取堆内存快照
     */
    async takeHeapSnapshot(tabId: number, onChunk: (chunk: string) => void) {
        await this.ensureDebuggerAttached(tabId);
        this.onHeapSnapshotChunk = onChunk;
        
        await this.sendCDP(tabId, "HeapProfiler.takeHeapSnapshot", {
            reportProgress: true,
            captureNumericValue: true
        });
        
        // 抓取结束后清除回调
        this.onHeapSnapshotChunk = null;
        return { success: true };
    },

    async readPage(tabId, filter = "all", depth = 30, ref_id = null) {
        // === 引擎 A：前台 JS 递归引擎 (优先使用，完美攻克小红书等高防网页) ===
        try {
            if (await this.isTabScriptable(tabId)) {
                const checkRes = await this.executeScript(tabId, { func: () => typeof window.__generateAccessibilityTree === "function" });
                if (!checkRes?.[0]?.result) {
                    await this.executeScript(tabId, { files: ["content.js"] });
                }
                const safeRefId = ref_id ? this.normalizeRefId(ref_id) : null;
                const results = await this.executeScript(tabId, {
                    func: (f, d, r) => window.__generateAccessibilityTree?.(f, d, r),
                    args: [filter, depth, safeRefId]
                });
                const result = results?.[0]?.result;
                if (result && !result.error) {
                    if (result.refMeta) this.cacheRefMeta(tabId, result.pageUrl || "", result.refMeta);
                    return result;
                }
            }
        } catch (scriptErr) {
            console.warn("DOM AX Engine fallback due to script error:", scriptErr.message);
        }

        // === 引擎 B：后台原生 CDP 引擎 (降级兜底，用于无法注入内容脚本的扩展页面) ===
        try {
            await this.ensureDebuggerAttached(tabId);
            await this.sendCDP(tabId, "DOM.enable", {});
            await this.sendCDP(tabId, "Accessibility.enable", {});
            
            try {
                await this.sendCDP(tabId, "DOM.getDocument", { depth: -1, pierce: true });
            } catch (domErr) {}

            const result = await this.sendCDP(tabId, "Accessibility.getFullAXTree", {});
            const nodes = result?.nodes;
            if (!nodes || nodes.length === 0) return { error: "Empty accessibility tree" };

            const nodeMap = new Map();
            for (const n of nodes) {
                nodeMap.set(n.nodeId, n);
            }

            const lines = [];
            const walkAXNode = (nodeId, d) => {
                const node = nodeMap.get(nodeId);
                if (!node || node.ignored) return;

                const role = node.role?.value || "generic";
                const name = node.name?.value || "";
                
                const isIgnoredRole = ["generic", "none", "Presentation", "StaticText"].includes(role);
                if (filter === "interactive") {
                    const isInteractiveRole = ["link", "button", "checkbox", "radio", "textbox", "combobox"].includes(role);
                    if (isInteractiveRole && name) {
                        lines.push(" ".repeat(d) + `${role} "${name}"`);
                    }
                } else {
                    if (!isIgnoredRole || name) {
                        lines.push(" ".repeat(d) + `${role}${name ? ` "${name}"` : ''}`);
                    }
                }

                if (node.childIds) {
                    for (const cid of node.childIds) {
                        walkAXNode(cid, d + 1);
                    }
                }
            };

            const rootNode = nodes.find(n => !n.parentId) || nodes[0];
            if (rootNode) {
                walkAXNode(rootNode.nodeId, 0);
            }

            const tab = await chrome.tabs.get(tabId);
            return {
                pageContent: lines.join("\n"),
                pageUrl: tab?.url || ""
            };
        } catch (e) {
            return { error: e.message };
        }
    },





    async getPageText(tabId) {

        try {
            const results = await this.executeScript(tabId, { func: () => ({ title: document.title, text: document.body.innerText.substring(0, 10000) }) });
            return results[0]?.result || { error: "Failed." };
        } catch (e) { return { error: e.message }; }
    },



    async setVisualIndicator(tabId, show) {
        try {
            if (!tabId || !(await this.isTabScriptable(tabId))) return;
            const color = this.config.primaryColor || '16,185,129';
            await this.executeScript(tabId, {
                func: (s, c) => {
                    let o = document.getElementById('ai-agent-visual-indicator');
                    if (s) {
                        if (!o) {
                            o = document.createElement('div'); o.id = 'ai-agent-visual-indicator';
                            o.style.cssText = `position:fixed;inset:0;pointer-events:none;z-index:2147483647;border:3px solid rgba(${c},0.5);box-shadow:inset 0 0 50px rgba(${c},0.2);animation:ai-pulse 2s infinite alternate;`;
                            const st = document.createElement('style'); st.textContent = `@keyframes ai-pulse{from{border-color:rgba(${c},0.3);box-shadow:inset 0 0 30px rgba(${c},0.1);}to{border-color:rgba(${c},0.7);box-shadow:inset 0 0 70px rgba(${c},0.3);}}`;
                            document.head.appendChild(st); document.documentElement.appendChild(o);
                        }
                        o.style.display = 'block';
                    } else if (o) o.style.display = 'none';
                },
                args: [show, color]
            });
        } catch (e) {}
    }
};
