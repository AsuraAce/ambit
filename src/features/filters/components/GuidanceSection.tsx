import * as React from 'react';
import { FilterState } from '../../../types';
import { SectionHeader, SearchInput, IconButtonSelect } from './FilterPrimitives';
import { useParameterRangesQuery } from '../../../hooks/useParameterRangesQuery';
import {
    ChevronRight,
    Zap,
    Layers,
    User,
    Pencil,
    PenTool,
    Globe,
    Brush,
    LayoutGrid,
    Grid,
    Puzzle,
    Sparkles,
    Smile,
    Image as ImageIcon,
    Sun,
    Accessibility,
    HelpCircle
} from 'lucide-react';

interface GuidanceSectionProps {
    filters: FilterState;
    setFilters: (update: (prev: FilterState) => FilterState) => void;
    isOpen: boolean;
    onToggle: () => void;
}

const CONTROLNET_TYPES = [
    { id: 'canny', label: 'Canny', icon: Zap, keywords: ['canny'] },
    { id: 'depth', label: 'Depth', icon: Layers, keywords: ['depth', 'midas', 'leres', 'zoe'] },
    { id: 'pose', label: 'Pose', icon: Accessibility, keywords: ['pose', 'openpose'] },
    { id: 'scribble', label: 'Scribble', icon: Pencil, keywords: ['scribble', 'hed'] },
    { id: 'lineart', label: 'Lineart', icon: PenTool, keywords: ['lineart'] },
    { id: 'normal', label: 'Normal', icon: Globe, keywords: ['normal', 'bae'] },
    { id: 'inpaint', label: 'Inpaint', icon: Brush, keywords: ['inpaint'] },
    { id: 'tile', label: 'Tile', icon: LayoutGrid, keywords: ['tile'] },
    { id: 'mlsd', label: 'MLSD', icon: Grid, keywords: ['mlsd'] },
    { id: 'segmentation', label: 'Seg', icon: Puzzle, keywords: ['seg', 'segmentation', 'ade20k'] },
    { id: 'ip2p', label: 'Instruct', icon: Sparkles, keywords: ['ip2p', 'instruct'] },
];

const IPADAPTER_TYPES = [
    { id: 'faceid', label: 'FaceID', icon: Smile, keywords: ['faceid'] },
    { id: 'plus', label: 'Plus', icon: Zap, keywords: ['plus'] },
    { id: 'full-face', label: 'Full Face', icon: User, keywords: ['full-face', 'plus-face'] },
    { id: 'light', label: 'Light', icon: Sun, keywords: ['light'] },
    { id: 'standard', label: 'Standard', icon: ImageIcon, keywords: ['ip-adapter', 'adapter'] },
];

export const GuidanceSection: React.FC<GuidanceSectionProps> = ({
    filters,
    setFilters,
    isOpen,
    onToggle
}) => {
    const { data: ranges, isLoading } = useParameterRangesQuery(filters);
    const [expandedGroups, setExpandedGroups] = React.useState<Record<string, boolean>>({
        controlNets: true,
        ipAdapters: true
    });

    const toggleGroup = (group: string) => {
        setExpandedGroups(prev => ({ ...prev, [group]: !prev[group] }));
    };

    const hasControlNets = ranges?.controlNets && ranges.controlNets.length > 0;
    const hasIpAdapters = ranges?.ipAdapters && ranges.ipAdapters.length > 0;

    const hasAnyData = hasControlNets || hasIpAdapters;

    /**
     * Resolves a descriptive name from a potentially generic path.
     * e.g. "models/ip-adapter-plus/model.bin" -> "ip-adapter-plus"
     */
    const resolveDescriptiveName = (name: string): string => {
        const genericNames = new Set(['diffusion_pytorch_model', 'ip-adapter', 'controlnet', 'model', 'adapter', 'clip_vision', 'insightface', 'point_embedded']);
        let pathParts = name.split(/[\\/]/).map(p => p.trim()).filter(Boolean);
        let filename = pathParts.pop()?.replace(/\.(safetensors|ckpt|pth|bin|pt)$/i, '') || '';

        while (genericNames.has(filename.toLowerCase()) && pathParts.length > 0) {
            filename = pathParts.pop() || filename;
        }
        return filename;
    };

    // Generic type resolution helper
    const getModelType = (modelName: string, types: { id: string, keywords: string[] }[]): string | null => {
        // Use resolved descriptive name for matching to avoid missing keywords in generic filenames
        const descriptiveName = resolveDescriptiveName(modelName).toLowerCase();
        for (const type of types) {
            if (type.keywords.some(kw => descriptiveName.includes(kw))) {
                return type.id;
            }
        }
        return null;
    };

    // --- ControlNet Mapping ---
    const controlNetModelsByType = React.useMemo(() => {
        const mapping: Record<string, string[]> = { other: [] };
        (ranges?.controlNets || []).forEach(model => {
            const type = getModelType(model, CONTROLNET_TYPES);
            if (type) {
                if (!mapping[type]) mapping[type] = [];
                mapping[type].push(model);
            } else {
                mapping.other.push(model);
            }
        });
        return mapping;
    }, [ranges?.controlNets]);

    const activeControlNetTypes = React.useMemo(() => {
        const selected = filters.controlNets || [];
        const activeTypes = new Set<string>();
        selected.forEach(model => {
            const type = getModelType(model, CONTROLNET_TYPES);
            if (type) {
                activeTypes.add(type);
            } else if (controlNetModelsByType.other.includes(model)) {
                activeTypes.add('other');
            }
        });
        return Array.from(activeTypes);
    }, [filters.controlNets, controlNetModelsByType.other]);

    const availableControlNetOptions = React.useMemo(() => {
        const options = CONTROLNET_TYPES.filter(t => controlNetModelsByType[t.id])
            .map(t => ({ id: t.id, label: t.label, icon: t.icon }));

        if (controlNetModelsByType.other.length > 0) {
            options.push({ id: 'other', label: 'Other', icon: HelpCircle });
        }
        return options;
    }, [controlNetModelsByType]);

    const handleControlNetTypeToggle = (selectedTypes: string[]) => {
        const newModels: string[] = [];
        selectedTypes.forEach(typeId => {
            const models = controlNetModelsByType[typeId];
            if (models) newModels.push(...models);
        });
        setFilters(prev => ({ ...prev, controlNets: newModels }));
    };

    // --- IP-Adapter Mapping ---
    const ipAdapterModelsByType = React.useMemo(() => {
        const mapping: Record<string, string[]> = { other: [] };
        (ranges?.ipAdapters || []).forEach(model => {
            const type = getModelType(model, IPADAPTER_TYPES);
            if (type) {
                if (!mapping[type]) mapping[type] = [];
                mapping[type].push(model);
            } else {
                mapping.other.push(model);
            }
        });
        return mapping;
    }, [ranges?.ipAdapters]);

    const activeIpAdapterTypes = React.useMemo(() => {
        const selected = filters.ipAdapters || [];
        const activeTypes = new Set<string>();
        selected.forEach(model => {
            const type = getModelType(model, IPADAPTER_TYPES);
            if (type) {
                activeTypes.add(type);
            } else if (ipAdapterModelsByType.other.includes(model)) {
                activeTypes.add('other');
            }
        });
        return Array.from(activeTypes);
    }, [filters.ipAdapters, ipAdapterModelsByType.other]);

    const availableIpAdapterOptions = React.useMemo(() => {
        const options = IPADAPTER_TYPES.filter(t => ipAdapterModelsByType[t.id])
            .map(t => ({ id: t.id, label: t.label, icon: t.icon }));

        if (ipAdapterModelsByType.other.length > 0) {
            options.push({ id: 'other', label: 'Other', icon: HelpCircle });
        }
        return options;
    }, [ipAdapterModelsByType]);

    const handleIpAdapterTypeToggle = (selectedTypes: string[]) => {
        const newModels: string[] = [];
        selectedTypes.forEach(typeId => {
            const models = ipAdapterModelsByType[typeId];
            if (models) newModels.push(...models);
        });
        setFilters(prev => ({ ...prev, ipAdapters: newModels }));
    };

    if (!isOpen) {
        return (
            <div className="space-y-1">
                <SectionHeader title="Guidance" isOpen={isOpen} onToggle={onToggle} isLoading={isLoading} />
            </div>
        );
    }

    return (
        <div className="space-y-1">
            <SectionHeader title="Guidance" isOpen={isOpen} onToggle={onToggle} isLoading={isLoading} />
            <div className="space-y-6 animate-in slide-in-from-top-2 duration-300 ease-spring px-3 pt-2 pb-2">

                {hasControlNets && availableControlNetOptions.length > 0 && (
                    <div className="space-y-3">
                        <div
                            className="flex items-center justify-between px-1 cursor-pointer group"
                            onClick={() => toggleGroup('controlNets')}
                        >
                            <div className="text-[9px] font-bold text-gray-400 dark:text-zinc-500 uppercase tracking-widest flex items-center gap-1.5 group-hover:text-gray-600 dark:group-hover:text-zinc-300 transition-colors">
                                <ChevronRight className={`w-2.5 h-2.5 transition-transform duration-200 ${expandedGroups.controlNets ? 'rotate-90' : ''}`} />
                                ControlNets ({ranges.controlNets.length})
                            </div>
                        </div>
                        {expandedGroups.controlNets && (
                            <div className="animate-in fade-in slide-in-from-top-1 duration-200">
                                <IconButtonSelect
                                    options={availableControlNetOptions}
                                    selected={activeControlNetTypes}
                                    onChange={handleControlNetTypeToggle}
                                />
                            </div>
                        )}
                    </div>
                )}

                {hasIpAdapters && availableIpAdapterOptions.length > 0 && (
                    <div className="space-y-3">
                        <div
                            className="flex items-center justify-between px-1 cursor-pointer group"
                            onClick={() => toggleGroup('ipAdapters')}
                        >
                            <div className="text-[9px] font-bold text-gray-400 dark:text-zinc-500 uppercase tracking-widest flex items-center gap-1.5 group-hover:text-gray-600 dark:group-hover:text-zinc-300 transition-colors">
                                <ChevronRight className={`w-2.5 h-2.5 transition-transform duration-200 ${expandedGroups.ipAdapters ? 'rotate-90' : ''}`} />
                                IP-Adapters ({ranges.ipAdapters.length})
                            </div>
                        </div>
                        {expandedGroups.ipAdapters && (
                            <div className="animate-in fade-in slide-in-from-top-1 duration-200">
                                <IconButtonSelect
                                    options={availableIpAdapterOptions}
                                    selected={activeIpAdapterTypes}
                                    onChange={handleIpAdapterTypeToggle}
                                />
                            </div>
                        )}
                    </div>
                )}

                {!hasAnyData && !isLoading && (
                    <div className="text-[10px] text-gray-400 text-center py-3 italic border border-dashed border-gray-200 dark:border-white/10 rounded-xl">
                        No guidance data available
                    </div>
                )}
            </div>
        </div>
    );
};
