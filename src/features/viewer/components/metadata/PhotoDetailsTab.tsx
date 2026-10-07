import { useState } from 'react';
import { Camera, Calendar, Aperture, FileQuestion, MapPin, User, Copyright } from 'lucide-react';
import { type AIImage, getEffectiveSourceKind } from '../../../../types';
import { MetadataField } from './MetadataField';
import { MetadataParameterList, type MetadataParameterRow } from './MetadataParameterList';
import { MetadataDisclosureSection } from './MetadataDisclosureSection';

interface PhotoDetailsTabProps {
    image: AIImage;
    isLoading?: boolean;
}

const formatCaptureTime = (image: AIImage): string | undefined => {
    const capture = image.photoMetadata?.capturedAt;
    if (!capture) return undefined;
    const local = capture.local.replace(
        /^(\d{4}):(\d{2}):(\d{2}) (\d{2}:\d{2}:\d{2})$/,
        '$1-$2-$3 $4'
    );
    const subsecond = capture.subsecond ? `.${capture.subsecond}` : '';
    return `${local}${subsecond}${capture.offset ? ` ${capture.offset}` : ''}`;
};

const formatShutter = (seconds: number): string => {
    if (seconds > 0 && seconds < 1) return `1/${Math.round(1 / seconds)} s`;
    return `${seconds.toLocaleString(undefined, { maximumFractionDigits: 3 })} s`;
};

export const PhotoDetailsTab = ({ image, isLoading = false }: PhotoDetailsTabProps) => {
    const [gpsExpanded, setGpsExpanded] = useState(false);
    const photo = image.photoMetadata;
    const isPhoto = getEffectiveSourceKind(image) === 'photograph';
    const cameraMake = photo?.cameraMake?.trim();
    const cameraModel = photo?.cameraModel?.trim();
    const modelIncludesMake = cameraMake && cameraModel && (
        cameraModel.toLowerCase() === cameraMake.toLowerCase()
        || cameraModel.toLowerCase().startsWith(`${cameraMake.toLowerCase()} `)
    );
    const cameraLabel = modelIncludesMake ? cameraModel : [cameraMake, cameraModel].filter(Boolean).join(' ');
    const fields = isPhoto ? [
        { label: 'Captured', icon: Calendar, value: formatCaptureTime(image) },
        { label: 'Camera', icon: Camera, value: cameraLabel },
        { label: 'Lens', icon: Aperture, value: [photo?.lensMake, photo?.lensModel].filter(Boolean).join(' ') },
    ].filter(field => field.value) : [];
    const rows: MetadataParameterRow[] = [];
    const addRow = (label: string, value?: string | number | null) => {
        if (value !== undefined && value !== null && value !== '') rows.push({ label, value: String(value) });
    };
    if (isPhoto) {
        addRow('Focal length', photo?.focalLengthMm ? `${photo.focalLengthMm} mm` : undefined);
        addRow('35mm equivalent', photo?.focalLength35Mm ? `${photo.focalLength35Mm} mm` : undefined);
        addRow('Aperture', photo?.apertureFNumber ? `f/${photo.apertureFNumber}` : undefined);
        addRow('Shutter', photo?.exposureTimeSeconds ? formatShutter(photo.exposureTimeSeconds) : undefined);
        addRow('ISO', photo?.iso);
    }
    const attribution = isPhoto ? [
        { label: 'Artist', icon: User, value: photo?.artist },
        { label: 'Copyright', icon: Copyright, value: photo?.copyright },
    ].filter(field => field.value) : [];
    const hasGps = isPhoto && photo?.gpsLatitude != null && photo.gpsLongitude != null;

    return (
        <div aria-busy={isLoading} className="custom-scrollbar h-full space-y-6 overflow-y-auto p-5">
            {fields.map(field => (
                <MetadataField key={field.label} label={field.label} icon={field.icon}>
                    <div className="w-full break-words rounded-lg border border-gray-200 bg-gray-50 p-2.5 text-sm font-medium text-gray-700 dark:border-white/10 dark:bg-black dark:text-zinc-200">{field.value}</div>
                </MetadataField>
            ))}
            <MetadataParameterList rows={rows} ariaLabel="Exposure settings" />
            {attribution.map(field => (
                <MetadataField key={field.label} label={field.label} icon={field.icon}>
                    <p className="break-words text-sm text-gray-700 dark:text-zinc-200">{field.value}</p>
                </MetadataField>
            ))}
            {hasGps ? (
                <MetadataDisclosureSection
                    title="Local GPS coordinates"
                    icon={MapPin}
                    expanded={gpsExpanded}
                    onExpandedChange={setGpsExpanded}
                >
                    <p className="font-mono text-xs text-gray-700 dark:text-zinc-300">
                        {photo.gpsLatitude!.toFixed(6)}, {photo.gpsLongitude!.toFixed(6)}
                    </p>
                    <p className="mt-1 text-xs text-gray-400">Stored and displayed locally. No map or network request is made.</p>
                </MetadataDisclosureSection>
            ) : null}
            {!isLoading && fields.length === 0 && rows.length === 0 && attribution.length === 0 && !hasGps ? (
                <div className="w-full rounded-xl border border-gray-200 bg-gray-50 px-5 py-8 text-center dark:border-white/10 dark:bg-zinc-900/50">
                    <FileQuestion className="mx-auto mb-3 h-8 w-8 text-gray-400 dark:text-zinc-500" aria-hidden="true" />
                    <h2 className="text-sm font-semibold text-gray-700 dark:text-zinc-200">No supported metadata found</h2>
                    <p className="mt-2 text-xs text-gray-500 dark:text-zinc-400">File information is available in Details.</p>
                </div>
            ) : null}
        </div>
    );
};
