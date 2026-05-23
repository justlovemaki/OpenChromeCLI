import { NativeRelayExtension } from './native_rpc.js';

let nativeRelay: NativeRelayExtension;

// Initialize relay
// We use the same host name
setTimeout(() => {
    nativeRelay = new NativeRelayExtension("com.bridge.relay.host");
    (nativeRelay as any).transportInstance.connect();
    console.log("Agent Browser Bridge initialized");
}, 1000);

// Forward CDP events to relay
chrome.debugger.onEvent.addListener((source, method, params) => {
  if (source.tabId && nativeRelay) {
    nativeRelay.sendCdpEvent({
      source: { tabId: source.tabId },
      method,
      params
    });
  }
});

// Handle messages (both internal and external)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'GET_RELAY_STATUS') {
        if (!nativeRelay) {
            sendResponse({ state: "disconnected", error: "Initializing..." });
        } else {
            sendResponse(nativeRelay.getStatus());
        }
    } else if (message.type === 'RESTART_RELAY') {
        if (nativeRelay) {
            nativeRelay.restartRelay().then(res => sendResponse(res));
            return true; // Keep channel open for async response
        } else {
            sendResponse({ success: false, error: "Relay not initialized" });
        }
    }
});

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
    if (message.type === 'GET_RELAY_STATUS') {
        if (!nativeRelay) {
            sendResponse({ state: "disconnected", error: "Initializing..." });
        } else {
            sendResponse(nativeRelay.getStatus());
        }
    }
    return true;
});
