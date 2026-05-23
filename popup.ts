function updateUI() {
    chrome.runtime.sendMessage({ type: 'GET_RELAY_STATUS' }, (status) => {
        const statusVal = document.getElementById('status-val');
        const portVal = document.getElementById('port-val');
        const errorVal = document.getElementById('error-val');
        const reconnectBtn = document.getElementById('reconnect-btn') as HTMLButtonElement;

        if (status) {
            statusVal!.textContent = status.state.charAt(0).toUpperCase() + status.state.slice(1);
            statusVal!.className = `value status-${status.state}`;
            
            portVal!.textContent = status.port || '-';
            
            if (status.error) {
                errorVal!.textContent = status.error;
                errorVal!.style.display = 'block';
            } else {
                errorVal!.style.display = 'none';
            }
        }
    });
}

document.getElementById('reconnect-btn')?.addEventListener('click', () => {
    const btn = document.getElementById('reconnect-btn') as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = 'Restarting...';

    chrome.runtime.sendMessage({ type: 'RESTART_RELAY' }, (response) => {
        setTimeout(() => {
            btn.disabled = false;
            btn.textContent = 'Reconnect Bridge';
            updateUI();
        }, 2000);
    });
});

// 初始更新
updateUI();

// 监听状态变化通知
chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'NATIVE_RELAY_STATUS_CHANGED') {
        updateUI();
    }
});

// 每3秒定时检查一次
setInterval(updateUI, 3000);
