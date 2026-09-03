import { Camera, FileImage, MapPin } from 'lucide-react';
import { type AIImage, getEffectiveSourceKind } from '../../../../types';

interface PhotoDetailsTabProps {
    image: AIImage;
}

interface PhotoDetailsSectionProps extends PhotoDetailsTabProps {
    includeFileDetails?: boolean;
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

const formatBytes = (bytes?: number): string | undefined => {
    if (!bytes) return undefined;
    const units = ['B', 'KB', 'MB', 'GB'];
    const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / (1024 ** exponent)).toLocaleString(undefined, { maximumFractionDigits: 1 })} ${units[exponent]}`;
};

const DetailRow = ({ label, value }: { label: string; value?: string | number }) => {
    if (value === undefined || value === null || value === '') return null;
    return (
        <div className="flex items-start justify-between gap-4 border-b border-gray-200/70 py-2.5 last:border-0 dark:border-white/5">
            <dt className="text-xs font-medium text-gray-500 dark:text-zinc-500">{label}</dt>
            <dd className="max-w-[65%] text-right text-sm text-gray-800 dark:text-zinc-200">{value}</dd>
        </div>
    );
};

export const PhotoDetailsSection = ({ image, includeFileDetails = false }: PhotoDetailsSectionProps) => {
    const sourceKind = getEffectiveSourceKind(image);
    const photo = image.photoMetadata;
    const isPhoto = sourceKind === 'photograph';

    return (
        <>
            <section>
                <div className="mb-3 flex items-center gap-2">
                    {isPhoto ? <Camera className="h-4 w-4 text-sage-500" /> : <FileImage className="h-4 w-4 text-sage-500" />}
                    <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">{isPhoto ? 'Capture details' : 'File details'}</h3>
                    {isPhoto ? <span className="rounded border border-gray-200 bg-gray-100 px-2 py-0.5 font-mono text-xs text-sage-700 dark:border-white/10 dark:bg-zinc-800 dark:text-sage-200">Photo</span> : null}
                    {isPhoto && photo?.cameraModel ? <span className="max-w-[180px] truncate rounded border border-gray-200 bg-gray-100 px-2 py-0.5 font-mono text-xs text-gray-600 dark:border-white/10 dark:bg-zinc-800 dark:text-gray-300">{photo.cameraModel}</span> : null}
                </div>
                <dl className="rounded-xl border border-gray-200 bg-white px-4 dark:border-white/10 dark:bg-zinc-800/40">
                    {isPhoto && <DetailRow label="Captured" value={formatCaptureTime(image)} />}
                    {isPhoto && <DetailRow label="Camera" value={[photo?.cameraMake, photo?.cameraModel].filter(Boolean).join(' ')} />}
                    {isPhoto && <DetailRow label="Lens" value={[photo?.lensMake, photo?.lensModel].filter(Boolean).join(' ')} />}
                    {isPhoto && <DetailRow label="Focal length" value={photo?.focalLengthMm ? `${photo.focalLengthMm} mm` : undefined} />}
                    {isPhoto && <DetailRow label="35mm equivalent" value={photo?.focalLength35Mm ? `${photo.focalLength35Mm} mm` : undefined} />}
                    {isPhoto && <DetailRow label="Aperture" value={photo?.apertureFNumber ? `f/${photo.apertureFNumber}` : undefined} />}
                    {isPhoto && <DetailRow label="Shutter" value={photo?.exposureTimeSeconds ? formatShutter(photo.exposureTimeSeconds) : undefined} />}
                    {isPhoto && <DetailRow label="ISO" value={photo?.iso ?? undefined} />}
                    {includeFileDetails && <DetailRow label="Dimensions" value={`${image.width} × ${image.height}`} />}
                    {includeFileDetails && <DetailRow label="File size" value={formatBytes(image.fileSize)} />}
                    {includeFileDetails && <DetailRow label="Modified" value={new Date(image.timestamp).toLocaleString()} />}
                    {isPhoto && <DetailRow label="Artist" value={photo?.artist ?? undefined} />}
                    {isPhoto && <DetailRow label="Copyright" value={photo?.copyright ?? undefined} />}
                </dl>
            </section>

            {isPhoto && photo?.gpsLatitude !== null && photo?.gpsLatitude !== undefined
                && photo.gpsLongitude !== null && photo.gpsLongitude !== undefined && (
                <details className="mt-6 rounded-xl border border-gray-200 bg-white px-4 py-3 dark:border-white/10 dark:bg-zinc-800/40">
                    <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-bold uppercase tracking-wider text-gray-500">
                        <MapPin className="h-4 w-4 text-sage-500" /> Local GPS coordinates
                    </summary>
                    <p className="mt-3 font-mono text-sm text-gray-700 dark:text-zinc-300">
                        {photo.gpsLatitude.toFixed(6)}, {photo.gpsLongitude.toFixed(6)}
                    </p>
                    <p className="mt-1 text-xs text-gray-400">Stored and displayed locally. No map or network request is made.</p>
                </details>
            )}
        </>
    );
};

export const PhotoDetailsTab = ({ image }: PhotoDetailsTabProps) => {
    return (
        <div className="flex-1 overflow-y-auto p-6 pb-10 custom-scrollbar animate-in fade-in duration-300">
            <PhotoDetailsSection image={image} includeFileDetails />
        </div>
    );
};
