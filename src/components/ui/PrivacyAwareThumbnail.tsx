import * as React from 'react';
import { EyeOff, ImageOff } from 'lucide-react';
import { SmartImage } from '../../features/library/components/SmartImage';
import { useSettingsStore } from '../../stores/settingsStore';

interface PrivacyAwareThumbnailProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt'> {
    src?: string | null;
    safeSrc?: string | null;
    alt: string;
    isSensitive?: boolean;
    wrapperClassName?: string;
    imgClassName?: string;
    placeholderClassName?: string;
    fallback?: React.ReactNode;
    objectFit?: 'cover' | 'contain' | 'fill' | 'none' | 'scale-down';
}

export const PrivacyAwareThumbnail: React.FC<PrivacyAwareThumbnailProps> = ({
    src,
    safeSrc,
    alt,
    isSensitive = false,
    wrapperClassName = '',
    imgClassName = 'w-full h-full object-cover',
    placeholderClassName = '',
    fallback,
    objectFit = 'cover',
    draggable = false,
    ...imgProps
}) => {
    const privacyEnabled = useSettingsStore(s => s.privacyEnabled);
    const maskingMode = useSettingsStore(s => s.settings.maskingMode);
    const privacyMaskIndexStatus = useSettingsStore(s => s.privacyMaskIndexStatus);

    if (privacyEnabled && privacyMaskIndexStatus !== 'ready') {
        return (
            <div
                className={`flex items-center justify-center bg-gray-100 dark:bg-white/5 text-gray-300 dark:text-gray-600 ${wrapperClassName} ${placeholderClassName}`}
                data-testid="privacy-thumbnail-placeholder"
            >
                {fallback || <ImageOff className="w-1/3 h-1/3" />}
            </div>
        );
    }

    const privacyActive = privacyEnabled && isSensitive;
    const resolvedSrc = privacyActive && safeSrc ? safeSrc : src;
    const shouldHide = privacyActive && !safeSrc && maskingMode === 'hide';
    const shouldBlur = privacyActive && !safeSrc && maskingMode === 'blur';

    if (!resolvedSrc || shouldHide) {
        return (
            <div className={`flex items-center justify-center bg-gray-100 dark:bg-white/5 text-gray-300 dark:text-gray-600 ${wrapperClassName} ${placeholderClassName}`}>
                {fallback || <ImageOff className="w-1/3 h-1/3" />}
            </div>
        );
    }

    return (
        <div className={`relative overflow-hidden ${wrapperClassName}`}>
            <SmartImage
                src={resolvedSrc}
                alt={alt}
                wrapperClassName="w-full h-full"
                imgClassName={`${imgClassName} ${shouldBlur ? 'blur-xl scale-110 opacity-60' : ''}`}
                objectFit={objectFit}
                draggable={draggable}
                {...imgProps}
            />
            {shouldBlur && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/10 backdrop-blur-[1px] text-white/80">
                    <EyeOff className="w-1/4 h-1/4 max-w-8 max-h-8 drop-shadow" />
                </div>
            )}
        </div>
    );
};
