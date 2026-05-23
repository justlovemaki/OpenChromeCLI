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

                if (!this._debuggerListenerAdded) {
                    chrome.debugger.onDetach.addListener((source, reason) => {
                        if (source.tabId) {
                            delete this.debuggerSessions[source.tabId];
                            console.log(`Debugger detached from tab ${source.tabId} due to: ${reason}`);
                        }
                    });
                    
                    // Automatically handle any JS dialogs (alert, confirm, prompt, beforeunload)
                    chrome.debugger.onEvent.addListener((source, method, params) => {
                        if (method === "Page.javascriptDialogOpening") {
                            chrome.debugger.sendCommand(source, "Page.handleJavaScriptDialog", {
                                accept: true
                            }, () => {
                                if (chrome.runtime.lastError) {
                                    // Silent fail if command failed
                                }
                            });
                        }
                    });
                    
                    this._debuggerListenerAdded = true;
                }
                
                resolve();
            });
        });

        this.debuggerSessions[tabId] = { attached: false, attaching };
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
