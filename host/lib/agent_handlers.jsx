function aeGetCompById(compId) {
    if (!app.project) {
        return null;
    }
    var normalized = parseInt(compId, 10);
    if (isNaN(normalized)) {
        return null;
    }
    for (var i = 1; i <= app.project.numItems; i++) {
        var item = app.project.item(i);
        if (item && item instanceof CompItem && item.id === normalized) {
            return item;
        }
    }
    return null;
}

function aeGetCompListForScope(scope, payload) {
    var comps = [];
    if (!app.project) {
        return comps;
    }
    if (scope === "ActiveComp" || scope === "Selection") {
        var active = app.project.activeItem;
        if (active && active instanceof CompItem) {
            comps.push(active);
        }
        return comps;
    }
    if (scope === "Project") {
        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            if (item && item instanceof CompItem) {
                comps.push(item);
            }
        }
        return comps;
    }
    if (payload && payload.compId !== undefined && payload.compId !== null) {
        var byId = aeGetCompById(payload.compId);
        if (byId) {
            comps.push(byId);
        }
    }
    return comps;
}

function aeBuildPropertyPath(prop) {
    var segments = [];
    var current = prop;
    var guard = 0;
    while (current && guard < 100) {
        var parent = null;
        try {
            parent = current.parentProperty;
        } catch (eParent) {
            parent = null;
        }
        if (!parent) {
            break;
        }
        segments.unshift(aeGetPropertyIdentifier(current, null));
        current = parent;
        guard += 1;
    }
    return segments.join(".");
}

function aeCollectExpressionErrorsInComp(comp) {
    var issues = [];
    if (!comp || !(comp instanceof CompItem)) {
        return issues;
    }
    function scan(layer, prop) {
        if (!prop) return;
        if (aeCanTraverseProperty(prop)) {
            for (var i = 1; i <= prop.numProperties; i++) {
                scan(layer, prop.property(i));
            }
            return;
        }
        var canSetExpression = false;
        try {
            canSetExpression = prop.canSetExpression === true;
        } catch (eCanSet) {}
        if (!canSetExpression) return;
        var enabled = false;
        try {
            enabled = prop.expressionEnabled === true;
        } catch (eEnabled) {}
        if (!enabled) return;
        var errorMessage = null;
        try {
            if (typeof prop.expressionError === "string" && prop.expressionError.length > 0) {
                errorMessage = prop.expressionError;
            }
        } catch (eRead) {}
        if (!errorMessage) return;
        issues.push({
            type: "expression-error",
            compId: comp.id,
            compName: comp.name,
            layerId: layer.index,
            layerUid: aeTryGetLayerUid(layer),
            layerName: layer.name,
            propertyPath: aeBuildPropertyPath(prop),
            propertyName: prop.name,
            message: errorMessage
        });
    }
    for (var i = 1; i <= comp.numLayers; i++) {
        var layer = comp.layer(i);
        if (!layer) continue;
        scan(layer, layer);
    }
    return issues;
}

function getProjectSnapshot(optionsJSON) {
    try {
        ensureJSON();
        var options = optionsJSON ? JSON.parse(optionsJSON) : {};
        var scope = options.scope || "ActiveComp";
        var includeExpressions = options.includeExpressions !== false;
        var comps = aeGetCompListForScope(scope, options);
        var snapshot = {
            scope: scope,
            generatedAt: (new Date()).toISOString ? (new Date()).toISOString() : String(new Date()),
            projectItems: [],
            comps: [],
            expressionErrors: []
        };
        if (!app.project) {
            return encodePayload(snapshot);
        }
        for (var itemIndex = 1; itemIndex <= app.project.numItems; itemIndex++) {
            var item = app.project.item(itemIndex);
            if (!item) continue;
            snapshot.projectItems.push({
                id: item.id,
                name: item.name,
                type: item instanceof CompItem ? "comp" : "item"
            });
        }
        for (var c = 0; c < comps.length; c++) {
            var comp = comps[c];
            var compPayload = {
                id: comp.id,
                name: comp.name,
                width: comp.width,
                height: comp.height,
                duration: comp.duration,
                frameRate: comp.frameRate,
                numLayers: comp.numLayers,
                layers: []
            };
            for (var l = 1; l <= comp.numLayers; l++) {
                var layer = comp.layer(l);
                if (!layer) continue;
                if (scope === "Selection") {
                    var isSelected = false;
                    try {
                        isSelected = layer.selected === true;
                    } catch (eSel) {}
                    if (!isSelected) {
                        continue;
                    }
                }
                compPayload.layers.push({
                    id: layer.index,
                    layerUid: aeTryGetLayerUid(layer),
                    name: layer.name,
                    type: getLayerTypeName(layer),
                    is3D: layer.threeDLayer === true,
                    enabled: layer.enabled === true
                });
            }
            snapshot.comps.push(compPayload);
            if (includeExpressions) {
                var issues = aeCollectExpressionErrorsInComp(comp);
                for (var e = 0; e < issues.length; e++) {
                    snapshot.expressionErrors.push(issues[e]);
                }
            }
        }
        return encodePayload(snapshot);
    } catch (error) {
        return encodePayload({ status: "error", message: error.toString() });
    }
}

function findInProject(optionsJSON) {
    try {
        ensureJSON();
        var options = optionsJSON ? JSON.parse(optionsJSON) : {};
        var query = options.query || "";
        if (!query || String(query).length === 0) {
            return encodePayload({ status: "error", message: "query is required." });
        }
        var scope = options.scope || "ActiveComp";
        var regexMode = options.regex === true;
        var types = options.types instanceof Array ? options.types : [];
        var snapshot = JSON.parse(decodeURIComponent(String(getProjectSnapshot(JSON.stringify({
            scope: scope,
            includeExpressions: true
        })).replace(/^__ENC__/, ""))));

        var matcher = null;
        var queryString = String(query);
        if (regexMode) {
            matcher = new RegExp(queryString, "i");
        }
        function matches(text) {
            var str = String(text || "");
            if (regexMode) {
                return matcher.test(str);
            }
            return str.toLowerCase().indexOf(queryString.toLowerCase()) >= 0;
        }
        function typeAllowed(typeName) {
            if (!(types instanceof Array) || types.length === 0) {
                return true;
            }
            for (var i = 0; i < types.length; i++) {
                if (String(types[i]) === typeName) return true;
            }
            return false;
        }

        var matchesOut = [];
        for (var iItem = 0; iItem < snapshot.projectItems.length; iItem++) {
            var item = snapshot.projectItems[iItem];
            if (typeAllowed("project-item") && matches(item.name)) {
                matchesOut.push({ type: "project-item", item: item });
            }
        }
        for (var iComp = 0; iComp < snapshot.comps.length; iComp++) {
            var comp = snapshot.comps[iComp];
            if (typeAllowed("comp") && matches(comp.name)) {
                matchesOut.push({ type: "comp", item: { id: comp.id, name: comp.name } });
            }
            for (var iLayer = 0; iLayer < comp.layers.length; iLayer++) {
                var layer = comp.layers[iLayer];
                if (typeAllowed("layer") && (matches(layer.name) || matches(layer.type))) {
                    matchesOut.push({
                        type: "layer",
                        item: {
                            compId: comp.id,
                            compName: comp.name,
                            layerId: layer.id,
                            layerName: layer.name,
                            layerType: layer.type
                        }
                    });
                }
            }
        }
        for (var iErr = 0; iErr < snapshot.expressionErrors.length; iErr++) {
            var issue = snapshot.expressionErrors[iErr];
            if (!typeAllowed("expression-error")) continue;
            if (matches(issue.layerName) || matches(issue.message) || matches(issue.propertyPath)) {
                matchesOut.push({ type: "expression-error", item: issue });
            }
        }
        return encodePayload({
            scope: scope,
            query: queryString,
            count: matchesOut.length,
            matches: matchesOut
        });
    } catch (error) {
        return encodePayload({ status: "error", message: error.toString() });
    }
}

function aeResolveCompForCommand(payload, scope) {
    if (!app.project) {
        return { error: "Project is not open.", comp: null };
    }
    if (payload && payload.compId !== undefined && payload.compId !== null) {
        var byId = aeGetCompById(payload.compId);
        if (byId) return { error: null, comp: byId };
        return { error: "Composition not found for compId=" + payload.compId, comp: null };
    }
    if (scope === "Project" && payload && payload.compName) {
        var found = findCompByIdOrName(null, payload.compName);
        if (found) return { error: null, comp: found };
    }
    var activeComp = app.project.activeItem;
    if (!activeComp || !(activeComp instanceof CompItem)) {
        return { error: "Active composition not found.", comp: null };
    }
    return { error: null, comp: activeComp };
}

function aeCommandExpressionSet(payload, scope, dryRun, changedEntities) {
    if (!payload || !payload.target || !payload.target.propertyPath) {
        return { status: "error", message: "expression.set requires payload.target.propertyPath" };
    }
    var target = payload.target;
    var compResolved = aeResolveCompForCommand({ compId: target.compId }, scope);
    if (compResolved.error) return { status: "error", message: compResolved.error };
    var comp = compResolved.comp;
    var layerResolved = aeResolveLayer(comp, target.layerId, target.layerName);
    if (layerResolved.error) return { status: "error", message: layerResolved.error };
    var layer = layerResolved.layer;
    var prop = resolveProperty(layer, target.propertyPath);
    if (!prop) {
        return { status: "error", message: "Property not found: " + target.propertyPath };
    }
    if (!prop.canSetExpression) {
        return { status: "error", message: "Property cannot set expression: " + target.propertyPath };
    }
    changedEntities.push({
        type: "expression",
        compId: comp.id,
        compName: comp.name,
        layerId: layer.index,
        layerName: layer.name,
        propertyPath: target.propertyPath
    });
    if (!dryRun) {
        prop.expression = String(payload.expression || "");
    }
    return { status: "success" };
}

function aeCommandExpressionFix(payload, scope, dryRun, changedEntities, warnings) {
    var comps = aeGetCompListForScope(scope, payload);
    if (comps.length === 0) {
        return { status: "error", message: "No comps found for scope." };
    }
    var replacements = payload && payload.replacements instanceof Array ? payload.replacements : [];
    var disableOnError = !(payload && payload.disableOnError === false);
    for (var c = 0; c < comps.length; c++) {
        var comp = comps[c];
        var errors = aeCollectExpressionErrorsInComp(comp);
        for (var i = 0; i < errors.length; i++) {
            var issue = errors[i];
            var layer = comp.layer(issue.layerId);
            if (!layer) continue;
            var prop = resolveProperty(layer, issue.propertyPath);
            if (!prop) continue;
            var replacement = null;
            for (var r = 0; r < replacements.length; r++) {
                var candidate = replacements[r];
                if (
                    Number(candidate.compId) === Number(issue.compId)
                    && Number(candidate.layerId) === Number(issue.layerId)
                    && String(candidate.propertyPath) === String(issue.propertyPath)
                ) {
                    replacement = candidate;
                    break;
                }
            }
            changedEntities.push({
                type: "expression-fix",
                compId: issue.compId,
                compName: issue.compName,
                layerId: issue.layerId,
                layerName: issue.layerName,
                propertyPath: issue.propertyPath
            });
            if (!dryRun) {
                if (replacement && replacement.expression !== undefined && replacement.expression !== null) {
                    prop.expression = String(replacement.expression);
                } else if (disableOnError) {
                    prop.expression = "";
                } else {
                    warnings.push("Skipped expression issue for " + issue.layerName + " (" + issue.propertyPath + ")");
                }
            }
        }
    }
    return { status: "success" };
}

function aeCommandRigCreate2D(payload, scope, dryRun, changedEntities) {
    var compResolved = aeResolveCompForCommand(payload, scope);
    if (compResolved.error) return { status: "error", message: compResolved.error };
    var comp = compResolved.comp;
    var targets = payload && payload.targetLayers instanceof Array ? payload.targetLayers : [];
    if (targets.length === 0) {
        var selected = comp.selectedLayers;
        if (selected && selected.length > 0) {
            for (var s = 0; s < selected.length; s++) {
                targets.push(selected[s].index);
            }
        }
    }
    if (targets.length === 0) {
        return { status: "error", message: "rig.create2D requires targetLayers or selected layers." };
    }
    var prefix = payload && payload.namingPrefix ? String(payload.namingPrefix) : "RIG";
    for (var i = 0; i < targets.length; i++) {
        var targetLayer = comp.layer(Number(targets[i]));
        if (!targetLayer) continue;
        var controllerName = prefix + "_CTRL_" + targetLayer.name;
        changedEntities.push({
            type: "rig-controller",
            compId: comp.id,
            compName: comp.name,
            targetLayerId: targetLayer.index,
            targetLayerName: targetLayer.name,
            controllerName: controllerName
        });
        if (!dryRun) {
            var controller = comp.layers.addNull();
            controller.name = controllerName;
            controller.label = 9;
            controller.threeDLayer = targetLayer.threeDLayer === true;
            controller.property("ADBE Transform Group").property("ADBE Position").setValue(
                targetLayer.property("ADBE Transform Group").property("ADBE Position").value
            );
            targetLayer.parent = controller;
        }
    }
    return { status: "success" };
}

function aeFormatBatchRename(pattern, compName, index, layerName, layerType) {
    var value = String(pattern || "{comp}_{index}_{layer}");
    value = value.replace(/\{comp\}/g, compName);
    value = value.replace(/\{index\}/g, String(index));
    value = value.replace(/\{layer\}/g, layerName);
    value = value.replace(/\{role\}/g, layerType || "Layer");
    return value;
}

function aeCommandBatchRename(payload, scope, dryRun, changedEntities) {
    var comps = aeGetCompListForScope(scope, payload);
    if (comps.length === 0) {
        return { status: "error", message: "No comps found for scope." };
    }
    var pattern = payload && payload.pattern ? String(payload.pattern) : "{comp}_{index}_{layer}";
    var counter = payload && payload.startIndex ? Number(payload.startIndex) : 1;
    for (var c = 0; c < comps.length; c++) {
        var comp = comps[c];
        for (var i = 1; i <= comp.numLayers; i++) {
            var layer = comp.layer(i);
            if (!layer) continue;
            if (scope === "Selection") {
                var selected = false;
                try {
                    selected = layer.selected === true;
                } catch (eSel) {}
                if (!selected) continue;
            }
            var nextName = aeFormatBatchRename(pattern, comp.name, counter, layer.name, getLayerTypeName(layer));
            changedEntities.push({
                type: "rename",
                compId: comp.id,
                compName: comp.name,
                layerId: layer.index,
                before: layer.name,
                after: nextName
            });
            if (!dryRun) {
                layer.name = nextName;
            }
            counter += 1;
        }
    }
    return { status: "success" };
}

function aeCommandPrecomp(payload, scope, dryRun, changedEntities) {
    var compResolved = aeResolveCompForCommand(payload, scope);
    if (compResolved.error) return { status: "error", message: compResolved.error };
    var comp = compResolved.comp;
    if (!payload || !(payload.layerIds instanceof Array) || payload.layerIds.length === 0) {
        return { status: "error", message: "comp.precomp requires payload.layerIds" };
    }
    var layerIds = [];
    for (var i = 0; i < payload.layerIds.length; i++) {
        layerIds.push(Number(payload.layerIds[i]));
    }
    var precompName = payload.newCompName || payload.name || "Precomp";
    changedEntities.push({
        type: "precompose",
        compId: comp.id,
        compName: comp.name,
        layerIds: layerIds,
        newCompName: precompName
    });
    if (!dryRun) {
        var createdComp = comp.layers.precompose(layerIds, String(precompName), payload.moveAllAttributes === true);
        changedEntities.push({
            type: "precompose-result",
            compId: createdComp.id,
            compName: createdComp.name
        });
    }
    return { status: "success" };
}

function aeCommandRenderSetup(payload, scope, dryRun, changedEntities) {
    if (!app.project || !app.project.renderQueue) {
        return { status: "error", message: "Render Queue is unavailable." };
    }
    var compResolved = aeResolveCompForCommand(payload, scope);
    if (compResolved.error) return { status: "error", message: compResolved.error };
    var comp = compResolved.comp;
    var outputFolder = payload && payload.outputFolder ? String(payload.outputFolder) : null;
    var outputTemplate = payload && (payload.outputModuleTemplate || payload.preset) ? String(payload.outputModuleTemplate || payload.preset) : null;
    changedEntities.push({
        type: "render-queue",
        compId: comp.id,
        compName: comp.name,
        outputFolder: outputFolder,
        outputModuleTemplate: outputTemplate
    });
    if (!dryRun) {
        var rqItem = app.project.renderQueue.items.add(comp);
        if (payload && payload.renderSettingsTemplate) {
            rqItem.applyTemplate(String(payload.renderSettingsTemplate));
        }
        var outputModule = rqItem.outputModule(1);
        if (outputTemplate) {
            outputModule.applyTemplate(outputTemplate);
        }
        if (outputFolder) {
            var folder = new Folder(outputFolder);
            if (!folder.exists) {
                folder.create();
            }
            outputModule.file = new File(folder.fsName + "/" + comp.name + ".mov");
        }
        changedEntities.push({
            type: "render-queue-item",
            queueIndex: rqItem.index
        });
    }
    return { status: "success" };
}

function runAgentCommand(commandEnvelopeJSON, optionsJSON) {
    try {
        ensureJSON();
        var envelope = commandEnvelopeJSON ? JSON.parse(commandEnvelopeJSON) : null;
        var options = optionsJSON ? JSON.parse(optionsJSON) : {};
        if (!envelope || !envelope.command) {
            return encodePayload({ status: "error", message: "Invalid command envelope." });
        }
        var command = String(envelope.command);
        var payload = envelope.payload || {};
        var scope = envelope.scope || "ActiveComp";
        var dryRun = options.dryRun === true;
        var changedEntities = [];
        var warnings = [];
        var undoGroupName = String(envelope.id || command);
        var isWriteCommand = (
            command === "expression.set"
            || command === "expression.fix"
            || command === "rig.create2D"
            || command === "layers.batchRename"
            || command === "comp.precomp"
            || command === "render.setupQueue"
        );

        if (!dryRun && isWriteCommand) {
            app.beginUndoGroup("ae-agent:" + undoGroupName);
        }

        var result = null;
        if (command === "project.scan") {
            result = JSON.parse(decodeURIComponent(String(getProjectSnapshot(JSON.stringify({
                scope: scope,
                includeExpressions: payload.includeExpressions !== false
            })).replace(/^__ENC__/, ""))));
            changedEntities.push({ type: "snapshot", scope: scope, compCount: result.comps.length });
        } else if (command === "project.find") {
            result = JSON.parse(decodeURIComponent(String(findInProject(JSON.stringify({
                scope: scope,
                query: payload.query,
                types: payload.types || [],
                regex: payload.regex === true
            })).replace(/^__ENC__/, ""))));
            changedEntities.push({ type: "find", count: result.count || 0 });
        } else if (command === "expression.set") {
            result = aeCommandExpressionSet(payload, scope, dryRun, changedEntities);
        } else if (command === "expression.fix") {
            result = aeCommandExpressionFix(payload, scope, dryRun, changedEntities, warnings);
        } else if (command === "rig.create2D") {
            result = aeCommandRigCreate2D(payload, scope, dryRun, changedEntities);
        } else if (command === "layers.batchRename") {
            result = aeCommandBatchRename(payload, scope, dryRun, changedEntities);
        } else if (command === "comp.precomp") {
            result = aeCommandPrecomp(payload, scope, dryRun, changedEntities);
        } else if (command === "render.setupQueue") {
            result = aeCommandRenderSetup(payload, scope, dryRun, changedEntities);
        } else {
            result = { status: "error", message: "Unsupported command: " + command };
        }

        if (!dryRun && isWriteCommand) {
            app.endUndoGroup();
        }

        if (result && result.status === "error") {
            return encodePayload(result);
        }

        return encodePayload({
            status: "success",
            changedEntities: changedEntities,
            warnings: warnings,
            undoGroupId: (dryRun || !isWriteCommand) ? null : undoGroupName,
            details: result || {}
        });
    } catch (error) {
        try {
            app.endUndoGroup();
        } catch (eUndo) {}
        return encodePayload({ status: "error", message: error.toString() });
    }
}
