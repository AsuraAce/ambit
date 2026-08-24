import * as React from 'react';
import { Check, Palette } from 'lucide-react';
import type { AIImage, Collection } from '../../../../types';
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
    onSetCollectionMembership,
    palette,
    isPaletteLoading,
}) => {
    const [copiedColor, setCopiedColor] = React.useState<string | null>(null);
    const extension = image.filename.split('.').pop()?.toUpperCase() || 'Unknown';

    return (
        <div className="custom-scrollbar h-full overflow-y-auto p-5">
            <AssetTechnicalDetails rows={[
                { label: 'Dimensions', value: `${image.width}×${image.height}` },
                { label: 'File type', value: extension },
                { label: 'File size', value: formatFileSize(image.fileSize) },
                { label: 'Date', value: new Date(image.timestamp).toLocaleDateString() },
            ]} />

            <section className="mt-6">
                <MetadataSectionHeader title="Color palette" icon={Palette} />
                {isPaletteLoading ? (
                    <div className="mt-3 flex gap-2 animate-pulse">
                        {[1, 2, 3, 4, 5].map(item => <div key={item} className="h-10 w-10 rounded-lg bg-white/5" />)}
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
