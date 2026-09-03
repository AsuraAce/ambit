import * as React from 'react';
import { Check, ImageIcon, Palette } from 'lucide-react';
import { getDetectedSourceKind, getEffectiveSourceKind, type AIImage, type Collection, type SourceKind } from '../../../../types';
import { CollectionMembershipPicker } from '../CollectionMembershipPicker';
import { AssetTechnicalDetails } from './AssetTechnicalDetails';
import { MetadataTextAreaField } from './MetadataTextAreaField';
import { MetadataSectionHeader } from './MetadataSectionHeader';
import { PhotoDetailsSection } from './PhotoDetailsTab';

interface ImageDetailsTabProps {
    image: AIImage;
    collections: Collection[];
    notes: string;
    setNotes: (notes: string) => void;
    onUpdateNotes?: (id: string, notes: string) => void;
    onSetImageKind?: (id: string, sourceKindOverride: SourceKind | null) => void | Promise<void>;
    onSetCollectionMembership?: (assetId: string, collectionId: string, shouldBelong: boolean) => Promise<boolean>;
    palette: string[];
    isPaletteLoading: boolean;
}

const formatFileSize = (bytes?: number): string => {
    if (bytes === undefined) return 'Unknown';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const ImageDetailsTab: React.FC<ImageDetailsTabProps> = ({
    image,
    collections,
    notes,
    setNotes,
    onUpdateNotes,
    onSetImageKind,
    onSetCollectionMembership,
    palette,
    isPaletteLoading,
}) => {
    const [copiedColor, setCopiedColor] = React.useState<string | null>(null);
    const [isKindSaving, setIsKindSaving] = React.useState(false);
    const extension = image.filename.split('.').pop()?.toUpperCase() || 'Unknown';
    const detectedSourceKind = getDetectedSourceKind(image);
    const isPhoto = getEffectiveSourceKind(image) === 'photograph';

    const saveImageKind = async (sourceKindOverride: SourceKind | null) => {
        if (!onSetImageKind) return;
        setIsKindSaving(true);
        try {
            await onSetImageKind(image.id, sourceKindOverride);
        } finally {
            setIsKindSaving(false);
        }
    };

    return (
        <div className="custom-scrollbar h-full overflow-y-auto p-5">
            <AssetTechnicalDetails rows={[
                { label: 'Dimensions', value: `${image.width}×${image.height}` },
                { label: 'File type', value: extension },
                { label: 'File size', value: formatFileSize(image.fileSize) },
                { label: 'Date', value: new Date(image.timestamp).toLocaleDateString() },
            ]} />

            {isPhoto ? <section className="mt-6"><PhotoDetailsSection image={image} /></section> : null}

            {onSetImageKind ? <fieldset className="mt-6" disabled={isKindSaving}>
                <legend className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gray-500">
                    <ImageIcon className="h-4 w-4 text-sage-500" /> Image kind
                </legend>
                <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Image kind">
                    {([
                        { value: null, label: `Automatic (${detectedSourceKind === 'photograph' ? 'Photo' : detectedSourceKind === 'generated' ? 'Generated' : 'Other'})` },
                        { value: 'generated' as const, label: 'Generated' },
                        { value: 'photograph' as const, label: 'Photo' },
                        { value: 'other' as const, label: 'Other' },
                    ]).map(option => {
                        const checked = option.value === null
                            ? image.sourceKindOverride === undefined
                            : image.sourceKindOverride === option.value;
                        return <button
                            key={option.value ?? 'automatic'}
                            type="button"
                            role="radio"
                            aria-checked={checked}
                            disabled={isKindSaving}
                            onClick={() => { void saveImageKind(option.value); }}
                            className={`rounded-lg border px-3 py-2 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-500/50 disabled:opacity-60 ${checked ? 'border-sage-400 bg-sage-50 text-sage-800 dark:border-sage-500/60 dark:bg-sage-900/20 dark:text-sage-200' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-white/10 dark:bg-zinc-800/50 dark:text-gray-300 dark:hover:bg-white/5'}`}
                        >{option.label}</button>;
                    })}
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-gray-400">Automatic follows metadata detection. A manual choice is preserved when the image is rescanned.</p>
            </fieldset> : null}

            <section className="mt-6">
                <MetadataSectionHeader title="Color palette" icon={Palette} />
                {isPaletteLoading ? (
                    <div className="mt-3 flex gap-2 animate-pulse">
                        {[1, 2, 3, 4, 5].map(item => <div key={item} className="h-10 w-10 rounded-lg bg-gray-200 dark:bg-white/5" />)}
                    </div>
                ) : palette.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                        {palette.map(color => (
                            <button
                                type="button"
                                aria-label={`Copy Color ${color}`}
                                key={color}
                                onClick={() => {
                                    void navigator.clipboard.writeText(color);
                                    setCopiedColor(color);
                                    setTimeout(() => setCopiedColor(null), 1500);
                                }}
                                className="relative h-10 w-10 rounded-lg border border-white/10 shadow-sm transition-transform hover:scale-110"
                                style={{ backgroundColor: color }}
                            >
                                {copiedColor === color ? <Check className="absolute inset-0 m-auto h-4 w-4 text-white" /> : null}
                            </button>
                        ))}
                    </div>
                ) : <p className="mt-3 text-xs italic text-zinc-500">No palette extracted</p>}
            </section>

            <MetadataTextAreaField
                kind="notes"
                value={notes}
                onChange={event => setNotes(event.target.value)}
                onBlur={() => {
                    if (notes !== (image.notes ?? '')) onUpdateNotes?.(image.id, notes);
                }}
                readOnly={!onUpdateNotes}
                className="mt-6"
            />

            {onSetCollectionMembership ? <div className="mt-6">
                <CollectionMembershipPicker
                    assetId={image.id}
                    collections={collections}
                    onSetCollectionMembership={onSetCollectionMembership}
                />
            </div> : null}
        </div>
    );
};
