function appendLog(source, message) {
    const logTextarea = document.getElementById('log');
    const timestamp = new Date().toLocaleTimeString();
    const prefix = source ? `[${source}] ` : '';
    logTextarea.value = `${timestamp} ${prefix}${message}\n` + logTextarea.value;
}

function log(message) {
    appendLog('Panel', message);
}

function resolveAuditLogPath() {
    if (!nodeReady || !path || !fs) return null;
    try {
        const os = require('os');
        const baseDir = path.join(os.homedir(), 'ae-agent-skills', 'logs');
        if (!fs.existsSync(baseDir)) {
            fs.mkdirSync(baseDir, { recursive: true });
        }
        return path.join(baseDir, 'agent-audit.log');
    } catch (error) {
        appendLog('Audit', `Failed to resolve audit log path: ${error.toString()}`);
        return null;
    }
}

function writeAuditRecord(record) {
    const filePath = resolveAuditLogPath();
    if (!filePath) return null;
    const recordId = `audit_${Date.now()}`;
    const line = JSON.stringify({
        id: recordId,
        ...record,
    });
    try {
        fs.appendFileSync(filePath, `${line}\n`, 'utf8');
    } catch (error) {
        appendLog('Audit', `Failed to append audit record: ${error.toString()}`);
        return null;
    }
    return recordId;
}
