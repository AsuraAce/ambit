import React, { useState } from 'react';
import { Code } from 'lucide-react';
import { AIImage } from '../../../../types';

interface MetadataRawInspectorProps {
    image: AIImage;
}

export const MetadataRawInspector = ({ image }: MetadataRawInspectorProps) => {
    const [showRaw, setShowRaw] = useState(false);
    const [rawViewMode, setRawViewMode] = useState<'parsed' | 'source' | 'json'>('parsed');

    const renderRawContent = () => {
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
        return image.metadata.rawParameters || "No raw source available.";
    };

    return (
        <div className="mt-4 pt-4 border-t border-gray-200 dark:border-white/5">
            <button onClick={() => setShowRaw(!showRaw)} className="flex items-center gap-2 text-gray-500 hover:text-gray-900 dark:hover:text-white text-xs py-2 transition-colors font-medium">
                <Code className="w-3 h-3" /> {showRaw ? "Hide" : "View"} Internal Metadata
            </button>

            {showRaw && (
                <div className="mt-2 p-3 bg-gray-50 dark:bg-black rounded-xl border border-gray-200 dark:border-white/10">
                    <div className="flex gap-2 mb-2 pb-2 border-b border-gray-200 dark:border-white/10">
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

                    <pre className="text-gray-600 dark:text-sage-500 text-[10px] overflow-x-auto whitespace-pre-wrap max-h-60 custom-scrollbar font-mono leading-relaxed">
                        {renderRawContent()}
                    </pre>
                </div>
            )}
        </div>
    );
};
