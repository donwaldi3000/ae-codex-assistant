const AGENT_SETTINGS_KEY = 'ae-agent-settings-v1';
const CODEX_SETTINGS_KEY = 'ae-codex-settings-v1';

const panelState = {
    operations: [],
};

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

function loadCodexSettings() {
    try {
        const raw = localStorage.getItem(CODEX_SETTINGS_KEY);
        if (!raw) return { model: 'gpt-5-mini' };
        const parsed = JSON.parse(raw);
        return {
            model: parsed.model || 'gpt-5-mini',
        };
    } catch (error) {
        log(`Failed to load Codex settings: ${error.toString()}`);
        return { model: 'gpt-5-mini' };
    }
}

function persistCodexSettings(settings) {
    try {
        const payload = { model: settings.model || 'gpt-5-mini' };
        localStorage.setItem(CODEX_SETTINGS_KEY, JSON.stringify(payload));
    } catch (error) {
        log(`Failed to persist Codex settings: ${error.toString()}`);
    }
}

function collectPanelSettings() {
    return {
        riskMode: (document.getElementById('risk-mode') || {}).value || 'Balanced',
        scope: (document.getElementById('scope-mode') || {}).value || 'ActiveComp',
        approvalOverride: (document.getElementById('approval-override') || {}).value || 'Default',
    };
}

function collectCodexSettings() {
    return {
        model: (document.getElementById('codex-model') || {}).value || 'gpt-5-mini',
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

function applyCodexSettings(settings) {
    const modelInput = document.getElementById('codex-model');
    if (modelInput) modelInput.value = settings.model || 'gpt-5-mini';
}

function setCodexStatus(text) {
    const statusEl = document.getElementById('codex-login-status');
    if (statusEl) {
        statusEl.textContent = text;
    }
}

function setResultsText(text) {
    const resultEl = document.getElementById('results');
    if (resultEl) resultEl.textContent = text || '';
}

function setPlanSummary(text) {
    const summaryEl = document.getElementById('plan-summary');
    if (summaryEl) summaryEl.textContent = text || '';
}

function bridgeRequest(pathname, body) {
    return new Promise((resolve, reject) => {
        if (!nodeReady) {
            reject(new Error('CEP Node runtime is disabled.'));
            return;
        }
        const payload = JSON.stringify(body || {});
        const request = http.request(
            {
                hostname: '127.0.0.1',
                port: 8080,
                path: pathname,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload),
                },
            },
            (response) => {
                let raw = '';
                response.on('data', (chunk) => {
                    raw += chunk.toString();
                });
                response.on('end', () => {
                    let parsed;
                    try {
                        parsed = JSON.parse(raw);
                    } catch (error) {
                        reject(new Error(`Failed to parse bridge response: ${error.toString()}`));
                        return;
                    }
                    if (response.statusCode && response.statusCode >= 400) {
                        reject(new Error(parsed.message || `Bridge error (${response.statusCode})`));
                        return;
                    }
                    if (parsed.status !== 'success') {
                        reject(new Error(parsed.message || 'Bridge request failed'));
                        return;
                    }
                    resolve(parsed.data);
                });
            },
        );
        request.on('error', reject);
        request.write(payload);
        request.end();
    });
}

function bridgeGet(pathname) {
    return new Promise((resolve, reject) => {
        if (!nodeReady) {
            reject(new Error('CEP Node runtime is disabled.'));
            return;
        }
        const request = http.request(
            {
                hostname: '127.0.0.1',
                port: 8080,
                path: pathname,
                method: 'GET',
            },
            (response) => {
                let raw = '';
                response.on('data', (chunk) => {
                    raw += chunk.toString();
                });
                response.on('end', () => {
                    let parsed;
                    try {
                        parsed = JSON.parse(raw);
                    } catch (error) {
                        reject(new Error(`Failed to parse bridge response: ${error.toString()}`));
                        return;
                    }
                    if (response.statusCode && response.statusCode >= 400) {
                        reject(new Error(parsed.message || `Bridge error (${response.statusCode})`));
                        return;
                    }
                    if (parsed.status !== 'success') {
                        reject(new Error(parsed.message || 'Bridge request failed'));
                        return;
                    }
                    resolve(parsed.data);
                });
            },
        );
        request.on('error', reject);
        request.end();
    });
}

function syncPanelSettingsToBridge(settings) {
    return bridgeRequest('/agent/settings', settings);
}

function renderOperations() {
    const container = document.getElementById('ops-list');
    if (!container) return;
    container.innerHTML = '';
    for (let i = 0; i < panelState.operations.length; i += 1) {
        const op = panelState.operations[i];
        const item = document.createElement('div');
        item.className = 'op-item';
        item.dataset.opIndex = String(i);

        const header = document.createElement('div');
        header.className = 'op-header';

        const left = document.createElement('div');
        left.className = 'row';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = op.selected !== false;
        checkbox.addEventListener('change', () => {
            op.selected = checkbox.checked;
        });
        const title = document.createElement('span');
        title.textContent = `${op.command} (${op.scope})`;
        left.appendChild(checkbox);
        left.appendChild(title);

        const badges = document.createElement('div');
        badges.className = 'badges';
        const riskBadge = document.createElement('span');
        riskBadge.className = `badge ${op.risk || 'medium'}`;
        riskBadge.textContent = `risk: ${op.risk || 'medium'}`;
        const approvalBadge = document.createElement('span');
        approvalBadge.className = 'badge';
        approvalBadge.textContent = op.requiresApproval ? 'approval required' : 'auto-apply eligible';
        badges.appendChild(riskBadge);
        badges.appendChild(approvalBadge);

        header.appendChild(left);
        header.appendChild(badges);

        const payloadPre = document.createElement('pre');
        payloadPre.textContent = JSON.stringify(op.payload || {}, null, 2);

        item.appendChild(header);
        item.appendChild(payloadPre);
        container.appendChild(item);
    }
}

function getSelectedOperations() {
    const selected = [];
    for (let i = 0; i < panelState.operations.length; i += 1) {
        const op = panelState.operations[i];
        if (op.selected !== false) {
            selected.push(op);
        }
    }
    return selected;
}

async function runOperations(dryRun) {
    const selected = getSelectedOperations();
    if (selected.length === 0) {
        setResultsText('No operations selected.');
        return;
    }
    const settings = collectPanelSettings();
    const outputLines = [];
    for (let i = 0; i < selected.length; i += 1) {
        const op = selected[i];
        outputLines.push(`[${i + 1}/${selected.length}] ${op.command} ...`);
        setResultsText(outputLines.join('\n'));
        try {
            const result = await bridgeRequest('/agent/execute', {
                envelope: {
                    id: op.id,
                    command: op.command,
                    scope: op.scope,
                    payload: op.payload,
                    risk: op.risk,
                    requiresApproval: op.requiresApproval,
                },
                dryRun,
                approved: dryRun ? false : true,
                riskMode: settings.riskMode,
                approvalOverride: settings.approvalOverride,
            });
            outputLines.push(JSON.stringify(result, null, 2));
        } catch (error) {
            outputLines.push(`ERROR: ${error.toString()}`);
        }
        outputLines.push('');
        setResultsText(outputLines.join('\n'));
    }
}

async function generatePlanFromPrompt() {
    const settings = collectPanelSettings();
    const codex = collectCodexSettings();
    const promptEl = document.getElementById('prompt');
    const prompt = promptEl ? promptEl.value : '';
    if (!prompt || prompt.trim().length === 0) {
        setResultsText('Prompt is empty.');
        return;
    }
    persistCodexSettings(codex);
    setResultsText('Generating plan...');
    try {
        const data = await bridgeRequest('/agent/generate-plan', {
            prompt,
            model: codex.model,
            scope: settings.scope,
        });
        panelState.operations = [];
        for (let i = 0; i < data.operations.length; i += 1) {
            panelState.operations.push({
                ...data.operations[i],
                selected: true,
            });
        }
        setPlanSummary(data.summary || 'Generated operation plan.');
        renderOperations();
        const rejectedCount = data.rejectedOperations ? data.rejectedOperations.length : 0;
        setResultsText(`Generated ${panelState.operations.length} operation(s). Rejected: ${rejectedCount}.`);
        log(`Generated plan with ${panelState.operations.length} operation(s).`);
    } catch (error) {
        setResultsText(`Plan generation failed: ${error.toString()}`);
    }
}

async function refreshCodexStatus() {
    setCodexStatus('Checking...');
    try {
        const data = await bridgeGet('/agent/codex-status');
        setCodexStatus(data.statusText || 'Unknown');
    } catch (error) {
        setCodexStatus(`Not ready (${error.toString()})`);
    }
}

async function refreshScan() {
    const settings = collectPanelSettings();
    setResultsText('Refreshing project snapshot...');
    try {
        const snapshot = await bridgeRequest('/agent/project-scan', {
            scope: settings.scope,
            includeExpressions: true,
        });
        const compCount = Array.isArray(snapshot.comps) ? snapshot.comps.length : 0;
        const errorCount = Array.isArray(snapshot.expressionErrors) ? snapshot.expressionErrors.length : 0;
        setResultsText(`Snapshot refreshed. comps=${compCount}, expressionErrors=${errorCount}`);
    } catch (error) {
        setResultsText(`Snapshot refresh failed: ${error.toString()}`);
    }
}

function initAgentControls() {
    const saveButton = document.getElementById('save-agent-settings');
    const settings = loadPanelSettings();
    const codex = loadCodexSettings();
    applyPanelSettings(settings);
    applyCodexSettings(codex);

    if (saveButton) {
        saveButton.addEventListener('click', async () => {
            const nextSettings = collectPanelSettings();
            persistPanelSettings(nextSettings);
            try {
                await syncPanelSettingsToBridge(nextSettings);
                log(`Agent settings synced (${nextSettings.riskMode} / ${nextSettings.scope} / ${nextSettings.approvalOverride}).`);
            } catch (error) {
                log(`Failed to sync agent settings: ${error.toString()}`);
            }
        });
    }

    const generatePlanButton = document.getElementById('generate-plan');
    if (generatePlanButton) {
        generatePlanButton.addEventListener('click', () => {
            generatePlanFromPrompt();
        });
    }
    const refreshScanButton = document.getElementById('refresh-scan');
    if (refreshScanButton) {
        refreshScanButton.addEventListener('click', () => {
            refreshScan();
        });
    }
    const previewButton = document.getElementById('preview-ops');
    if (previewButton) {
        previewButton.addEventListener('click', () => runOperations(true));
    }
    const applyButton = document.getElementById('apply-ops');
    if (applyButton) {
        applyButton.addEventListener('click', () => runOperations(false));
    }
    const selectAllButton = document.getElementById('select-all-ops');
    if (selectAllButton) {
        selectAllButton.addEventListener('click', () => {
            for (let i = 0; i < panelState.operations.length; i += 1) {
                panelState.operations[i].selected = true;
            }
            renderOperations();
        });
    }
    const clearAllButton = document.getElementById('clear-all-ops');
    if (clearAllButton) {
        clearAllButton.addEventListener('click', () => {
            for (let i = 0; i < panelState.operations.length; i += 1) {
                panelState.operations[i].selected = false;
            }
            renderOperations();
        });
    }
    const codexStatusButton = document.getElementById('check-codex-login');
    if (codexStatusButton) {
        codexStatusButton.addEventListener('click', () => {
            refreshCodexStatus();
        });
    }
}

startBridgeServer();
initAgentControls();
syncPanelSettingsToBridge(loadPanelSettings()).catch((error) => {
    log(`Initial settings sync failed: ${error.toString()}`);
});
refreshCodexStatus();
