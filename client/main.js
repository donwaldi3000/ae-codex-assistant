const AGENT_SETTINGS_KEY = 'ae-agent-settings-v1';

function getDefaultPanelSettings() {
    return {
        riskMode: 'Balanced',
        scope: 'ActiveComp',
        approvalOverride: 'Default',
    };
}

function loadPanelSettings() {
    try {
        const raw = localStorage.getItem(AGENT_SETTINGS_KEY);
        if (!raw) return getDefaultPanelSettings();
        const parsed = JSON.parse(raw);
        return {
            riskMode: parsed.riskMode || 'Balanced',
            scope: parsed.scope || 'ActiveComp',
            approvalOverride: parsed.approvalOverride || 'Default',
        };
    } catch (error) {
        log(`Failed to load panel settings: ${error.toString()}`);
        return getDefaultPanelSettings();
    }
}

function persistPanelSettings(settings) {
    try {
        localStorage.setItem(AGENT_SETTINGS_KEY, JSON.stringify(settings));
    } catch (error) {
        log(`Failed to persist panel settings: ${error.toString()}`);
    }
}

function collectPanelSettings() {
    const riskSelect = document.getElementById('risk-mode');
    const scopeSelect = document.getElementById('scope-mode');
    const overrideSelect = document.getElementById('approval-override');
    return {
        riskMode: riskSelect ? riskSelect.value : 'Balanced',
        scope: scopeSelect ? scopeSelect.value : 'ActiveComp',
        approvalOverride: overrideSelect ? overrideSelect.value : 'Default',
    };
}

function applyPanelSettings(settings) {
    const riskSelect = document.getElementById('risk-mode');
    const scopeSelect = document.getElementById('scope-mode');
    const overrideSelect = document.getElementById('approval-override');
    if (riskSelect) riskSelect.value = settings.riskMode || 'Balanced';
    if (scopeSelect) scopeSelect.value = settings.scope || 'ActiveComp';
    if (overrideSelect) overrideSelect.value = settings.approvalOverride || 'Default';
}

function syncPanelSettingsToBridge(settings) {
    if (!nodeReady) {
        log('Bridge settings sync skipped: CEP Node is disabled.');
        return;
    }
    const request = http.request(
        {
            hostname: '127.0.0.1',
            port: 8080,
            path: '/agent/settings',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
        },
        (res) => {
            if (res.statusCode && res.statusCode >= 400) {
                log(`Failed to sync agent settings. HTTP ${res.statusCode}`);
                return;
            }
            log(`Agent settings synced (${settings.riskMode} / ${settings.scope} / ${settings.approvalOverride}).`);
        },
    );
    request.on('error', (error) => {
        log(`Failed to sync agent settings: ${error.toString()}`);
    });
    request.write(JSON.stringify(settings));
    request.end();
}

function initAgentControls() {
    const saveButton = document.getElementById('save-agent-settings');
    const settings = loadPanelSettings();
    applyPanelSettings(settings);
    if (saveButton) {
        saveButton.addEventListener('click', () => {
            const nextSettings = collectPanelSettings();
            persistPanelSettings(nextSettings);
            syncPanelSettingsToBridge(nextSettings);
        });
    }
}

startBridgeServer();
initAgentControls();
syncPanelSettingsToBridge(loadPanelSettings());
