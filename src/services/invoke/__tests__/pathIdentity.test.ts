import { describe, expect, it } from 'vitest';
import { isSameInvokePath } from '../pathIdentity';

describe('Invoke path identity', () => {
    it('treats Windows drive paths as case-insensitive identities', () => {
        expect(isSameInvokePath(
            'c:\\invoke\\databases\\invokeai.db',
            'C:/Invoke/databases/invokeai.db/'
        )).toBe(true);
        expect(isSameInvokePath('\\\\SERVER\\Invoke', '//server/invoke/')).toBe(true);
    });

    it('preserves case-sensitive identities for non-Windows paths', () => {
        expect(isSameInvokePath('/mnt/Invoke/invokeai.db', '/mnt/invoke/invokeai.db')).toBe(false);
    });
});
