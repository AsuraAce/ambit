import { type AIImage, getEffectiveSourceKind } from '../types';
import type { DateFilterBounds } from './dateFilters';

export interface ImageCalendarParts {
    year: number;
    monthIndex: number;
    day: number;
}

export const getEffectiveDisplayTimestamp = (image: AIImage): number =>
    image.displayTimestamp ?? image.timestamp;

export const usesPhotoWallTime = (image: AIImage): boolean =>
    getEffectiveSourceKind(image) === 'photograph'
    && image.captureWallTimeMs !== undefined
    && image.captureWallTimeMs !== null;

export const getImageCalendarParts = (image: AIImage): ImageCalendarParts => {
    const date = new Date(getEffectiveDisplayTimestamp(image));
    if (usesPhotoWallTime(image)) {
        return {
            year: date.getUTCFullYear(),
            monthIndex: date.getUTCMonth(),
            day: date.getUTCDate(),
        };
    }

    return {
        year: date.getFullYear(),
        monthIndex: date.getMonth(),
        day: date.getDate(),
    };
};

export const getImageDayStart = (image: AIImage): number => {
    const parts = getImageCalendarParts(image);
    return new Date(parts.year, parts.monthIndex, parts.day).getTime();
};

export const formatImageDisplayDate = (
    image: AIImage,
    options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' }
): string => {
    const parts = getImageCalendarParts(image);
    return new Intl.DateTimeFormat(undefined, options).format(
        new Date(parts.year, parts.monthIndex, parts.day)
    );
};

export const toPhotoWallTimeBounds = (bounds: DateFilterBounds): DateFilterBounds => {
    const convert = (value: number | undefined): number | undefined => {
        if (value === undefined) return undefined;
        const date = new Date(value);
        return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
    };

    return {
        start: convert(bounds.start),
        end: convert(bounds.end),
    };
};

export const imageMatchesDateBounds = (image: AIImage, bounds: DateFilterBounds): boolean => {
    const effectiveBounds = usesPhotoWallTime(image) ? toPhotoWallTimeBounds(bounds) : bounds;
    const timestamp = getEffectiveDisplayTimestamp(image);
    if (effectiveBounds.start !== undefined && timestamp < effectiveBounds.start) return false;
    if (effectiveBounds.end !== undefined && timestamp >= effectiveBounds.end) return false;
    return true;
};
