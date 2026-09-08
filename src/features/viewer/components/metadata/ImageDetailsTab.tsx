import * as React from 'react';
import { Check, ImageIcon, Palette } from 'lucide-react';
import { getDetectedSourceKind, type AIImage, type Collection, type SourceKind } from '../../../../types';
import { CollectionMembershipPicker } from '../CollectionMembershipPicker';
import { AssetTechnicalDetails } from './AssetTechnicalDetails';
import { MetadataTextAreaField } from './MetadataTextAreaField';
import { MetadataSectionHeader } from './MetadataSectionHeader';

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
    const kindHelpId = React.useId();
    const extension = image.filename.split('.').pop()?.toUpperCase() || 'Unknown';
    const detectedSourceKind = getDetectedSourceKind(image);

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

            {onSetImageKind ? <section className="mt-6">
                <MetadataSectionHeader title="Image kind" icon={ImageIcon} />
                <select
                    aria-label="Image kind"
                    aria-describedby={kindHelpId}
                    value={image.sourceKindOverride ?? 'automatic'}
                    disabled={isKindSaving}
                    onChange={event => {
                        const value = event.target.value;
                        if (value === 'automatic' || value === 'generated' || value === 'photograph' || value === 'other') {
                            void saveImageKind(value === 'automatic' ? null : value);
                        }
                    }}
                    className="mt-2 w-full rounded-lg border border-gray-200 bg-white p-2 text-xs text-gray-900 outline-none focus:border-sage-500 disabled:opacity-60 dark:border-white/10 dark:bg-zinc-900 dark:text-white"
                >
                    <option value="automatic">Automatic ({detectedSourceKind === 'photograph' ? 'Photo' : detectedSourceKind === 'generated' ? 'Generated' : 'Other'})</option>
                    <option value="generated">Generated</option>
                    <option value="photograph">Photo</option>
                    <option value="other">Other</option>
                </select>
                <p id={kindHelpId} className="mt-2 text-[11px] leading-relaxed text-gray-400">Automatic follows metadata detection. Manual choices survive rescanning.</p>
            </section> : null}

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
