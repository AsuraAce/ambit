import React, { useEffect, useState } from 'react';
import { Check, Code, Copy } from 'lucide-react';
import { AIImage } from '../../../../types';
import { TooltipButton } from '../../../../components/ui/InfoTooltip';

interface MetadataRawInspectorProps {
    image: AIImage;
}

export const MetadataRawInspector = ({ image }: MetadataRawInspectorProps) => {
    const [showRaw, setShowRaw] = useState(false);
    const [rawViewMode, setRawViewMode] = useState<'parsed' | 'source' | 'json'>('parsed');
    const [copiedMode, setCopiedMode] = useState<typeof rawViewMode | null>(null);

    const getRawContent = (): string | null => {
        if (rawViewMode === 'parsed') {
            return JSON.stringify(image.metadata, null, 2);
        }
        if (rawViewMode === 'json' && image.metadata.workflowJson) {
            try {
                const obj = JSON.parse(image.metadata.workflowJson);
                return JSON.stringify(obj, null, 2);
            } catch (e) {
                return image.metadata.workflowJson;
            }
        }
        return image.metadata.rawParameters || null;
    };

    const rawContent = getRawContent();
    const copyLabel = rawViewMode === 'parsed'
        ? 'Copy parsed metadata'
        : rawViewMode === 'json'
            ? 'Copy workflow JSON'
            : 'Copy source metadata';

    useEffect(() => {
        if (!copiedMode) return;
        const timeout = window.setTimeout(() => setCopiedMode(null), 2000);
        return () => window.clearTimeout(timeout);
    }, [copiedMode]);

    useEffect(() => {
        if (rawViewMode === 'json' && !image.metadata.workflowJson) setRawViewMode('parsed');
    }, [image.metadata.workflowJson, rawViewMode]);

    const copyRawContent = async () => {
        if (!rawContent) return;
        await navigator.clipboard.writeText(rawContent);
        setCopiedMode(rawViewMode);
    };

    return (
        <div className="mt-4 pt-4 border-t border-gray-200 dark:border-white/5">
            <button onClick={() => setShowRaw(!showRaw)} className="flex items-center gap-2 text-gray-500 hover:text-gray-900 dark:hover:text-white text-xs py-2 transition-colors font-medium">
                <Code className="w-3 h-3" /> {showRaw ? "Hide" : "View"} Internal Metadata
            </button>

            {showRaw && (
                <div className="mt-2 p-3 bg-gray-50 dark:bg-black rounded-xl border border-gray-200 dark:border-white/10">
                    <div className="mb-2 flex items-center justify-between gap-2 border-b border-gray-200 pb-2 dark:border-white/10">
                        <div className="flex gap-2">
                            <button
                                onClick={() => setRawViewMode('parsed')}
                                className={`text-[10px] px-2 py-1 rounded transition-colors ${rawViewMode === 'parsed' ? 'bg-sage-100 dark:bg-sage-900/30 text-sage-600' : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-300'}`}
                            >
                                Parsed
                            </button>
                            <button
                                onClick={() => setRawViewMode('source')}
                                className={`text-[10px] px-2 py-1 rounded transition-colors ${rawViewMode === 'source' ? 'bg-sage-100 dark:bg-sage-900/30 text-sage-600' : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-300'}`}
                            >
                                Text
                            </button>
                            {image.metadata.workflowJson && (
                                <button
                                    onClick={() => setRawViewMode('json')}
                                    className={`text-[10px] px-2 py-1 rounded transition-colors ${rawViewMode === 'json' ? 'bg-sage-100 dark:bg-sage-900/30 text-sage-600' : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-300'}`}
                                >
                                    JSON
                                </button>
                            )}
                        </div>
                        <TooltipButton
                            label={copyLabel}
                            content={rawContent ? copyLabel : 'No metadata is available to copy'}
                            disabled={!rawContent}
                            onClick={() => void copyRawContent()}
                            className="rounded p-1 text-zinc-500 hover:bg-white/5 hover:text-zinc-300 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            {copiedMode === rawViewMode ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                        </TooltipButton>
                    </div>

                    <pre className="text-gray-600 dark:text-sage-500 text-[10px] overflow-x-auto whitespace-pre-wrap max-h-60 custom-scrollbar font-mono leading-relaxed">
                        {rawContent ?? 'No raw source available.'}
                    </pre>
                </div>
            )}
        </div>
    );
};
