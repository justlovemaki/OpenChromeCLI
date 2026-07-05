// @ts-nocheck
(function() {
    const MAX_NAME_LENGTH = 100;

    function getRole(el: HTMLElement) {
        const explicitRole = el.getAttribute("role");
        if (explicitRole) return explicitRole;

        const tag = el.tagName.toLowerCase();
        const type = el.getAttribute("type");

        if (el.getAttribute("aria-modal") === "true") return "dialog";
        if (el.getAttribute("contenteditable") === "true") return "textbox";

        const roles: { [key: string]: string } = {
            a: "link",
            button: "button",
            input: type === "submit" || type === "button" ? "button" :
                type === "checkbox" ? "checkbox" :
                type === "radio" ? "radio" :
                type === "file" ? "button" : "textbox",
            select: "combobox",
            textarea: "textbox",
            h1: "heading",
            h2: "heading",
            h3: "heading",
            h4: "heading",
            h5: "heading",
            h6: "heading",
            img: "image",
            nav: "navigation",
            main: "main",
            header: "banner",
            footer: "contentinfo",
            section: "region",
            article: "article",
            aside: "complementary",
            form: "form",
            table: "table",
            ul: "list",
            ol: "list",
            li: "listitem",
            label: "label",
            dialog: "dialog"
        };
        return roles[tag] || "generic";
    }

    function getName(el: HTMLElement) {
        const tag = el.tagName.toLowerCase();

        if (tag === "select") {
            const select = el as HTMLSelectElement;
            const selected = select.querySelector("option[selected]") || select.options[select.selectedIndex];
            if (selected && selected.textContent) return selected.textContent.trim();
        }

        const attrs = ["aria-label", "placeholder", "title", "alt"];
        for (const attr of attrs) {
            const value = el.getAttribute(attr);
            if (value && value.trim()) return value.trim();
        }

        if (["button", "a"].includes(tag) && !el.textContent?.trim()) {
            const svg = el.querySelector("svg");
            const svgLabel = svg?.getAttribute("aria-label") || svg?.querySelector("title")?.textContent;
            if (svgLabel) return svgLabel.trim();
        }

        if (el.id) {
            const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
            if (label && label.textContent && label.textContent.trim()) return label.textContent.trim();
        }

        if (tag === "input") {
            const input = el as HTMLInputElement;
            const type = input.getAttribute("type") || "";
            const valueAttr = input.getAttribute("value");
            if (type === "submit" && valueAttr && valueAttr.trim()) return valueAttr.trim();
            if (input.value && input.value.length < 50 && input.value.trim()) return input.value.trim();
        }

        const text = (el as any).innerText || el.textContent;
        return text && text.trim() ? text.trim().substring(0, MAX_NAME_LENGTH) : "";
    }

    function isVisible(el: HTMLElement) {
        const style = window.getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") return false;
        const tag = el.tagName.toLowerCase();
        if (["input", "select", "textarea", "button"].includes(tag)) return true;
        return style.opacity !== "0" && el.offsetWidth > 0 && el.offsetHeight > 0;
    }

    function isInteractive(el: HTMLElement) {
        const tag = el.tagName.toLowerCase();
        return ["a", "button", "input", "select", "textarea", "details", "summary"].includes(tag) ||
            el.getAttribute("onclick") !== null ||
            el.getAttribute("tabindex") !== null ||
            ["button", "link", "checkbox", "radio", "textbox"].includes(el.getAttribute("role") || "") ||
            el.getAttribute("contenteditable") === "true";
    }

    function isSemantic(el: HTMLElement) {
        const tag = el.tagName.toLowerCase();
        return ["h1", "h2", "h3", "h4", "h5", "h6", "nav", "main", "header", "footer", "section", "article", "aside", "form"].includes(tag) ||
            el.getAttribute("role") !== null;
    }

    function shouldInclude(el: HTMLElement, context: any) {
        const tag = el.tagName.toLowerCase();
        if (["script", "style", "meta", "link", "title", "noscript"].includes(tag)) return false;
        if (context.filter !== "all" && el.getAttribute("aria-hidden") === "true") return false;
        if (context.filter !== "all" && !isVisible(el)) return false;
        if (context.filter === "interactive") return isInteractive(el);
        if (isInteractive(el) || isSemantic(el) || getName(el).length > 0) return true;
        const role = getRole(el);
        return role !== null && role !== "generic" && role !== "image";
    }

    function escapeAttr(value: any) {
        return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\"');
    }

    function getCssPath(el: HTMLElement) {
        const parts = [];
        let current: HTMLElement | null = el;

        while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
            let part = current.tagName.toLowerCase();
            if (current.id) {
                part += `#${CSS.escape(current.id)}`;
                parts.unshift(part);
                break;
            }

            const parent = current.parentElement;
            if (!parent) break;
            const siblings = Array.from(parent.children).filter(node => node.tagName === current?.tagName);
            if (siblings.length > 1) {
                part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
            }
            parts.unshift(part);
            current = parent;
        }

        return parts.join(" > ");
    }

    function getFormContext(el: HTMLElement) {
        const form = el.closest("form");
        if (!form) return null;
        return {
            id: form.id || "",
            action: form.getAttribute("action") || "",
            method: form.getAttribute("method") || "",
            fieldIndex: Array.from(form.querySelectorAll("input, textarea, select, [contenteditable='true'], [role='textbox']")).indexOf(el)
        };
    }

    function getDescriptor(el: HTMLElement) {
        const rect = el.getBoundingClientRect();
        return {
            tag: el.tagName.toLowerCase(),
            role: getRole(el),
            id: el.id || "",
            nameAttr: el.getAttribute("name") || "",
            type: el.getAttribute("type") || "",
            placeholder: el.getAttribute("placeholder") || "",
            ariaLabel: el.getAttribute("aria-label") || "",
            title: el.getAttribute("title") || "",
            href: el.getAttribute("href") || "",
            text: getName(el).replace(/\s+/g, " ").trim().substring(0, MAX_NAME_LENGTH),
            cssPath: getCssPath(el),
            formContext: getFormContext(el),
            // 新增坐标和尺寸信息，解决 NaN 导致的 CDP 参数错误
            x: rect.left,
            y: rect.top,
            width: rect.width,
            height: rect.height
        };
    }

    function getCandidateSelectors(meta: any) {
        const selectors = [];

        if (meta.id) selectors.push(`#${CSS.escape(meta.id)}`);
        if (meta.cssPath) selectors.push(meta.cssPath);

        let base = meta.tag || "*";
        if (meta.type) base += `[type="${escapeAttr(meta.type)}"]`;
        if (meta.nameAttr) selectors.push(`${base}[name="${escapeAttr(meta.nameAttr)}"]`);
        if (meta.placeholder) selectors.push(`${base}[placeholder="${escapeAttr(meta.placeholder)}"]`);
        if (meta.ariaLabel) selectors.push(`${base}[aria-label="${escapeAttr(meta.ariaLabel)}"]`);
        if (meta.href) selectors.push(`${base}[href="${escapeAttr(meta.href)}"]`);
        if (meta.role) selectors.push(`${base}[role="${escapeAttr(meta.role)}"]`);
        selectors.push(base);

        return selectors;
    }

    function scoreCandidate(el: HTMLElement, meta: any) {
        if (!el || !document.contains(el)) return -1;

        let score = 0;
        if ((el.tagName || "").toLowerCase() === meta.tag) score += 6;
        if ((el.getAttribute("role") || getRole(el)) === meta.role) score += 4;
        if ((el.id || "") === meta.id && meta.id) score += 20;
        if ((el.getAttribute("name") || "") === meta.nameAttr && meta.nameAttr) score += 12;
        if ((el.getAttribute("placeholder") || "") === meta.placeholder && meta.placeholder) score += 10;
        if ((el.getAttribute("aria-label") || "") === meta.ariaLabel && meta.ariaLabel) score += 10;
        if ((el.getAttribute("title") || "") === meta.title && meta.title) score += 8;
        if ((el.getAttribute("type") || "") === meta.type && meta.type) score += 5;
        if ((el.getAttribute("href") || "") === meta.href && meta.href) score += 8;

        const name = getName(el).replace(/\s+/g, " ").trim().substring(0, MAX_NAME_LENGTH);
        if (meta.text && name === meta.text) score += 10;
        else if (meta.text && name && (name.includes(meta.text) || meta.text.includes(name))) score += 5;

        if (isVisible(el)) score += 2;
        if (document.activeElement === el) score += 1;

        return score;
    }

    function ensureStores() {
        window.__claudeElementMap = window.__claudeElementMap || {};
        window.__claudeElementMeta = window.__claudeElementMeta || {};
        window.__claudeRefCounter = window.__claudeRefCounter || 0;
    }

    function storeElement(refId: string, el: HTMLElement) {
        ensureStores();
        el.dataset.claudeRefId = refId;
        if (window.__claudeElementMeta) window.__claudeElementMeta[refId] = getDescriptor(el);
        if (window.__claudeElementMap) window.__claudeElementMap[refId] = typeof WeakRef === "function" ? new WeakRef(el) : el;
    }

    function getStoredElement(refId: string) {
        const entry = window.__claudeElementMap?.[refId];
        if (!entry) return null;
        if (typeof WeakRef === "function" && entry instanceof WeakRef) {
            const el = entry.deref();
            return el && document.contains(el) ? el : null;
        }
        return document.contains(entry as Node) ? (entry as HTMLElement) : null;
    }

    function resolveElement(refId: string) {
        ensureStores();
        if (!refId) return null;

        let el = getStoredElement(refId);
        if (el) return el;

        el = document.querySelector(`[data-claude-ref-id="${CSS.escape(refId)}"]`) as HTMLElement | null;
        if (el) {
            storeElement(refId, el);
            return el;
        }

        const meta = window.__claudeElementMeta?.[refId];
        if (!meta) return null;

        if (meta.formContext) {
            let form = null;
            if (meta.formContext.id) {
                form = document.getElementById(meta.formContext.id);
            }
            if (!form && meta.formContext.action) {
                form = document.querySelector(`form[action="${escapeAttr(meta.formContext.action)}"]`);
            }
            if (!form && meta.formContext.method) {
                form = document.querySelector(`form[method="${escapeAttr(meta.formContext.method)}"]`);
            }
            if (form && meta.formContext.fieldIndex >= 0) {
                const fields = Array.from(form.querySelectorAll("input, textarea, select, [contenteditable='true'], [role='textbox']"));
                const indexed = fields[meta.formContext.fieldIndex];
                if (indexed) {
                    storeElement(refId, indexed);
                    return indexed;
                }
            }
        }

        let best = null;
        let bestScore = -1;
        const seen = new Set();

        for (const selector of getCandidateSelectors(meta)) {
            let nodes = [];
            try {
                const findInTree = (root: Document | ShadowRoot | Element) => {
                    let matches: Element[] = Array.from(root.querySelectorAll(selector));
                    const children = Array.from(root.children);
                    for (const child of children) {
                        if (child.shadowRoot) {
                            matches = matches.concat(findInTree(child.shadowRoot));
                        }
                    }
                    return matches;
                };
                nodes = findInTree(document);
            } catch (e) {
                continue;
            }

            for (const node of nodes) {
                if (seen.has(node)) continue;
                seen.add(node);
                const score = scoreCandidate(node, meta);
                if (score > bestScore) {
                    best = node;
                    bestScore = score;
                }
            }

            if (bestScore >= 18) break;
        }

        if (best) {
            storeElement(refId, best);
            return best;
        }

        return null;
    }

    function walk(node, depth, context, lines, maxDepth, metaMap) {
        if (depth > maxDepth || !node || !node.tagName) return;

        const includeNode = shouldInclude(node, context) || (context.refId && depth === 0);
        if (includeNode) {
            let refId = node.dataset.claudeRefId;
            if (!refId) refId = `ref_${++window.__claudeRefCounter}`;
            storeElement(refId, node);
            if (metaMap) metaMap[refId] = window.__claudeElementMeta[refId];

            const role = getRole(node);
            const name = getName(node);
            let line = " ".repeat(depth) + role;
            if (name) line += ` "${name.replace(/\s+/g, " ").substring(0, MAX_NAME_LENGTH).replace(/"/g, '\\"')}"`;
            line += ` [${refId}]`;
            if (node.id) line += ` id="${node.id}"`;
            if (node.getAttribute("name")) line += ` name="${node.getAttribute("name")}"`;
            if (node === document.activeElement) line += ` focused="true"`;
            if (node.getAttribute("type")) line += ` type="${node.getAttribute("type")}"`;
            if (node.getAttribute("placeholder")) line += ` placeholder="${node.getAttribute("placeholder")}"`;
            if (node.getAttribute("data-testid")) line += ` testid="${node.getAttribute("data-testid")}"`;
            if (node.tagName.toLowerCase() === 'a' && node.getAttribute("href")) line += ` href="${node.getAttribute("href")}"`;
            lines.push(line);
        }

        let children = Array.from(node.children);
        if (node.shadowRoot) {
            children = children.concat(Array.from(node.shadowRoot.children));
        }

        for (const child of children) {
            walk(child, includeNode ? depth + 1 : depth, context, lines, maxDepth, metaMap);
        }
    }

    ensureStores();
    (window as any).__claudeResolveElement = resolveElement;
    (window as any).__claudeSyncRefMeta = (refId: string, meta: any) => {
        ensureStores();
        if (window.__claudeElementMeta) {
            window.__claudeElementMeta[refId] = meta;
            return true;
        }
        return false;
    };

    function clickUID(refId: string, action: string = "click", externalMeta: any = null) {
        ensureStores();
        if (externalMeta && window.__claudeElementMeta) {
            window.__claudeElementMeta[refId] = externalMeta;
        }
        
        const el = resolveElement(refId);
        if (!el) return { error: "Element not found or could not be matched via fingerprint." };
        
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        
        if (action === "hover") {
            ["mouseover", "mouseenter"].forEach(t => el.dispatchEvent(new MouseEvent(t, { bubbles: true })));
            return { success: true };
        }
        
        if (typeof (el as any).click === "function") {
            (el as any).click();
        } else {
            el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        }
        return { success: true };
    }

    function getPageSource(refId: string | null = null, includeStyles: boolean = false) {
        try {
            ensureStores();
            const el = refId ? resolveElement(refId) : document.documentElement;
            if (!el) return { error: "Element not found" };

            let html = el.outerHTML;
            let styles = "";
            
            if (!refId) {
                const styleElements = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'));
                styles = styleElements.map(s => s.outerHTML).join("\n");
            } else if (includeStyles && el instanceof HTMLElement) {
                const style = window.getComputedStyle(el);
                const props: any = {};
                for (let i = 0; i < style.length; i++) {
                    const prop = style[i];
                    props[prop] = style.getPropertyValue(prop);
                }
                styles = JSON.stringify(props, null, 2);
            }

            return { html, styles };
        } catch (err: any) {
            return { error: err.message };
        }
    }

    (window as any).__clickUID = clickUID;
    (window as any).__getPageSource = getPageSource;

    function generateAccessibilityTree(filter: string = "all", maxDepth: number = 30, refId: string | null = null) {
        try {
            ensureStores();
            const root = refId ? resolveElement(refId) : document.body;
            if (!root) return { error: "Root not found" };

            const tree = {
                pageContent: "",
                viewport: { width: window.innerWidth, height: window.innerHeight },
                pageUrl: window.location.href,
                seoInfo: {
                    title: document.title,
                    description: (document.querySelector('meta[name="description"]') as any)?.content || "",
                    keywords: (document.querySelector('meta[name="keywords"]') as any)?.content || "",
                    canonical: (document.querySelector('link[rel="canonical"]') as any)?.href || "",
                    h1: Array.from(document.querySelectorAll('h1')).map(h => h.textContent?.trim()).filter(Boolean),
                    lang: document.documentElement.lang,
                    charSet: document.characterSet,
                    ogTitle: (document.querySelector('meta[property="og:title"]') as any)?.content || "",
                    ogDescription: (document.querySelector('meta[property="og:description"]') as any)?.content || "",
                    linkCount: document.querySelectorAll('a').length
                },
                refMeta: {} as { [key: string]: any }
            };

            const lines = [];
            walk(root, 0, { filter, refId }, lines, maxDepth, tree.refMeta);
            tree.pageContent = lines.join("\n");
            
            return tree;
        } catch (err: any) {
            return { error: err.message };
        }
    }

    (window as any).__generateAccessibilityTree = generateAccessibilityTree;

    // === 虚拟鼠标指针绘制及移动逻辑 ===
    let virtualCursor: HTMLDivElement | null = null;

    function getOrCreateVirtualCursor(): HTMLDivElement {
        const container = document.body || document.documentElement;
        if (virtualCursor && container.contains(virtualCursor)) {
            return virtualCursor;
        }

        virtualCursor = document.createElement("div");
        virtualCursor.id = "native-relay-virtual-cursor";
        
        // 自动适配路径：主插件环境下在 bridge/ 目录下，独立版环境下在根目录下
        const manifest = chrome.runtime.getManifest();
        const iconPath = (manifest.name.includes("SEO Master") || manifest.name.includes("SEO助手"))
            ? "bridge/icons/cursor-chat.png" 
            : "icons/cursor-chat.png";
            
        const iconUrl = chrome.runtime.getURL(iconPath);
        
        Object.assign(virtualCursor.style, {
            position: "fixed",
            top: "0px",
            left: "0px",
            width: "32px",
            height: "32px",
            backgroundImage: `url("${iconUrl}")`,
            backgroundSize: "contain",
            backgroundRepeat: "no-repeat",
            pointerEvents: "none",
            zIndex: "10000000",
            transition: "transform 0.4s cubic-bezier(0.25, 0.8, 0.25, 1), opacity 0.5s ease",
            transform: "translate(-100px, -100px)",
            opacity: "0",
            display: "none"
        });

        container.appendChild(virtualCursor);
        return virtualCursor;
    }

    // 闲置自动淡出隐藏管理
    let hideCursorTimeout: any = null;

    function resetCursorHideTimer(cursor: HTMLDivElement) {
        if (hideCursorTimeout) {
            clearTimeout(hideCursorTimeout);
            hideCursorTimeout = null;
        }

        // 3秒无任何鼠标移动消息，自动在 0.5 秒渐隐动画中功成身退，隐于无形
        hideCursorTimeout = setTimeout(() => {
            cursor.style.opacity = "0";
            setTimeout(() => {
                if (cursor.style.opacity === "0") {
                    cursor.style.display = "none";
                }
            }, 500);
        }, 3000);
    }

    // === 网页内高保真水波纹涟漪动效 ===
    function showRippleLocally(x: number, y: number, type: 'click' | 'type' = 'click') {
        const containerId = 'ai-visual-feedback-container';
        let container = document.getElementById(containerId);
        if (!container) {
            container = document.createElement('div');
            container.id = containerId;
            container.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483647;';
            document.documentElement.appendChild(container);
        }
        
        const ripple = document.createElement('div');
        // 恢复为经典的翡翠绿（SEO Master 主题色）
        const color = 'rgba(16, 185, 129, 0.4)';
        
        ripple.style.cssText = `
            position:absolute;left:${x}px;top:${y}px;width:40px;height:40px;margin-left:-20px;margin-top:-20px;
            border-radius:50%;background-color:${color};
            border:2px solid white;box-shadow:0 0 15px rgba(16,185,129,0.3);
            transition:all 0.8s cubic-bezier(0.23, 1, 0.32, 1);transform:scale(0.1);opacity:1;
        `;
        
        container.appendChild(ripple);
        // 先短暂停留一帧，避免点击后立即导航时涟漪尚未被肉眼看到。
        ripple.offsetTop;
        setTimeout(() => {
            ripple.style.transform = 'scale(2.5)';
            ripple.style.opacity = '0';
        }, 120);
        setTimeout(() => ripple.remove(), 1150);
    }

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message && message.type === "MOVE_MOUSE") {
            const cursor = getOrCreateVirtualCursor();
            
            // 强行清空当前的隐藏倒计时，瞬间苏醒并展现鼠标
            if (hideCursorTimeout) {
                clearTimeout(hideCursorTimeout);
                hideCursorTimeout = null;
            }
            cursor.style.display = "block";
            cursor.style.opacity = "1";
            
            // 临时隐藏光标，避免 elementFromPoint 抓到光标自己
            cursor.style.pointerEvents = "none";
            cursor.style.transform = `translate(${message.x}px, ${message.y}px)`;
            
            if (message.waitForArrival) {
                const onTransitionEnd = (e: TransitionEvent) => {
                    if (e.propertyName === "transform") {
                        cursor.removeEventListener("transitionend", onTransitionEnd);
                        
                        resetCursorHideTimer(cursor);
                        sendResponse({ ok: true });
                    }
                };
                cursor.addEventListener("transitionend", onTransitionEnd);
                setTimeout(() => {
                    cursor.removeEventListener("transitionend", onTransitionEnd);
                    resetCursorHideTimer(cursor);
                    try { sendResponse({ ok: true }); } catch (e) {}
                }, 500);
                return true;
            } else {
                resetCursorHideTimer(cursor);
                sendResponse({ ok: true });
            }
        } else if (message && message.type === "SHOW_VISUAL_ACTION") {
            // 支持直接触发点击波纹
            const { x, y, actionType } = message;
            if (typeof x === "number" && typeof y === "number") {
                showRippleLocally(x, y, actionType);
            }
            sendResponse({ ok: true });
        }
    });
})();
