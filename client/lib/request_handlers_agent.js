const AGENT_COMMANDS = {
    'project.scan': { risk: 'low', write: false },
    'project.find': { risk: 'low', write: false },
    'expression.set': { risk: 'medium', write: true },
    'expression.fix': { risk: 'medium', write: true },
    'rig.create2D': { risk: 'medium', write: true },
    'layers.batchRename': { risk: 'low', write: true },
    'comp.precomp': { risk: 'medium', write: true },
    'render.setupQueue': { risk: 'high', write: true },
};

const DEFAULT_AGENT_SETTINGS = {
    riskMode: 'Balanced',
    scope: 'ActiveComp',
    approvalOverride: 'Default',
    bulkThreshold: 25,
};

const agentSettings = {
    riskMode: DEFAULT_AGENT_SETTINGS.riskMode,
    scope: DEFAULT_AGENT_SETTINGS.scope,
    approvalOverride: DEFAULT_AGENT_SETTINGS.approvalOverride,
    bulkThreshold: DEFAULT_AGENT_SETTINGS.bulkThreshold,
};

function parseAgentPayload(rawBody) {
    if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
        return null;
    }
    return rawBody;
}

function isAllowedScope(scope) {
    return scope === 'Selection' || scope === 'ActiveComp' || scope === 'Project';
}

function isAllowedRiskMode(riskMode) {
    return riskMode === 'Safe' || riskMode === 'Balanced' || riskMode === 'Fast';
}

function isAllowedApprovalOverride(value) {
    return value === 'Default' || value === 'AskThisTime' || value === 'AutoApplyThisTime';
}

function inferRisk(commandName, explicitRisk) {
    if (explicitRisk && (explicitRisk === 'low' || explicitRisk === 'medium' || explicitRisk === 'high')) {
        return explicitRisk;
    }
    const commandSpec = AGENT_COMMANDS[commandName];
    if (!commandSpec) {
        return 'high';
    }
    return commandSpec.risk;
}

function estimateBulkCount(payload) {
    if (!payload || typeof payload !== 'object') {
        return 1;
    }
    if (Array.isArray(payload.layerIds)) {
        return payload.layerIds.length;
    }
    if (Array.isArray(payload.targetLayers)) {
        return payload.targetLayers.length;
    }
    if (Array.isArray(payload.targets)) {
        return payload.targets.length;
    }
    return 1;
}

function computeRequiresApproval(riskMode, riskLevel, isWrite, approvalOverride, bulkCount) {
    if (!isWrite) return false;
    if (approvalOverride === 'AskThisTime') return true;
    if (approvalOverride === 'AutoApplyThisTime') return false;
    if (bulkCount > agentSettings.bulkThreshold) return true;
    if (riskMode === 'Safe') return true;
    if (riskMode === 'Balanced') return riskLevel !== 'low';
    if (riskMode === 'Fast') return riskLevel === 'high';
    return true;
}

function normalizeCommandEnvelope(rawEnvelope) {
    const envelope = parseAgentPayload(rawEnvelope);
    if (!envelope) {
        return { ok: false, error: 'envelope must be an object' };
    }
    const command = envelope.command;
    if (!command || typeof command !== 'string') {
        return { ok: false, error: 'envelope.command is required and must be a string' };
    }
    const commandSpec = AGENT_COMMANDS[command];
    if (!commandSpec) {
        return { ok: false, error: `Unsupported command: ${command}` };
    }
    const payload = envelope.payload === undefined ? {} : envelope.payload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return { ok: false, error: 'envelope.payload must be an object when provided' };
    }
    const scope = envelope.scope || agentSettings.scope;
    if (!isAllowedScope(scope)) {
        return { ok: false, error: 'scope must be one of Selection, ActiveComp, Project' };
    }
    const operationId = envelope.id && typeof envelope.id === 'string'
        ? envelope.id
        : `op_${Date.now()}`;
    const risk = inferRisk(command, envelope.risk);
    const bulkCount = estimateBulkCount(payload);
    return {
        ok: true,
        value: {
            id: operationId,
            command,
            payload,
            scope,
            risk,
            isWrite: commandSpec.write,
            bulkCount,
            explicitRequiresApproval: envelope.requiresApproval,
        },
    };
}

function evalAgentHostFunction(functionName, argsArray, callback) {
    const serializedArgs = [];
    for (let i = 0; i < argsArray.length; i += 1) {
        serializedArgs.push(toExtendScriptStringLiteral(argsArray[i]));
    }
    const script = `${functionName}(${serializedArgs.join(', ')})`;
    evalHostScript(script, callback);
}

function evaluateHostCommand(commandEnvelope, dryRun, callback) {
    evalAgentHostFunction(
        'runAgentCommand',
        [
            JSON.stringify(commandEnvelope),
            JSON.stringify({ dryRun }),
        ],
        callback,
    );
}

function buildOperationResult(base, hostPayload, applied, requiresApproval, auditRecordId, dryRun) {
    const changedEntities = hostPayload && Array.isArray(hostPayload.changedEntities)
        ? hostPayload.changedEntities
        : [];
    const warnings = hostPayload && Array.isArray(hostPayload.warnings)
        ? hostPayload.warnings
        : [];
    const details = hostPayload && hostPayload.details && typeof hostPayload.details === 'object'
        ? hostPayload.details
        : {};
    return {
        status: 'success',
        operationId: base.id,
        command: base.command,
        risk: base.risk,
        requiresApproval,
        applied,
        changedEntities,
        warnings,
        undoGroupId: dryRun ? null : (hostPayload && hostPayload.undoGroupId) || null,
        auditRecordId: auditRecordId || null,
        details,
    };
}

function handleGetAgentSettings(res) {
    sendJson(res, 200, { status: 'success', data: agentSettings });
}

function handleSetAgentSettings(req, res) {
    readJsonBody(req, res, (body) => {
        const payload = parseAgentPayload(body);
        if (!payload) {
            sendBadRequest(res, 'Body must be an object');
            return;
        }
        if (payload.riskMode !== undefined) {
            if (!isAllowedRiskMode(payload.riskMode)) {
                sendBadRequest(res, 'riskMode must be Safe, Balanced, or Fast');
                return;
            }
            agentSettings.riskMode = payload.riskMode;
        }
        if (payload.scope !== undefined) {
            if (!isAllowedScope(payload.scope)) {
                sendBadRequest(res, 'scope must be Selection, ActiveComp, or Project');
                return;
            }
            agentSettings.scope = payload.scope;
        }
        if (payload.approvalOverride !== undefined) {
            if (!isAllowedApprovalOverride(payload.approvalOverride)) {
                sendBadRequest(res, 'approvalOverride must be Default, AskThisTime, or AutoApplyThisTime');
                return;
            }
            agentSettings.approvalOverride = payload.approvalOverride;
        }
        sendJson(res, 200, { status: 'success', data: agentSettings });
    });
}

function handleProjectScan(req, res) {
    readJsonBody(req, res, (body) => {
        const payload = parseAgentPayload(body) || {};
        const scope = payload.scope || agentSettings.scope;
        if (!isAllowedScope(scope)) {
            sendBadRequest(res, 'scope must be Selection, ActiveComp, or Project');
            return;
        }
        const includeExpressions = payload.includeExpressions !== false;
        evalAgentHostFunction(
            'getProjectSnapshot',
            [JSON.stringify({ scope, includeExpressions })],
            (result) => {
                try {
                    const parsedResult = parseBridgeResult(result);
                    sendJson(res, 200, { status: 'success', data: parsedResult });
                } catch (error) {
                    sendBridgeParseError(res, result, error);
                }
            },
        );
    });
}

function handleProjectFind(req, res) {
    readJsonBody(req, res, (body) => {
        const payload = parseAgentPayload(body) || {};
        const scope = payload.scope || agentSettings.scope;
        if (!isAllowedScope(scope)) {
            sendBadRequest(res, 'scope must be Selection, ActiveComp, or Project');
            return;
        }
        if (!payload.query || typeof payload.query !== 'string') {
            sendBadRequest(res, 'query is required and must be a string');
            return;
        }
        evalAgentHostFunction(
            'findInProject',
            [JSON.stringify({
                query: payload.query,
                scope,
                types: Array.isArray(payload.types) ? payload.types : [],
                regex: payload.regex === true,
            })],
            (result) => {
                try {
                    const parsedResult = parseBridgeResult(result);
                    sendJson(res, 200, { status: 'success', data: parsedResult });
                } catch (error) {
                    sendBridgeParseError(res, result, error);
                }
            },
        );
    });
}

function handleExecuteAgentCommand(req, res) {
    readJsonBody(req, res, (body) => {
        const payload = parseAgentPayload(body);
        if (!payload) {
            sendBadRequest(res, 'Body must be an object');
            return;
        }
        const normalized = normalizeCommandEnvelope(payload.envelope);
        if (!normalized.ok) {
            sendBadRequest(res, normalized.error);
            return;
        }
        const envelope = normalized.value;
        const dryRun = payload.dryRun === true;
        const approved = payload.approved === true;
        const riskMode = isAllowedRiskMode(payload.riskMode) ? payload.riskMode : agentSettings.riskMode;
        const approvalOverride = isAllowedApprovalOverride(payload.approvalOverride)
            ? payload.approvalOverride
            : agentSettings.approvalOverride;
        const requiresApproval = envelope.explicitRequiresApproval === true
            ? true
            : computeRequiresApproval(
                riskMode,
                envelope.risk,
                envelope.isWrite,
                approvalOverride,
                envelope.bulkCount,
            );

        if (requiresApproval && !approved && !dryRun) {
            evaluateHostCommand(envelope, true, (previewResult) => {
                try {
                    const parsedPreview = parseBridgeResult(previewResult);
                    const resultPayload = buildOperationResult(
                        envelope,
                        parsedPreview,
                        false,
                        true,
                        null,
                        true,
                    );
                    resultPayload.status = 'approval_required';
                    sendJson(res, 200, { status: 'success', data: resultPayload });
                } catch (error) {
                    sendBridgeParseError(res, previewResult, error);
                }
            });
            return;
        }

        evaluateHostCommand(envelope, dryRun, (executeResult) => {
            try {
                const parsed = parseBridgeResult(executeResult);
                if (parsed && parsed.status === 'error') {
                    sendJson(res, 500, { status: 'error', message: parsed.message || 'Operation failed', details: parsed });
                    return;
                }
                const auditRecordId = writeAuditRecord({
                    operationId: envelope.id,
                    command: envelope.command,
                    scope: envelope.scope,
                    risk: envelope.risk,
                    riskMode,
                    approved,
                    dryRun,
                    timestamp: new Date().toISOString(),
                    result: parsed,
                });
                const resultPayload = buildOperationResult(
                    envelope,
                    parsed,
                    !dryRun,
                    requiresApproval,
                    auditRecordId,
                    dryRun,
                );
                sendJson(res, 200, { status: 'success', data: resultPayload });
            } catch (error) {
                sendBridgeParseError(res, executeResult, error);
            }
        });
    });
}

const CODEX_PLAN_SCHEMA = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    additionalProperties: false,
    required: ['summary', 'operations'],
    properties: {
        summary: { type: 'string' },
        operations: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['command', 'scope', 'payload'],
                properties: {
                    id: { type: 'string' },
                    command: {
                        type: 'string',
                        enum: [
                            'project.scan',
                            'project.find',
                            'expression.set',
                            'expression.fix',
                            'rig.create2D',
                            'layers.batchRename',
                            'comp.precomp',
                            'render.setupQueue',
                        ],
                    },
                    scope: {
                        type: 'string',
                        enum: ['Selection', 'ActiveComp', 'Project'],
                    },
                    risk: {
                        type: 'string',
                        enum: ['low', 'medium', 'high'],
                    },
                    requiresApproval: { type: 'boolean' },
                    payload: { type: 'object' },
                },
            },
        },
    },
};

function parseJsonFromModelText(rawText) {
    if (!rawText || typeof rawText !== 'string') return null;
    const trimmed = rawText.trim();
    try {
        return JSON.parse(trimmed);
    } catch (error) {}
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced && fenced[1]) {
        try {
            return JSON.parse(fenced[1].trim());
        } catch (error) {}
    }
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
        try {
            return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
        } catch (error) {}
    }
    return null;
}

function buildCodexPlanningPrompt(userPrompt, snapshot, settings) {
    const compactSnapshot = JSON.stringify(snapshot);
    const snapshotMaxChars = 120000;
    const snapshotText = compactSnapshot.length > snapshotMaxChars
        ? compactSnapshot.slice(0, snapshotMaxChars) + '...'
        : compactSnapshot;

    return [
        'You are an After Effects agent planner.',
        'Output must be valid JSON matching the provided schema.',
        'Allowed command values only:',
        'project.scan, project.find, expression.set, expression.fix, rig.create2D, layers.batchRename, comp.precomp, render.setupQueue',
        'Do not include markdown, comments, or unsupported commands.',
        `Risk mode: ${settings.riskMode}, scope default: ${settings.scope}.`,
        'User request:',
        userPrompt,
        'Project snapshot JSON:',
        snapshotText,
    ].join('\n');
}

function runCodexPlanner(promptText, model, callback) {
    if (!childProcess || !fs || !path || !os) {
        callback(new Error('Node child process runtime is unavailable.'));
        return;
    }
    const nonce = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const schemaPath = path.join(os.tmpdir(), `ae_codex_plan_schema_${nonce}.json`);
    const outputPath = path.join(os.tmpdir(), `ae_codex_plan_output_${nonce}.txt`);
    try {
        fs.writeFileSync(schemaPath, JSON.stringify(CODEX_PLAN_SCHEMA, null, 2), 'utf8');
    } catch (error) {
        callback(new Error(`Failed to write temp schema file: ${error.toString()}`));
        return;
    }

    const args = [
        'exec',
        '-',
        '--skip-git-repo-check',
        '--sandbox',
        'read-only',
        '--output-schema',
        schemaPath,
        '--output-last-message',
        outputPath,
        '--cd',
        extensionRoot,
    ];
    if (model && typeof model === 'string' && model.trim().length > 0) {
        args.push('--model', model.trim());
    }

    let stderrText = '';
    const proc = childProcess.spawn('codex', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
    });
    proc.stderr.on('data', (chunk) => {
        stderrText += chunk.toString();
    });
    proc.on('error', (error) => {
        callback(new Error(`Failed to start codex exec: ${error.toString()}`));
    });
    proc.on('close', (code) => {
        let cleanupError = null;
        try {
            if (fs.existsSync(schemaPath)) fs.unlinkSync(schemaPath);
        } catch (error) {
            cleanupError = error;
        }
        if (code !== 0) {
            callback(new Error(`codex exec failed (${code}). ${stderrText}`));
            return;
        }
        let text;
        try {
            text = fs.readFileSync(outputPath, 'utf8');
            fs.unlinkSync(outputPath);
        } catch (error) {
            callback(new Error(`Failed to read codex output: ${error.toString()}`));
            return;
        }
        if (cleanupError) {
            log(`Warning: failed to cleanup schema temp file: ${cleanupError.toString()}`);
        }
        const planObject = parseJsonFromModelText(text);
        if (!planObject) {
            callback(new Error('Codex output did not contain valid JSON.'));
            return;
        }
        callback(null, planObject);
    });
    proc.stdin.write(promptText);
    proc.stdin.end();
}

function getCodexLoginStatus(callback) {
    if (!childProcess) {
        callback(new Error('Node child process runtime is unavailable.'));
        return;
    }
    childProcess.execFile('codex', ['login', 'status'], (error, stdout, stderr) => {
        if (error) {
            callback(new Error(stderr || error.toString()));
            return;
        }
        callback(null, String(stdout || '').trim());
    });
}

function toPublicEnvelope(normalizedEnvelope, settings) {
    const requiresApproval = normalizedEnvelope.explicitRequiresApproval === true
        ? true
        : computeRequiresApproval(
            settings.riskMode,
            normalizedEnvelope.risk,
            normalizedEnvelope.isWrite,
            settings.approvalOverride,
            normalizedEnvelope.bulkCount,
        );
    return {
        id: normalizedEnvelope.id,
        command: normalizedEnvelope.command,
        scope: normalizedEnvelope.scope,
        risk: normalizedEnvelope.risk,
        requiresApproval,
        payload: normalizedEnvelope.payload,
    };
}

function handleGeneratePlan(req, res) {
    readJsonBody(req, res, (body) => {
        const payload = parseAgentPayload(body);
        if (!payload) {
            sendBadRequest(res, 'Body must be an object');
            return;
        }
        if (!payload.prompt || typeof payload.prompt !== 'string') {
            sendBadRequest(res, 'prompt is required and must be a string');
            return;
        }
        const model = payload.model && typeof payload.model === 'string'
            ? payload.model
            : 'gpt-5-mini';
        const scope = payload.scope && isAllowedScope(payload.scope)
            ? payload.scope
            : agentSettings.scope;
        evalAgentHostFunction(
            'getProjectSnapshot',
            [JSON.stringify({ scope, includeExpressions: true })],
            (snapshotResult) => {
                let snapshot;
                try {
                    snapshot = parseBridgeResult(snapshotResult);
                } catch (error) {
                    sendBridgeParseError(res, snapshotResult, error);
                    return;
                }
                const promptText = buildCodexPlanningPrompt(payload.prompt, snapshot, agentSettings);
                runCodexPlanner(promptText, model, (error, modelPlan) => {
                    if (error) {
                        sendJson(res, 500, { status: 'error', message: error.toString() });
                        return;
                    }
                    const operationsRaw = modelPlan && Array.isArray(modelPlan.operations)
                        ? modelPlan.operations
                        : [];
                    const operations = [];
                    const rejectedOperations = [];
                    for (let i = 0; i < operationsRaw.length; i += 1) {
                        const candidate = operationsRaw[i];
                        const withDefaults = {
                            id: candidate && candidate.id ? candidate.id : `op_gen_${Date.now()}_${i + 1}`,
                            command: candidate ? candidate.command : null,
                            scope: candidate && candidate.scope ? candidate.scope : scope,
                            payload: candidate && candidate.payload && typeof candidate.payload === 'object'
                                ? candidate.payload
                                : {},
                            risk: candidate ? candidate.risk : undefined,
                            requiresApproval: candidate ? candidate.requiresApproval : undefined,
                        };
                        const normalized = normalizeCommandEnvelope(withDefaults);
                        if (!normalized.ok) {
                            rejectedOperations.push({
                                index: i,
                                reason: normalized.error,
                                raw: candidate,
                            });
                            continue;
                        }
                        operations.push(toPublicEnvelope(normalized.value, agentSettings));
                    }
                    sendJson(res, 200, {
                        status: 'success',
                        data: {
                            model,
                            summary: modelPlan && typeof modelPlan.summary === 'string'
                                ? modelPlan.summary
                                : 'Generated operation plan.',
                            operations,
                            rejectedOperations,
                        },
                    });
                });
            },
        );
    });
}

function handleCodexStatus(res) {
    getCodexLoginStatus((error, statusText) => {
        if (error) {
            sendJson(res, 500, { status: 'error', message: error.toString() });
            return;
        }
        sendJson(res, 200, { status: 'success', data: { statusText } });
    });
}

function routeAgentRequest(pathname, method, req, res) {
    if (pathname === '/agent/settings' && method === 'GET') {
        handleGetAgentSettings(res);
        return true;
    }
    if (pathname === '/agent/settings' && method === 'POST') {
        handleSetAgentSettings(req, res);
        return true;
    }
    if (pathname === '/agent/project-scan' && method === 'POST') {
        handleProjectScan(req, res);
        return true;
    }
    if (pathname === '/agent/project-find' && method === 'POST') {
        handleProjectFind(req, res);
        return true;
    }
    if (pathname === '/agent/execute' && method === 'POST') {
        handleExecuteAgentCommand(req, res);
        return true;
    }
    if (pathname === '/agent/generate-plan' && method === 'POST') {
        handleGeneratePlan(req, res);
        return true;
    }
    if (pathname === '/agent/codex-status' && method === 'GET') {
        handleCodexStatus(res);
        return true;
    }
    return false;
}
