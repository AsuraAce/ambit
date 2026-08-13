import { normalizePath } from '../../utils/pathUtils';

const normalizeInvokePathIdentity = (path: string): string => {
    const isWindowsPath = /^[A-Za-z]:[\\/]/.test(path.trim())
        || /^[\\/]{2}/.test(path.trim());
    const normalized = normalizePath(path.trim()).replace(/\/+$/, '');
    return isWindowsPath ? normalized.toLowerCase() : normalized;
};

export const isSameInvokePath = (left: string, right: string): boolean =>
    normalizeInvokePathIdentity(left) === normalizeInvokePathIdentity(right);
