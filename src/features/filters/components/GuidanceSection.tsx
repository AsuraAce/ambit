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
    HelpCircle,
    Shuffle,
    Palette,
    Box
} from 'lucide-react';

interface GuidanceSectionProps {
    filters: FilterState;
    setFilters: (update: (prev: FilterState) => FilterState) => void;
    isOpen: boolean;
    onToggle: () => void;
}

const CONTROLNET_TYPES = [
    { id: 'canny', label: 'Canny', icon: Zap },
    { id: 'depth', label: 'Depth', icon: Layers },
    { id: 'pose', label: 'Pose', icon: Accessibility },
    { id: 'scribble', label: 'Scribble', icon: Pencil },
    { id: 'lineart', label: 'Lineart', icon: PenTool },
    { id: 'normal', label: 'Normal', icon: Globe },
    { id: 'inpaint', label: 'Inpaint', icon: Brush },
    { id: 'tile', label: 'Tile', icon: LayoutGrid },
    { id: 'mlsd', label: 'MLSD', icon: Grid },
    { id: 'segmentation', label: 'Seg', icon: Puzzle },
    { id: 'ip2p', label: 'Instruct', icon: Sparkles },
    { id: 'shuffle', label: 'Shuffle', icon: Shuffle },
    { id: 'recolor', label: 'Recolor', icon: Palette },
];

const IPADAPTER_TYPES = [
    { id: 'faceid-plus', label: 'FaceID Plus', icon: Smile },
    { id: 'faceid', label: 'FaceID', icon: User },
    { id: 'plus-face', label: 'Plus Face', icon: Smile },
    { id: 'plus', label: 'Plus', icon: Zap },
    { id: 'portrait', label: 'Portrait', icon: User },
    { id: 'full-face', label: 'Full Face', icon: User },
    { id: 'light', label: 'Light', icon: Sun },
    { id: 'composition', label: 'Comp', icon: Box },
    { id: 'style', label: 'Style', icon: Palette },
    { id: 'standard', label: 'Standard', icon: ImageIcon },
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
            filename = pathParts.pop()!;
        }
        return filename;
    };

    // Guidance type resolution helper - now uses backend signatures
    const getModelType = (modelName: string): string | null => {
        // 1. Try backend classification first (Signatures/Subtypes)
        if (ranges?.guidanceSubtypes?.[modelName]) {
            return ranges.guidanceSubtypes[modelName];
        }

        // 2. Fallback to name resolution for new/unsaved items
        // This is still useful while the background harvester hasn't run yet
        const descriptiveName = resolveDescriptiveName(modelName).toLowerCase();

        const isIpAdapter = descriptiveName.includes('ip-adapter') || descriptiveName.includes('ipad_') || descriptiveName.includes('ip adapter') || descriptiveName.includes('ipadapter') || descriptiveName.includes('ipad');
        const hasStrongIpKeyword = descriptiveName.includes('faceid') || descriptiveName.includes('face-id') || descriptiveName.includes('portrait') || descriptiveName.includes('reference') || descriptiveName.includes('precise') || descriptiveName.includes('face') || descriptiveName.includes('plus');

        // Strong ControlNet indicators (subtypes)
        const hasStrongCnetKeyword = descriptiveName.includes('canny') || descriptiveName.includes('depth') || descriptiveName.includes('pose') ||
            descriptiveName.includes('scribble') || descriptiveName.includes('lineart') || descriptiveName.includes('softedge') ||
            descriptiveName.includes('soft_edge') || descriptiveName.includes('soft-edge') || descriptiveName.includes('normal') ||
            descriptiveName.includes('inpaint') || descriptiveName.includes('tile') || descriptiveName.includes('seg') ||
            descriptiveName.includes('shuffle') || descriptiveName.includes('recolor') || descriptiveName.includes('mlsd');

        const isControlnet = descriptiveName.includes('controlnet') || descriptiveName.includes('cnet') || descriptiveName.includes('control_');

        if (isIpAdapter || (hasStrongIpKeyword && !hasStrongCnetKeyword)) {
            if ((descriptiveName.includes('faceid') || descriptiveName.includes('face-id')) && descriptiveName.includes('plus')) {
                return 'faceid-plus';
            }
            if (descriptiveName.includes('faceid') || descriptiveName.includes('face-id') || descriptiveName.includes('insightface')) {
                return 'faceid';
            }
            if ((descriptiveName.includes('face') || descriptiveName.includes('full')) && descriptiveName.includes('plus')) {
                return 'plus-face';
            }
            if (descriptiveName.includes('portrait')) {
                return 'portrait';
            }
            if (descriptiveName.includes('plus') || descriptiveName.includes('vit-h') || descriptiveName.includes('precise') || descriptiveName.includes('reference')) {
                return 'plus';
            }
            if (descriptiveName.includes('style')) {
                return 'style';
            }
            if (descriptiveName.includes('composition')) {
                return 'composition';
            }
            if (descriptiveName.includes('light')) {
                return 'light';
            }
            if (descriptiveName.includes('full-face') || descriptiveName.includes('full face')) {
                return 'full-face';
            }
            return 'standard';
        }

        if (isControlnet || hasStrongCnetKeyword) {
            if (descriptiveName.includes('canny') || descriptiveName.includes('precise')) return 'canny';
            if (descriptiveName.includes('depth')) return 'depth';
            if (descriptiveName.includes('pose')) return 'pose';
            if (descriptiveName.includes('scribble') || descriptiveName.includes('softedge') || descriptiveName.includes('soft_edge') || descriptiveName.includes('soft-edge')) return 'scribble';
            if (descriptiveName.includes('lineart')) return 'lineart';
            if (descriptiveName.includes('normal')) return 'normal';
            if (descriptiveName.includes('inpaint')) return 'inpaint';
            if (descriptiveName.includes('tile')) return 'tile';
            if (descriptiveName.includes('seg')) return 'segmentation';
            if (descriptiveName.includes('shuffle')) return 'shuffle';
            if (descriptiveName.includes('recolor')) return 'recolor';
            if (descriptiveName.includes('mlsd')) return 'mlsd';
        }

        return null;
    };

    // --- ControlNet Mapping ---
    const controlNetModelsByType = React.useMemo(() => {
        const mapping: Record<string, string[]> = { other: [] };
        (ranges?.controlNets || []).forEach(model => {
            const type = getModelType(model);
            if (type && CONTROLNET_TYPES.some(t => t.id === type)) {
                if (!mapping[type]) mapping[type] = [];
                mapping[type].push(model);
            } else {
                mapping.other.push(model);
            }
        });
        return mapping;
    }, [ranges?.controlNets, ranges?.guidanceSubtypes]);

    const activeControlNetTypes = React.useMemo(() => {
        const selected = filters.controlNets;
        const activeTypes = new Set<string>();
        selected.forEach(model => {
            const type = getModelType(model);
            if (type && CONTROLNET_TYPES.some(t => t.id === type)) {
                activeTypes.add(type);
            } else if (controlNetModelsByType.other.includes(model)) {
                activeTypes.add('other');
            }
        });
        return Array.from(activeTypes);
    }, [filters.controlNets, controlNetModelsByType.other, ranges?.guidanceSubtypes]);


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
            newModels.push(...controlNetModelsByType[typeId]);
        });
        setFilters(prev => ({ ...prev, controlNets: newModels }));
    };

    // --- IP-Adapter Mapping ---
    const ipAdapterModelsByType = React.useMemo(() => {
        const mapping: Record<string, string[]> = { other: [] };
        (ranges?.ipAdapters || []).forEach(model => {
            const type = getModelType(model);
            if (type && IPADAPTER_TYPES.some(t => t.id === type)) {
                if (!mapping[type]) mapping[type] = [];
                mapping[type].push(model);
            } else {
                mapping.other.push(model);
            }
        });
        return mapping;
    }, [ranges?.ipAdapters, ranges?.guidanceSubtypes]);

    const activeIpAdapterTypes = React.useMemo(() => {
        const selected = filters.ipAdapters;
        const activeTypes = new Set<string>();
        selected.forEach(model => {
            const type = getModelType(model);
            if (type && IPADAPTER_TYPES.some(t => t.id === type)) {
                activeTypes.add(type);
            } else if (ipAdapterModelsByType.other.includes(model)) {
                activeTypes.add('other');
            }
        });
        return Array.from(activeTypes);
    }, [filters.ipAdapters, ipAdapterModelsByType.other, ranges?.guidanceSubtypes]);

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
            newModels.push(...ipAdapterModelsByType[typeId]);
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
