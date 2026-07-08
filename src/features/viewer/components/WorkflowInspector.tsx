
import * as React from 'react';
import { useMemo, useState } from 'react';
import { Box, Workflow, Search, ChevronDown, ChevronRight, Copy, Check, Download } from 'lucide-react';
import { AIImage } from '../../../types';
import { scanImageWorkflow } from '../../../services/metadataParser';
import { updateImageWorkflow, updateImageWorkflowHint } from '../../../services/db/imageRepo';
import {
    isWorkflowGraph,
    selectWorkflowGraphSource,
    selectWorkflowJsonForActions,
    type WorkflowInputs
} from './workflowGraphUtils';

interface WorkflowInspectorProps {
    image: AIImage;
    onWorkflowLoaded?: (workflowJson: string) => void;
}

const WorkflowNode: React.FC<{ title: string; type: string; inputs: WorkflowInputs }> = ({ title, type, inputs }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const hasContent = Object.keys(inputs).length > 0;

    return (
        <div className="bg-white dark:bg-slate-800/40 border border-gray-200 dark:border-white/5 rounded-xl text-sm overflow-hidden transition-all">
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                disabled={!hasContent}
                className={`w-full flex items-center gap-3 p-3 text-left transition-colors ${isExpanded ? 'bg-gray-50 dark:bg-white/5' : 'hover:bg-gray-50 dark:hover:bg-white/5'} ${!hasContent ? 'cursor-default opacity-80' : ''}`}
            >
                <Box className={`w-3.5 h-3.5 shrink-0 ${isExpanded ? 'text-sage-500' : 'text-gray-400'}`} />
                <div className="flex-1 min-w-0">
                    <div className="font-bold text-gray-800 dark:text-gray-200 truncate" title={title}>{title}</div>
                    <div className="text-[10px] text-gray-400 font-mono truncate">{type}</div>
                </div>
                {hasContent && (
                    <div className="text-gray-400">
                        {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </div>
                )}
            </button>

            {isExpanded && hasContent && (
                <div className="p-3 pt-0 border-t border-gray-100 dark:border-white/5 space-y-1 mt-2">
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
                        )
                    })}
                </div>
            )}
        </div>
    );
};

export const WorkflowInspector: React.FC<WorkflowInspectorProps> = ({ image, onWorkflowLoaded }) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [copied, setCopied] = useState(false);
    const [localWorkflow, setLocalWorkflow] = useState<string | undefined>(image.metadata.workflowJson);
    const [isLoading, setIsLoading] = useState(false);
    const hasAttempted = React.useRef<string | null>(null);
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
    const workflowGraphSource = useMemo(() => selectWorkflowGraphSource({
        tool: image.metadata.tool,
        localWorkflowJson: localWorkflow,
        workflowJson: image.metadata.workflowJson,
        originalChunks
    }), [image.metadata.tool, image.metadata.workflowJson, localWorkflow, originalChunks]);
    const workflowNodes = workflowGraphSource?.nodes ?? [];

    // Lazy Load Workflow if missing
    React.useEffect(() => {
        // Only attempt if:
        // 1. Data is missing
        // 2. We are not already loading
        // 3. We haven't already attempted this specific image in this session
        if (!workflowJsonForActions && !isLoading && hasAttempted.current !== image.id) {
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
        const wf = workflowJsonForActions;
        if (wf) {
            navigator.clipboard.writeText(wf);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    const handleDownload = async () => {
        const wf = workflowJsonForActions;
        if (!wf) return;

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

    const filteredNodes = useMemo(() => {
        if (!searchQuery) return workflowNodes;
        const lowerQ = searchQuery.toLowerCase();
        return workflowNodes.filter(node =>
            node.title.toLowerCase().includes(lowerQ) ||
            node.type.toLowerCase().includes(lowerQ)
        );
    }, [workflowNodes, searchQuery]);

    return (
        <div className="flex flex-col h-full overflow-hidden animate-in fade-in slide-in-from-right-4 duration-300">

            {/* Header & Search */}
            <div className="p-6 pb-2 shrink-0 space-y-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <h3 className="text-xs font-bold uppercase text-gray-500 tracking-wider flex items-center gap-2">
                            <Workflow className="w-4 h-4" /> Full Node Graph
                        </h3>
                        <div className="text-[10px] text-gray-400 font-mono bg-gray-100 dark:bg-white/5 px-2 py-1 rounded-full">
                            {workflowNodes.length}
                        </div>
                    </div>

                    {workflowJsonForActions && (
                        <div className="flex gap-2">
                            <button
                                onClick={handleCopy}
                                title="Copy to clipboard"
                                className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-sage-50 dark:bg-sage-900/20 text-sage-600 dark:text-sage-400 hover:bg-sage-100 dark:hover:bg-sage-900/40 text-[10px] font-bold uppercase tracking-wide transition-colors border border-sage-200 dark:border-sage-800"
                            >
                                {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                                {copied ? "Copied" : "Copy"}
                            </button>
                            <button
                                onClick={handleDownload}
                                title="Download JSON file"
                                className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-zinc-50 dark:bg-zinc-900/20 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900/40 text-[10px] font-bold uppercase tracking-wide transition-colors border border-zinc-200 dark:border-zinc-800"
                            >
                                <Download className="w-3 h-3" />
                                Download
                            </button>
                        </div>
                    )}
                </div>

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
            </div>

            {/* Node List */}
            <div className="flex-1 overflow-y-auto custom-scrollbar px-6 pb-6">
                {filteredNodes.length > 0 ? (
                    <div className="space-y-2">
                        {filteredNodes.map((node, i) => (
                            <WorkflowNode key={node.id || i} title={node.title} type={node.type} inputs={node.inputs} />
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
