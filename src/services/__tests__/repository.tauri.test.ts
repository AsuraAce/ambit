import { describe, expect, it, vi } from 'vitest';

vi.mock('../runtime', () => ({
    isTauriRuntime: () => true,
}));

describe('appRepository in Tauri', () => {
    it('selects filesystem persistence', async () => {
        const { appRepository } = await import('../repository');
        const { TauriFsRepository } = await import('../TauriFsRepository');

        expect(appRepository).toBeInstanceOf(TauriFsRepository);
    });
});
