
import * as React from 'react';
import { useMemo, useState } from 'react';
import { Box, Workflow, Search, ChevronDown, ChevronRight, Copy, Check, Download, Activity, AlertTriangle, ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';
import { AIImage, isVideoAsset } from '../../../types';
import { scanImageWorkflow } from '../../../services/metadataParser';
import { updateImageWorkflow, updateImageWorkflowHint } from '../../../services/db/imageRepo';
import {
    commands,
    type ComfyParserDiagnosticsReport,
    type ComfyWorkflowGraphReport
} from '../../../bindings';
import { useSettingsStore } from '../../../stores/settingsStore';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { TooltipButton } from '../../../components/ui/InfoTooltip';
import { MetadataSectionHeader } from './metadata/MetadataSectionHeader';
import {
    buildComfySupportBundle,
    buildDiagnosticsClipboardPayload
} from './comfySupportBundle';
import {
    isWorkflowGraph,
    groupWorkflowNodes,
    indexWorkflowConnections,
    selectWorkflowGraphSource,
    selectWorkflowJsonForActions,
    workflowGraphSourceFromBackend,
    type WorkflowDisplayEdge,
    type WorkflowDisplayNode,
    type WorkflowInputs,
    type WorkflowNodeConnections
} from './workflowGraphUtils';

interface WorkflowInspectorProps {
    image: AIImage;
    onWorkflowLoaded?: (workflowJson: string) => void;
}

const formatDiagnosticLabel = (value: string) =>
    value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());

const formatDiagnosticValue = (value: string | number | null | undefined) =>
    value === null || value === undefined || value === '' ? 'None' : String(value);

const formatResourceFieldLabel = (field: string) => {
    switch (field) {
        case 'loras': return 'LoRAs';
        case 'control_nets': return 'ControlNets';
        case 'ip_adapters': return 'IP-Adapters';
        default: return formatDiagnosticLabel(field);
    }
};

const getDiagnosticLayerBadgeClass = (layer: string | null | undefined) => {
    switch (layer) {
        case 'sampler_traversal':
            return 'border-emerald-300/70 dark:border-emerald-400/30 bg-emerald-50/80 dark:bg-emerald-500/10 text-emerald-900 dark:text-emerald-200';
        case 'sampler_fallback':
            return 'border-orange-300/80 dark:border-orange-400/40 bg-orange-50/90 dark:bg-orange-500/15 text-orange-900 dark:text-orange-100';
        case 'global_scan':
            return 'border-rose-300/70 dark:border-rose-400/30 bg-rose-50/80 dark:bg-rose-500/10 text-rose-900 dark:text-rose-100';
        case 'explicit_node':
            return 'border-sky-300/70 dark:border-sky-400/30 bg-sky-50/80 dark:bg-sky-500/10 text-sky-900 dark:text-sky-100';
        case 'flat_parameters':
            return 'border-violet-300/70 dark:border-violet-400/30 bg-violet-50/80 dark:bg-violet-500/10 text-violet-900 dark:text-violet-100';
        default:
            return 'border-amber-300/70 dark:border-amber-400/20 bg-white/70 dark:bg-black/20 text-amber-950 dark:text-amber-100';
    }
};

const getDiagnosticLayerTitle = (layer: string | null | undefined) => {
    if (layer === 'sampler_fallback') {
        return 'Sampler fallback: found by scanning samplers, weaker than saved-output traversal.';
    }
    if (layer === 'sampler_traversal') {
        return 'Sampler traversal: found by following the saved image output path.';
    }
    if (layer === 'flat_parameters') {
        return 'Flat parameters: embedded saver metadata, stronger than fallback scans but weaker than saved-output traversal.';
    }
    return formatDiagnosticLabel(layer ?? '');
};

const getTraversalIssueTitle = (reason: string) => {
    switch (reason) {
        case 'unresolved_link':
            return 'The workflow declares a connection that could not be resolved.';
        case 'missing_source_node':
            return 'The connected source node is missing from the embedded graph.';
        case 'unsupported_node':
            return 'The selected output path reaches a node this parser cannot resolve for this field.';
        case 'generated_value_unavailable':
            return 'The value is generated at runtime and no literal result is embedded in the image.';
        case 'cycle_detected':
            return 'Traversal stopped after detecting a cycle.';
        case 'depth_limit':
            return 'Traversal stopped at the diagnostic depth limit.';
        default:
            return formatDiagnosticLabel(reason);
    }
};

const workflowNodeElementId = (nodeId: string | number) => `workflow-node-${String(nodeId)}`;

const WorkflowOutputAnchors: React.FC<{
    selectedOutputNodeIds: string[];
    rootSamplerNodeIds: string[];
    outputAmbiguous: boolean;
    nodeById: Map<string, WorkflowDisplayNode>;
    onFocusNode: (nodeId: string) => void;
}> = ({ selectedOutputNodeIds, rootSamplerNodeIds, outputAmbiguous, nodeById, onFocusNode }) => {
    if (selectedOutputNodeIds.length === 0) return null;

    const renderAnchor = (nodeId: string, kind: 'output' | 'root') => {
        const node = nodeById.get(nodeId);
        if (!node) return null;

        const isRoot = kind === 'root';
        const label = isRoot
            ? outputAmbiguous ? 'Root Candidate' : 'Root Sampler'
            : 'Selected Output';
        const Icon = isRoot ? Activity : ArrowDownToLine;

        return (
            <button
                key={`${kind}:${nodeId}`}
                type="button"
                onClick={() => onFocusNode(nodeId)}
                aria-label={`Open ${label.toLowerCase()} node ${node.title} (${nodeId})`}
                title={`Open ${label.toLowerCase()} node ${nodeId}`}
                className="flex min-w-0 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 py-1 text-left text-[10px] transition-colors hover:border-sage-300 hover:bg-sage-50 dark:border-white/10 dark:bg-white/5 dark:hover:border-sage-700 dark:hover:bg-sage-900/20"
            >
                <Icon className={`h-3 w-3 shrink-0 ${isRoot ? 'text-sky-600 dark:text-sky-400' : 'text-sage-600 dark:text-sage-400'}`} />
                <span className="min-w-0">
                    <span className="block font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</span>
                    <span className="block max-w-44 truncate font-mono text-gray-700 dark:text-gray-200" title={`${node.title} / #${nodeId}`}>
                        {node.title} / #{nodeId}
                    </span>
                </span>
            </button>
        );
    };

    return (
        <section aria-label="Parser-selected workflow anchors" className="space-y-2 border-y border-gray-200 py-2 dark:border-white/10">
            <div className="flex flex-wrap items-center gap-2">
                {selectedOutputNodeIds.map((nodeId) => renderAnchor(nodeId, 'output'))}
                {rootSamplerNodeIds.map((nodeId) => renderAnchor(nodeId, 'root'))}
            </div>
            {outputAmbiguous ? (
                <div className="flex items-start gap-1.5 text-[10px] text-amber-700 dark:text-amber-300">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    Multiple root samplers were found. Ambit does not treat any candidate as authoritative.
                </div>
            ) : rootSamplerNodeIds.length === 0 ? (
                <div className="text-[10px] text-gray-500 dark:text-gray-400">
                    No sampler root was found for the selected output.
                </div>
            ) : null}
        </section>
    );
};

const ComfyDiagnosticsPanel: React.FC<{
    image: Pick<AIImage, 'id' | 'filename' | 'width' | 'height'>;
    chunks?: Record<string, string>;
    nodeById: Map<string, WorkflowDisplayNode>;
    onFocusNode: (nodeId: string) => void;
}> = ({ image, chunks, nodeById, onFocusNode }) => {
    const [diagnostics, setDiagnostics] = useState<ComfyParserDiagnosticsReport | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [copiedDiagnostics, setCopiedDiagnostics] = useState(false);
    const [isExportConfirmOpen, setIsExportConfirmOpen] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [exportError, setExportError] = useState<string | null>(null);
    const [showAllTraversalIssues, setShowAllTraversalIssues] = useState(false);
    const chunkCount = chunks ? Object.keys(chunks).length : 0;

    React.useEffect(() => {
        setShowAllTraversalIssues(false);

        if (!chunks || chunkCount === 0) {
            setDiagnostics(null);
            setError(null);
            setIsLoading(false);
            return;
        }

        let cancelled = false;
        setIsLoading(true);
        setError(null);

        commands.inspectComfyuiMetadataChunks(chunks)
            .then((result) => {
                if (cancelled) return;
                if (result.status === 'ok') {
                    setDiagnostics(result.data);
                } else {
                    setDiagnostics(null);
                    setError(result.error);
                }
            })
            .catch((err) => {
                if (cancelled) return;
                setDiagnostics(null);
                setError(err instanceof Error ? err.message : String(err));
            })
            .finally(() => {
                if (!cancelled) setIsLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [chunks, chunkCount, image.id]);

    const fieldSources = diagnostics
        ? Object.entries(diagnostics.fieldSources).sort(([a], [b]) => a.localeCompare(b))
        : [];
    const resourceSources = diagnostics?.resourceSources ?? [];
    const traversalIssues = diagnostics?.traversalIssues ?? [];
    const hasHiddenTraversalIssues = traversalIssues.length > 4;
    const visibleTraversalIssues = showAllTraversalIssues
        ? traversalIssues
        : traversalIssues.slice(0, 4);

    const handleCopyDiagnostics = async () => {
        const payload = buildDiagnosticsClipboardPayload(image, chunks!, diagnostics!);
        await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
        setCopiedDiagnostics(true);
        setTimeout(() => setCopiedDiagnostics(false), 2000);
    };

    const handleExportDiagnostics = async () => {
        setIsExporting(true);
        setExportError(null);

        try {
            const bundle = buildComfySupportBundle(
                image,
                chunks!,
                diagnostics!,
                new Date().toISOString()
            );
            const contents = JSON.stringify(bundle, null, 2);
            const [{ save }, { writeTextFile }] = await Promise.all([
                import('@tauri-apps/plugin-dialog'),
                import('@tauri-apps/plugin-fs')
            ]);
            const filePath = await save({
                filters: [{ name: 'JSON', extensions: ['json'] }],
                defaultPath: 'ambit-comfyui-support.json'
            });

            if (filePath) {
                await writeTextFile(filePath, contents);
            }
            setIsExportConfirmOpen(false);
        } catch (err) {
            setIsExportConfirmOpen(false);
            setExportError(err instanceof Error ? err.message : String(err));
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <>
        <div className="rounded-xl border border-amber-200 dark:border-amber-500/20 bg-amber-50/70 dark:bg-amber-500/10 p-3 text-xs">
            <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 font-bold text-amber-900 dark:text-amber-300">
                    <Activity className="w-3.5 h-3.5" />
                    Parser Diagnostics
                </div>
                <div className="flex items-center gap-2">
                    {diagnostics && (
                        <>
                            <button
                                onClick={handleCopyDiagnostics}
                                title="Copy parser diagnostics summary"
                                className="flex items-center gap-1 rounded-md border border-amber-300/70 dark:border-amber-400/20 bg-white/70 dark:bg-black/20 px-1.5 py-0.5 font-bold uppercase tracking-wide text-[10px] text-amber-900 dark:text-amber-200 hover:bg-white dark:hover:bg-black/30 transition-colors"
                            >
                                {copiedDiagnostics ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                                {copiedDiagnostics ? 'Copied' : 'Copy Diagnostics'}
                            </button>
                            <button
                                onClick={() => {
                                    setExportError(null);
                                    setIsExportConfirmOpen(true);
                                }}
                                title="Export parser support bundle"
                                className="flex items-center gap-1 rounded-md border border-amber-300/70 dark:border-amber-400/20 bg-white/70 dark:bg-black/20 px-1.5 py-0.5 font-bold uppercase tracking-wide text-[10px] text-amber-900 dark:text-amber-200 hover:bg-white dark:hover:bg-black/30 transition-colors"
                            >
                                <Download className="w-3 h-3" />
                                Export Bundle
                            </button>
                            <span className="font-mono text-[10px] text-amber-800/70 dark:text-amber-300/70">
                                {diagnostics.graphNodeCount} nodes
                            </span>
                        </>
                    )}
                </div>
            </div>

            {!chunks || chunkCount === 0 ? (
                <div className="mt-2 text-amber-800/70 dark:text-amber-200/70">Raw chunks unavailable.</div>
            ) : isLoading ? (
                <div className="mt-2 text-amber-800/70 dark:text-amber-200/70">Loading diagnostics...</div>
            ) : error ? (
                <div className="mt-2 text-rose-700 dark:text-rose-300">Diagnostics unavailable: {error}</div>
            ) : diagnostics ? (
                <div className="mt-3 space-y-3 text-amber-950 dark:text-amber-100">
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <div className="text-[10px] uppercase font-bold text-amber-800/60 dark:text-amber-200/60">Chunks</div>
                            <div className="font-mono break-all">{diagnostics.chunkKeys.join(', ') || 'None'}</div>
                        </div>
                        <div>
                            <div className="text-[10px] uppercase font-bold text-amber-800/60 dark:text-amber-200/60">Layers</div>
                            <div className="font-mono break-all">{diagnostics.attemptedLayers.join(' -> ') || 'None'}</div>
                        </div>
                    </div>

                    <div>
                        <div className="text-[10px] uppercase font-bold text-amber-800/60 dark:text-amber-200/60">Output Selection</div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 font-mono text-[10px]">
                            <span className="rounded-md border border-amber-300/70 dark:border-amber-400/20 bg-white/70 dark:bg-black/20 px-1.5 py-0.5">
                                {diagnostics.selectedOutputCandidateCount} output{diagnostics.selectedOutputCandidateCount === 1 ? '' : 's'} / {diagnostics.uniqueOutputRootSamplerCount} root{diagnostics.uniqueOutputRootSamplerCount === 1 ? '' : 's'}
                            </span>
                            {diagnostics.outputAmbiguous && (
                                <span
                                    title="Multiple saved-output roots were found, so no branch received strong traversal authority."
                                    className="rounded-md border border-rose-300/70 dark:border-rose-400/30 bg-rose-50/80 dark:bg-rose-500/10 px-1.5 py-0.5 text-rose-900 dark:text-rose-100"
                                >
                                    Ambiguous
                                </span>
                            )}
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <div className="text-[10px] uppercase font-bold text-amber-800/60 dark:text-amber-200/60">Model</div>
                            <div className="font-mono break-all">{formatDiagnosticValue(diagnostics.metadata.model)}</div>
                        </div>
                        <div>
                            <div className="text-[10px] uppercase font-bold text-amber-800/60 dark:text-amber-200/60">Sampler</div>
                            <div className="font-mono break-all">{formatDiagnosticValue(diagnostics.metadata.sampler)}</div>
                        </div>
                        <div>
                            <div className="text-[10px] uppercase font-bold text-amber-800/60 dark:text-amber-200/60">Seed</div>
                            <div className="font-mono break-all">{formatDiagnosticValue(diagnostics.metadata.seed)}</div>
                        </div>
                        <div>
                            <div className="text-[10px] uppercase font-bold text-amber-800/60 dark:text-amber-200/60">Steps / CFG</div>
                            <div className="font-mono break-all">{diagnostics.metadata.steps} / {diagnostics.metadata.cfg}</div>
                        </div>
                    </div>

                    <div>
                        <div className="text-[10px] uppercase font-bold text-amber-800/60 dark:text-amber-200/60">Positive Prompt</div>
                        <div className="font-mono line-clamp-3 break-words">{formatDiagnosticValue(diagnostics.metadata.positivePrompt)}</div>
                    </div>

                    <div>
                        <div className="text-[10px] uppercase font-bold text-amber-800/60 dark:text-amber-200/60">Field Sources</div>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                            {fieldSources.length > 0 ? fieldSources.map(([field, layer]) => {
                                const sourceNodeIds = diagnostics.fieldSourceNodeIds?.[field] ?? [];
                                return (
                                    <div key={field} className="flex flex-wrap items-center gap-1">
                                        <span
                                            title={getDiagnosticLayerTitle(layer)}
                                            className={`rounded-md border px-1.5 py-0.5 font-mono text-[10px] ${getDiagnosticLayerBadgeClass(layer)}`}
                                        >
                                            {formatDiagnosticLabel(field)}: {formatDiagnosticLabel(layer ?? '')}
                                        </span>
                                        {sourceNodeIds.map((nodeId) => {
                                            const node = nodeById.get(nodeId);
                                            return node ? (
                                                <button
                                                    key={nodeId}
                                                    type="button"
                                                    onClick={() => onFocusNode(nodeId)}
                                                    title={`Jump to source node ${nodeId}: ${node.title}`}
                                                    className="rounded-md border border-amber-300/70 bg-white/80 px-1.5 py-0.5 font-mono text-[10px] text-amber-950 transition-colors hover:border-sage-400 hover:bg-sage-50 hover:text-sage-800 dark:border-amber-400/20 dark:bg-black/20 dark:text-amber-100 dark:hover:border-sage-500/50 dark:hover:bg-sage-500/10 dark:hover:text-sage-200"
                                                >
                                                    #{nodeId}
                                                </button>
                                            ) : (
                                                <span
                                                    key={nodeId}
                                                    title={`Source node ${nodeId} is not available in the normalized workflow graph.`}
                                                    className="rounded-md border border-dashed border-amber-300/50 px-1.5 py-0.5 font-mono text-[10px] text-amber-800/60 dark:border-amber-400/20 dark:text-amber-200/50"
                                                >
                                                    #{nodeId}
                                                </span>
                                            );
                                        })}
                                    </div>
                                );
                            }) : (
                                <span className="text-amber-800/70 dark:text-amber-200/70">None</span>
                            )}
                        </div>
                    </div>

                    {resourceSources.length > 0 && (
                        <div className="border-t border-amber-300/40 pt-3 dark:border-amber-400/15">
                            <div className="text-[10px] uppercase font-bold text-amber-800/60 dark:text-amber-200/60">Resource Sources</div>
                            <div className="mt-1.5 space-y-1.5">
                                {resourceSources.map((source) => (
                                    <div
                                        key={`${source.field}:${source.value}`}
                                        className="flex flex-wrap items-center gap-1.5 font-mono text-[10px]"
                                    >
                                        <span className="font-bold text-amber-900 dark:text-amber-100">
                                            {formatResourceFieldLabel(source.field)}:
                                        </span>
                                        <span className="break-all text-amber-950 dark:text-amber-50">{source.value}</span>
                                        <span
                                            title={getDiagnosticLayerTitle(source.layer)}
                                            className={`rounded-md border px-1.5 py-0.5 ${getDiagnosticLayerBadgeClass(source.layer)}`}
                                        >
                                            {formatDiagnosticLabel(source.layer ?? 'unknown')}
                                        </span>
                                        {source.nodeIds.map((nodeId) => {
                                            const node = nodeById.get(nodeId);
                                            return node ? (
                                                <button
                                                    key={nodeId}
                                                    type="button"
                                                    onClick={() => onFocusNode(nodeId)}
                                                    aria-label={`Jump to ${formatResourceFieldLabel(source.field)} resource source node ${node.title} (${nodeId})`}
                                                    title={`Jump to resource source node ${nodeId}: ${node.title}`}
                                                    className="rounded-md border border-amber-300/70 bg-white/80 px-1.5 py-0.5 text-amber-950 transition-colors hover:border-sage-400 hover:bg-sage-50 hover:text-sage-800 dark:border-amber-400/20 dark:bg-black/20 dark:text-amber-100 dark:hover:border-sage-500/50 dark:hover:bg-sage-500/10 dark:hover:text-sage-200"
                                                >
                                                    #{nodeId}
                                                </button>
                                            ) : (
                                                <span
                                                    key={nodeId}
                                                    title={`Resource source node ${nodeId} is not available in the normalized workflow graph.`}
                                                    className="rounded-md border border-dashed border-amber-300/50 px-1.5 py-0.5 text-amber-800/60 dark:border-amber-400/20 dark:text-amber-200/50"
                                                >
                                                    #{nodeId}
                                                </span>
                                            );
                                        })}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {visibleTraversalIssues.length > 0 && (
                        <div>
                            <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-1 text-[10px] uppercase font-bold text-amber-800/60 dark:text-amber-200/60">
                                    <AlertTriangle className="w-3 h-3" />
                                    Traversal Blockers
                                </div>
                                {hasHiddenTraversalIssues && (
                                    <button
                                        type="button"
                                        aria-expanded={showAllTraversalIssues}
                                        onClick={() => setShowAllTraversalIssues((current) => !current)}
                                        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold text-amber-800 transition-colors hover:bg-amber-100 dark:text-amber-200 dark:hover:bg-amber-500/10"
                                    >
                                        {showAllTraversalIssues ? (
                                            <ChevronDown className="h-3 w-3" />
                                        ) : (
                                            <ChevronRight className="h-3 w-3" />
                                        )}
                                        {showAllTraversalIssues ? 'Show less' : `Show all (${traversalIssues.length})`}
                                    </button>
                                )}
                            </div>
                            <div className="mt-1 space-y-1">
                                {visibleTraversalIssues.map((issue, index) => {
                                    const node = nodeById.get(issue.nodeId);
                                    return (
                                        <div
                                            key={`${issue.field}-${issue.nodeId}-${issue.inputName ?? ''}-${issue.reason}-${index}`}
                                            title={getTraversalIssueTitle(issue.reason)}
                                            className="rounded-md border border-orange-300/70 bg-orange-50/70 px-2 py-1 font-mono text-[10px] text-orange-950 dark:border-orange-400/30 dark:bg-orange-500/10 dark:text-orange-100"
                                        >
                                            <span className="font-bold">{formatDiagnosticLabel(issue.field)}</span>
                                            {' at '}
                                            {node ? (
                                                <button
                                                    type="button"
                                                    onClick={() => onFocusNode(issue.nodeId)}
                                                    aria-label={`Jump to traversal blocker node ${node.title} (${issue.nodeId})`}
                                                    title={`Jump to traversal blocker node ${issue.nodeId}: ${node.title}`}
                                                    className="rounded border border-orange-400/50 bg-white/70 px-1 py-0.5 font-mono text-[10px] font-bold text-orange-900 transition-colors hover:border-sage-400 hover:bg-sage-50 hover:text-sage-800 dark:border-orange-300/30 dark:bg-black/20 dark:text-orange-100 dark:hover:border-sage-500/50 dark:hover:bg-sage-500/10 dark:hover:text-sage-200"
                                                >
                                                    #{issue.nodeId}
                                                </button>
                                            ) : (
                                                <span
                                                    title={`Traversal blocker node ${issue.nodeId} is not available in the normalized workflow graph.`}
                                                    className="rounded border border-dashed border-orange-400/40 px-1 py-0.5 font-mono text-[10px] text-orange-800/70 dark:border-orange-300/20 dark:text-orange-200/60"
                                                >
                                                    #{issue.nodeId}
                                                </span>
                                            )}
                                            {' '}{`(${issue.nodeType})`}
                                            {issue.inputName ? ` / ${issue.inputName}` : ''}
                                            {': '}{formatDiagnosticLabel(issue.reason)}
                                        </div>
                                    );
                                })}
                                {diagnostics.traversalIssuesTruncated && (
                                    <div className="text-[10px] text-amber-800/70 dark:text-amber-200/70">
                                        Additional traversal blockers were omitted after the diagnostics limit.
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            ) : null}
            {exportError && (
                <div className="mt-2 text-rose-700 dark:text-rose-300">
                    Support bundle export failed: {exportError}
                </div>
            )}
        </div>
        <ConfirmDialog
            isOpen={isExportConfirmOpen}
            title="Export ComfyUI support bundle?"
            message="This local JSON file includes the image's raw metadata chunks. It may contain prompts, model names, workflow settings, and local filenames. Ambit will not upload it."
            confirmLabel="Export Bundle"
            isLoading={isExporting}
            onConfirm={handleExportDiagnostics}
            onCancel={() => setIsExportConfirmOpen(false)}
        />
        </>
    );
};

const WorkflowNode: React.FC<{
    id: string | number;
    title: string;
    type: string;
    inputs: WorkflowInputs;
    connections: WorkflowNodeConnections;
    nodeById: Map<string, WorkflowDisplayNode>;
    isSelectedOutput: boolean;
    isRootSampler: boolean;
    outputAmbiguous: boolean;
    isFocused: boolean;
    focusRequestId: number | null;
    onFollowConnection: (nodeId: string) => void;
}> = ({ id, title, type, inputs, connections, nodeById, isSelectedOutput, isRootSampler, outputAmbiguous, isFocused, focusRequestId, onFollowConnection }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const hasInputs = Object.keys(inputs).length > 0;
    const hasConnections = connections.incoming.length > 0 || connections.outgoing.length > 0;
    const hasContent = hasInputs || hasConnections;

    React.useEffect(() => {
        if (isFocused && focusRequestId !== null && hasContent) setIsExpanded(true);
    }, [focusRequestId, hasContent, isFocused]);

    const renderConnection = (edge: WorkflowDisplayEdge, direction: 'incoming' | 'outgoing') => {
        const connectedNodeId = direction === 'incoming' ? edge.sourceNodeId : edge.targetNodeId;
        const connectedNode = nodeById.get(connectedNodeId);
        const connectedTitle = connectedNode?.title ?? `Node ${connectedNodeId}`;
        const sourceSlot = edge.sourceOutputSlot === null || edge.sourceOutputSlot === undefined
            ? 'output'
            : `output ${edge.sourceOutputSlot}`;
        const endpoint = `${sourceSlot} -> ${edge.targetInputName}`;
        const Icon = direction === 'incoming' ? ArrowDownToLine : ArrowUpFromLine;

        return (
            <button
                key={`${edge.sourceNodeId}:${edge.sourceOutputSlot ?? ''}:${edge.targetNodeId}:${edge.targetInputSlot ?? ''}:${edge.targetInputName}`}
                type="button"
                aria-label={`Open ${direction} connected node ${connectedTitle} (${connectedNodeId})`}
                title={`Open node ${connectedNodeId}`}
                onClick={() => onFollowConnection(connectedNodeId)}
                className="flex w-full items-start gap-2 rounded-md border border-gray-200 dark:border-white/10 bg-gray-50/70 dark:bg-white/5 px-2 py-1.5 text-left transition-colors hover:border-sage-300 hover:bg-sage-50 dark:hover:border-sage-700 dark:hover:bg-sage-900/20"
            >
                <Icon className="mt-0.5 h-3 w-3 shrink-0 text-sage-600 dark:text-sage-400" />
                <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] font-semibold text-gray-700 dark:text-gray-200">
                        {connectedTitle}
                    </span>
                    <span className="block truncate font-mono text-[9px] text-gray-400" title={`${endpoint} / node ${connectedNodeId}`}>
                        {endpoint} / #{connectedNodeId}
                    </span>
                </span>
            </button>
        );
    };

    return (
        <div
            id={workflowNodeElementId(id)}
            data-workflow-node-id={String(id)}
            tabIndex={-1}
            className={`bg-white dark:bg-slate-800/40 border rounded-xl text-sm overflow-hidden transition-all outline-none ${isFocused ? 'border-sage-500 ring-2 ring-sage-400/30' : 'border-gray-200 dark:border-white/5'}`}
        >
            <button
                type="button"
                aria-expanded={hasContent ? isExpanded : undefined}
                onClick={() => setIsExpanded(!isExpanded)}
                disabled={!hasContent}
                className={`w-full flex items-center gap-3 p-3 text-left transition-colors ${isExpanded ? 'bg-gray-50 dark:bg-white/5' : 'hover:bg-gray-50 dark:hover:bg-white/5'} ${!hasContent ? 'cursor-default opacity-80' : ''}`}
            >
                <Box className={`w-3.5 h-3.5 shrink-0 ${isExpanded ? 'text-sage-500' : 'text-gray-400'}`} />
                <div className="flex-1 min-w-0">
                    <div className="font-bold text-gray-800 dark:text-gray-200 truncate" title={title}>{title}</div>
                    <div className="flex min-w-0 items-center gap-1 text-[10px] text-gray-400 font-mono">
                        <span className="truncate">{type}</span>
                        <span
                            className="max-w-[45%] truncate text-gray-300 dark:text-gray-600"
                            title={`Node ${id}`}
                        >
                            #{id}
                        </span>
                    </div>
                    {(isSelectedOutput || isRootSampler) && (
                        <div className="mt-1 flex flex-wrap gap-1">
                            {isSelectedOutput && (
                                <span className="rounded border border-sage-300 bg-sage-50 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-sage-700 dark:border-sage-700 dark:bg-sage-900/20 dark:text-sage-300">
                                    Selected Output
                                </span>
                            )}
                            {isRootSampler && (
                                <span className={`rounded border px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide ${outputAmbiguous ? 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-300' : 'border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-700 dark:bg-sky-900/20 dark:text-sky-300'}`}>
                                    {outputAmbiguous ? 'Root Candidate' : 'Root Sampler'}
                                </span>
                            )}
                        </div>
                    )}
                </div>
                {hasContent && (
                    <div className="text-gray-400">
                        {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </div>
                )}
            </button>

            {isExpanded && hasContent && (
                <div className="p-3 pt-0 border-t border-gray-100 dark:border-white/5 space-y-3 mt-2">
                    {hasInputs && (
                        <div className="space-y-1">
                            {Object.entries(inputs).map(([key, val]) => {
                                if (typeof val === 'object' && val !== null && !Array.isArray(val)) return null; // Skip complex objects/connections
                                if (Array.isArray(val) && val.length > 0 && typeof val[0] === 'string' && val[0].length > 50) {
                                    if (val.length === 2 && typeof val[1] === 'number') return null;
                                }

                                return (
                                    <div key={key} className="flex justify-between items-start gap-2 text-xs group py-1 border-b border-gray-100/50 dark:border-white/5 last:border-0">
                                        <span className="text-gray-500 dark:text-gray-400 truncate shrink-0 max-w-[40%] select-none">{key}:</span>
                                        <span className="text-gray-700 dark:text-gray-300 font-mono break-all text-right line-clamp-4 hover:line-clamp-none transition-all cursor-text select-text" title={String(val)}>
                                            {String(val)}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {connections.incoming.length > 0 && (
                        <section aria-label={`Incoming connections for node ${id}`}>
                            <div className="mb-1.5 text-[9px] font-bold uppercase tracking-wide text-gray-400">Incoming</div>
                            <div className="space-y-1">
                                {connections.incoming.map((edge) => renderConnection(edge, 'incoming'))}
                            </div>
                        </section>
                    )}

                    {connections.outgoing.length > 0 && (
                        <section aria-label={`Outgoing connections for node ${id}`}>
                            <div className="mb-1.5 text-[9px] font-bold uppercase tracking-wide text-gray-400">Outgoing</div>
                            <div className="space-y-1">
                                {connections.outgoing.map((edge) => renderConnection(edge, 'outgoing'))}
                            </div>
                        </section>
                    )}
                </div>
            )}
        </div>
    );
};

const WorkflowNodeSection: React.FC<{
    path: string[];
    nodes: ReturnType<typeof groupWorkflowNodes>[number]['nodes'];
    connectionIndex: Map<string, WorkflowNodeConnections>;
    nodeById: Map<string, WorkflowDisplayNode>;
    selectedOutputNodeIdSet: Set<string>;
    rootSamplerNodeIdSet: Set<string>;
    outputAmbiguous: boolean;
    focusedNodeId: string | null;
    focusRequestId: number | null;
    onFollowConnection: (nodeId: string) => void;
}> = ({ path, nodes, connectionIndex, nodeById, selectedOutputNodeIdSet, rootSamplerNodeIdSet, outputAmbiguous, focusedNodeId, focusRequestId, onFollowConnection }) => {
    const nodeList = (
        <div className="space-y-2">
            {nodes.map((node) => (
                <WorkflowNode
                    key={String(node.id)}
                    id={node.id}
                    title={node.title}
                    type={node.type}
                    inputs={node.inputs}
                    connections={connectionIndex.get(String(node.id)) ?? { incoming: [], outgoing: [] }}
                    nodeById={nodeById}
                    isSelectedOutput={selectedOutputNodeIdSet.has(String(node.id))}
                    isRootSampler={rootSamplerNodeIdSet.has(String(node.id))}
                    outputAmbiguous={outputAmbiguous}
                    isFocused={focusedNodeId === String(node.id)}
                    focusRequestId={focusedNodeId === String(node.id) ? focusRequestId : null}
                    onFollowConnection={onFollowConnection}
                />
            ))}
        </div>
    );

    if (path.length === 0) return nodeList;

    return (
        <section
            className="border-l-2 border-sage-200 dark:border-sage-800/70 pl-3"
            style={{ marginLeft: Math.min(path.length - 1, 3) * 12 }}
        >
            <div className="mb-2 flex min-w-0 items-center gap-2 text-[10px] font-bold uppercase tracking-wide text-sage-700 dark:text-sage-400">
                <Workflow className="h-3 w-3 shrink-0" />
                <span className="truncate" title={`Subgraph ${path.join(' / ')}`}>
                    Subgraph {path.join(' / ')}
                </span>
            </div>
            {nodeList}
        </section>
    );
};

export const WorkflowInspector: React.FC<WorkflowInspectorProps> = ({ image, onWorkflowLoaded }) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [nodeMode, setNodeMode] = useState<'all' | 'selected'>('all');
    const [copied, setCopied] = useState(false);
    const [localWorkflow, setLocalWorkflow] = useState<string | undefined>(image.metadata.workflowJson);
    const [backendWorkflowGraph, setBackendWorkflowGraph] = useState<{
        chunks: Record<string, string>;
        report: ComfyWorkflowGraphReport;
    } | null>(null);
    const [focusedConnection, setFocusedConnection] = useState<{
        nodeId: string;
        requestId: number;
    } | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const hasAttempted = React.useRef<string | null>(null);
    const isDeveloperMode = useSettingsStore((state) => state.settings.devMode === true);
    const showParserDiagnostics = !isVideoAsset(image)
        && isDeveloperMode
        && image.metadata.tool === 'ComfyUI';
    const originalWorkflow = image.originalChunks?.workflow;
    const originalPrompt = image.originalChunks?.prompt;
    const originalChunks = useMemo(() => ({
        ...(originalWorkflow ? { workflow: originalWorkflow } : {}),
        ...(originalPrompt ? { prompt: originalPrompt } : {})
    }), [originalWorkflow, originalPrompt]);
    const workflowJsonForActions = selectWorkflowJsonForActions({
        localWorkflowJson: localWorkflow,
        workflowJson: image.metadata.workflowJson,
        originalChunks
    });
    const fallbackWorkflowGraphSource = useMemo(() => selectWorkflowGraphSource({
        tool: image.metadata.tool,
        localWorkflowJson: localWorkflow,
        workflowJson: image.metadata.workflowJson,
        originalChunks
    }), [image.metadata.tool, image.metadata.workflowJson, localWorkflow, originalChunks]);
    const backendGraphSource = useMemo(
        () => workflowGraphSourceFromBackend(
            backendWorkflowGraph?.chunks === originalChunks ? backendWorkflowGraph.report : null,
            originalChunks
        ),
        [backendWorkflowGraph, originalChunks]
    );
    const workflowGraphSource = backendGraphSource ?? fallbackWorkflowGraphSource;
    const workflowNodes = workflowGraphSource?.nodes ?? [];
    const workflowEdges = workflowGraphSource?.edges ?? [];
    const nodeById = useMemo(
        () => new Map(workflowNodes.map((node) => [String(node.id), node])),
        [workflowNodes]
    );
    const connectionIndex = useMemo(
        () => indexWorkflowConnections(workflowNodes, workflowEdges),
        [workflowEdges, workflowNodes]
    );
    const selectedOutputNodeIds = workflowGraphSource?.selectedOutputNodeIds ?? [];
    const rootSamplerNodeIds = workflowGraphSource?.rootSamplerNodeIds ?? [];
    const selectedBranchNodeIds = workflowGraphSource?.selectedBranchNodeIds ?? [];
    const outputAmbiguous = workflowGraphSource?.outputAmbiguous ?? false;
    const visibleSelectedOutputNodeIds = useMemo(
        () => selectedOutputNodeIds.filter((nodeId) => nodeById.has(nodeId)),
        [nodeById, selectedOutputNodeIds]
    );
    const visibleRootSamplerNodeIds = useMemo(
        () => rootSamplerNodeIds.filter((nodeId) => nodeById.has(nodeId)),
        [nodeById, rootSamplerNodeIds]
    );
    const visibleSelectedBranchNodeIds = useMemo(
        () => selectedBranchNodeIds.filter((nodeId) => nodeById.has(nodeId)),
        [nodeById, selectedBranchNodeIds]
    );
    const selectedOutputNodeIdSet = useMemo(
        () => new Set(visibleSelectedOutputNodeIds),
        [visibleSelectedOutputNodeIds]
    );
    const rootSamplerNodeIdSet = useMemo(
        () => new Set(visibleRootSamplerNodeIds),
        [visibleRootSamplerNodeIds]
    );
    const selectedBranchNodeIdSet = useMemo(
        () => new Set(visibleSelectedBranchNodeIds),
        [visibleSelectedBranchNodeIds]
    );
    const selectedBranchAvailable = workflowGraphSource?.normalizedByBackend === true
        && !outputAmbiguous
        && visibleRootSamplerNodeIds.length === 1
        && visibleSelectedBranchNodeIds.length > 0;
    const selectedBranchUnavailableTitle = outputAmbiguous
        ? 'Unavailable because selected outputs resolve to different root samplers.'
        : visibleSelectedOutputNodeIds.length === 0
            ? 'Unavailable because no saved output was selected.'
            : visibleRootSamplerNodeIds.length === 0
                ? 'Unavailable because no root sampler was found.'
                : workflowGraphSource?.normalizedByBackend !== true
                    ? 'Unavailable without a normalized ComfyUI graph.'
                    : 'Unavailable because the selected dependency branch could not be resolved.';

    const handleFollowConnection = React.useCallback((nodeId: string) => {
        if (nodeMode === 'selected' && !selectedBranchNodeIdSet.has(nodeId)) {
            setNodeMode('all');
        }
        setSearchQuery('');
        setFocusedConnection((current) => ({
            nodeId,
            requestId: (current?.requestId ?? 0) + 1
        }));
    }, [nodeMode, selectedBranchNodeIdSet]);

    React.useEffect(() => {
        setFocusedConnection(null);
        setNodeMode('all');
    }, [image.id, workflowGraphSource?.json, workflowGraphSource?.normalizedByBackend, workflowGraphSource?.source]);

    React.useEffect(() => {
        if (nodeMode === 'selected' && !selectedBranchAvailable) {
            setNodeMode('all');
        }
    }, [nodeMode, selectedBranchAvailable]);

    React.useEffect(() => {
        if (image.metadata.tool !== 'ComfyUI' || Object.keys(originalChunks).length === 0) {
            setBackendWorkflowGraph(null);
            return;
        }

        let cancelled = false;
        setBackendWorkflowGraph(null);

        commands.inspectComfyuiWorkflowGraph(originalChunks)
            .then((result) => {
                if (cancelled) return;
                setBackendWorkflowGraph(result.status === 'ok'
                    ? { chunks: originalChunks, report: result.data }
                    : null);
            })
            .catch(() => {
                if (!cancelled) setBackendWorkflowGraph(null);
            });

        return () => {
            cancelled = true;
        };
    }, [image.metadata.tool, originalChunks]);

    // Lazy Load Workflow if missing
    React.useEffect(() => {
        // Only attempt if:
        // 1. Data is missing
        // 2. We are not already loading
        // 3. We haven't already attempted this specific image in this session
        if (!isVideoAsset(image) && !workflowJsonForActions && !isLoading && hasAttempted.current !== image.id) {
            // If we have a hint that there is definitely NO workflow, skip and mark as attempted
            if (image.metadata.hasWorkflowHint === false) {
                hasAttempted.current = image.id;
                return;
            }

            const loadWorkflow = async () => {
                setIsLoading(true);
                hasAttempted.current = image.id;
                try {
                    console.log('[Workflow] Lazy loading for:', image.filename);
                    const result = await scanImageWorkflow(image.id);

                    const isValidWorkflow = result && isWorkflowGraph(result);

                    console.log('[Workflow] Scan result:', isValidWorkflow ? 'Found VALID workflow' : 'No valid graph found', result?.substring(0, 100));

                    if (isValidWorkflow) {
                        setLocalWorkflow(result);
                        await updateImageWorkflow(image.id, result!); // result is checked in isValidWorkflow
                        onWorkflowLoaded?.(result!);
                    } else {
                        // No workflow found - persist this so we hide the tab next time
                        console.log('[Workflow] No workflow found (or invalid graph), setting hasWorkflowHint=false for:', image.id);
                        await updateImageWorkflowHint(image.id, false);
                    }
                } catch (e) {
                    console.error('[Workflow] Failed lazy loading', e);
                } finally {
                    setIsLoading(false);
                }
            };
            loadWorkflow();
        }
    }, [image.id, image.metadata.workflowJson, localWorkflow, isLoading, workflowJsonForActions]);

    // Sync local state if prop changes OR if image changes
    React.useEffect(() => {
        setLocalWorkflow(image.metadata.workflowJson);
    }, [image.id, image.metadata.workflowJson]);

    const handleCopy = () => {
        navigator.clipboard.writeText(workflowJsonForActions!);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleDownload = async () => {
        const wf = workflowJsonForActions!;

        try {
            // Generate a sensible filename: name_workflow.json
            const baseName = image.filename.replace(/\.[^/.]+$/, "");
            const defaultPath = `${baseName}_workflow.json`;

            const { save } = await import('@tauri-apps/plugin-dialog');
            const filePath = await save({
                filters: [{ name: 'JSON', extensions: ['json'] }],
                defaultPath
            });

            if (filePath) {
                const { writeTextFile } = await import('@tauri-apps/plugin-fs');
                await writeTextFile(filePath, wf);
                console.log('[Workflow] Saved to', filePath);
            }
        } catch (e) {
            console.error('Failed to download workflow', e);
        }
    };

    const modeNodes = useMemo(
        () => nodeMode === 'selected' && selectedBranchAvailable
            ? workflowNodes.filter((node) => selectedBranchNodeIdSet.has(String(node.id)))
            : workflowNodes,
        [nodeMode, selectedBranchAvailable, selectedBranchNodeIdSet, workflowNodes]
    );
    const filteredNodes = useMemo(() => {
        if (!searchQuery) return modeNodes;
        const lowerQ = searchQuery.toLowerCase();
        return modeNodes.filter(node =>
            node.title.toLowerCase().includes(lowerQ) ||
            node.type.toLowerCase().includes(lowerQ) ||
            String(node.id).toLowerCase().includes(lowerQ) ||
            node.subgraphPath?.some(segment => segment.toLowerCase().includes(lowerQ))
        );
    }, [modeNodes, searchQuery]);
    const filteredNodeGroups = useMemo(() => groupWorkflowNodes(filteredNodes), [filteredNodes]);

    React.useEffect(() => {
        if (!focusedConnection || searchQuery) return;

        const element = document.getElementById(workflowNodeElementId(focusedConnection.nodeId));
        if (!element) return;

        element.focus({ preventScroll: true });
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, [filteredNodes, focusedConnection, searchQuery]);

    const graphSourceLabel = image.metadata.tool === 'ComfyUI' && workflowGraphSource
        ? workflowGraphSource.source === 'prompt'
            ? 'API Prompt'
            : workflowGraphSource.normalizedByBackend
                ? 'Expanded Workflow'
                : 'Workflow'
        : null;

    return (
        <div className="flex flex-col h-full overflow-hidden animate-in fade-in slide-in-from-right-4 duration-300">

            {/* Header & Search */}
            <div className="p-6 pb-2 shrink-0 space-y-4">
                <MetadataSectionHeader
                    title="Node Graph"
                    icon={Workflow}
                    trailing={<>
                        <div className="shrink-0 rounded-full bg-gray-100 px-2 py-1 font-mono text-[10px] text-gray-400 dark:bg-white/5">
                            {nodeMode === 'selected' ? `${modeNodes.length}/${workflowNodes.length}` : workflowNodes.length}
                        </div>
                        {graphSourceLabel && (
                            <div className="rounded-full border border-sage-200 bg-sage-50 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-sage-700 dark:border-sage-800 dark:bg-sage-900/20 dark:text-sage-400">
                                {graphSourceLabel}
                            </div>
                        )}
                        {workflowJsonForActions ? (
                        <div className="flex shrink-0 items-center gap-1">
                            <TooltipButton
                                onClick={handleCopy}
                                label={copied ? 'Copied workflow JSON' : 'Copy workflow JSON'}
                                content={copied ? 'Copied workflow JSON' : 'Copy workflow JSON'}
                                title="Copy to clipboard"
                                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-sage-200 bg-sage-50 text-sage-600 transition-colors hover:bg-sage-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-500/50 dark:border-sage-800 dark:bg-sage-900/20 dark:text-sage-400 dark:hover:bg-sage-900/40"
                            >
                                {copied ? <Check aria-hidden="true" className="h-4 w-4" /> : <Copy aria-hidden="true" className="h-4 w-4" />}
                            </TooltipButton>
                            <TooltipButton
                                onClick={handleDownload}
                                label="Download workflow JSON"
                                content="Download workflow JSON"
                                title="Download JSON file"
                                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 text-zinc-600 transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-500/50 dark:border-zinc-800 dark:bg-zinc-900/20 dark:text-zinc-400 dark:hover:bg-zinc-900/40"
                            >
                                <Download aria-hidden="true" className="h-4 w-4" />
                            </TooltipButton>
                            <span role="status" aria-live="polite" className="sr-only">
                                {copied ? 'Copied workflow JSON' : ''}
                            </span>
                        </div>
                        ) : null}
                    </>}
                />

                {image.metadata.tool === 'ComfyUI' && workflowNodes.length > 0 && (
                    <div
                        role="group"
                        aria-label="Workflow node view"
                        className="grid grid-cols-2 rounded-md border border-gray-200 bg-gray-100 p-0.5 dark:border-white/10 dark:bg-black/20"
                    >
                        <button
                            type="button"
                            aria-pressed={nodeMode === 'all'}
                            onClick={() => setNodeMode('all')}
                            className={`min-h-8 rounded px-3 text-[10px] font-bold uppercase tracking-wide transition-colors ${nodeMode === 'all'
                                ? 'bg-white text-gray-800 shadow-sm dark:bg-zinc-700 dark:text-gray-100'
                                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}`}
                        >
                            All Nodes
                        </button>
                        <button
                            type="button"
                            aria-pressed={nodeMode === 'selected'}
                            disabled={!selectedBranchAvailable}
                            title={selectedBranchAvailable ? 'Show the parser-selected saved-output dependency branch.' : selectedBranchUnavailableTitle}
                            onClick={() => setNodeMode('selected')}
                            className={`min-h-8 rounded px-3 text-[10px] font-bold uppercase tracking-wide transition-colors ${nodeMode === 'selected'
                                ? 'bg-sage-600 text-white shadow-sm dark:bg-sage-500 dark:text-zinc-950'
                                : selectedBranchAvailable
                                    ? 'text-gray-500 hover:text-sage-700 dark:text-gray-400 dark:hover:text-sage-300'
                                    : 'cursor-not-allowed text-gray-300 dark:text-gray-600'}`}
                        >
                            Selected Branch
                        </button>
                    </div>
                )}

                {workflowNodes.length > 0 && (
                    <div className="relative group">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 group-focus-within:text-sage-500 transition-colors" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search nodes (e.g. 'ControlNet', 'Seed')..."
                            className="w-full bg-white dark:bg-zinc-800 border border-gray-200 dark:border-white/10 rounded-xl py-2 pl-9 pr-3 text-xs focus:border-sage-500 focus:ring-1 focus:ring-sage-500/20 outline-none transition-all text-gray-700 dark:text-gray-200"
                        />
                    </div>
                )}

                <WorkflowOutputAnchors
                    selectedOutputNodeIds={visibleSelectedOutputNodeIds}
                    rootSamplerNodeIds={visibleRootSamplerNodeIds}
                    outputAmbiguous={outputAmbiguous}
                    nodeById={nodeById}
                    onFocusNode={handleFollowConnection}
                />

                {showParserDiagnostics && (
                    <ComfyDiagnosticsPanel
                        image={image}
                        chunks={image.originalChunks}
                        nodeById={nodeById}
                        onFocusNode={handleFollowConnection}
                    />
                )}
            </div>

            {/* Node List */}
            <div className="flex-1 overflow-y-auto custom-scrollbar px-6 pb-6">
                {filteredNodes.length > 0 ? (
                    <div className="space-y-4">
                        {filteredNodeGroups.map((group) => (
                            <WorkflowNodeSection
                                key={group.path.length === 0 ? 'workflow-root' : `subgraph:${group.key}`}
                                path={group.path}
                                nodes={group.nodes}
                                connectionIndex={connectionIndex}
                                nodeById={nodeById}
                                selectedOutputNodeIdSet={selectedOutputNodeIdSet}
                                rootSamplerNodeIdSet={rootSamplerNodeIdSet}
                                outputAmbiguous={outputAmbiguous}
                                focusedNodeId={focusedConnection?.nodeId ?? null}
                                focusRequestId={focusedConnection?.requestId ?? null}
                                onFollowConnection={handleFollowConnection}
                            />
                        ))}
                    </div>
                ) : (
                    <div className="py-12 text-center border border-dashed border-gray-200 dark:border-white/5 rounded-xl mt-2">
                        {workflowNodes.length === 0 ? (
                            <>
                                <div className="max-w-md mx-auto px-4">
                                    <Workflow className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2 opacity-50" />
                                    <p className="text-xs text-gray-400 mb-4 text-balance">
                                        {isLoading ? "Reading workflow data from file headers..." :
                                            !workflowJsonForActions
                                                ? (image.metadata.hasWorkflowHint === false
                                                    ? "This image was generated without a recorded workflow."
                                                    : "No workflow data was found for this image in the database or file headers.")
                                                : image.metadata.tool === 'InvokeAI'
                                                    ? "This InvokeAI workflow has a complex session structure that isn't fully visualizable yet, but you can still copy or download the JSON."
                                                    : "This image contains raw workflow data that doesn't follow the standard node graph structure, but you can still copy or download the JSON."
                                        }
                                    </p>
                                    {workflowJsonForActions && (
                                        <div className="p-3 bg-gray-50 dark:bg-white/5 rounded-lg border border-gray-100 dark:border-white/5 text-left overflow-hidden">
                                            <div className="text-[10px] text-gray-400 font-mono uppercase mb-2">JSON Preview</div>
                                            <pre className="text-[10px] text-gray-500 dark:text-gray-400 line-clamp-6 font-mono break-all whitespace-pre-wrap">
                                                {workflowJsonForActions.substring(0, 1000)}...
                                            </pre>
                                        </div>
                                    )}
                                </div>
                            </>
                        ) : (
                            <p className="text-xs text-gray-400">No matching nodes found.</p>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};
