import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    discoverA1111Candidates,
    getUnlinkedPriorityCandidatePaths
} from '../config';
import { A1111FolderType, type DiscoveryCandidate, WebUIVariant } from '../types';

const mocks = vi.hoisted(() => ({
    discoverA1111Folders: vi.fn()
}));

vi.mock('../../../bindings', () => ({
    commands: {
        discoverA1111Folders: mocks.discoverA1111Folders
    }
}));

describe('discoverA1111Candidates', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.discoverA1111Folders.mockResolvedValue({
            status: 'ok',
            data: {
                detectedVariant: WebUIVariant.A1111,
                candidates: [
                    {
                        path: 'D:\\SD\\outputs\\txt2img-images',
                        name: 'txt2img-images',
                        imageCount: 12,
                        inferredType: A1111FolderType.TXT2IMG,
                        isPriority: true,
                        variant: WebUIVariant.A1111
                    },
                    {
                        path: 'D:\\SD\\outputs\\custom',
                        name: 'custom',
                        imageCount: 4,
                        inferredType: A1111FolderType.UNKNOWN,
                        isPriority: false,
                        variant: WebUIVariant.UNKNOWN
                    }
                ],
                logs: ['[9:31:52 AM] backend log'],
                warnings: ['count cap reached']
            }
        });
    });

    it('maps backend candidates and marks already linked folders', async () => {
        const result = await discoverA1111Candidates(
            'D:/SD/outputs',
            new Set(['d:/sd/outputs/txt2img-images'])
        );

        expect(mocks.discoverA1111Folders).toHaveBeenCalledWith('D:/SD/outputs');
        expect(result.detectedVariant).toBe(WebUIVariant.A1111);
        expect(result.warnings).toEqual(['count cap reached']);
        expect(result.candidates[0]).toMatchObject({
            path: 'D:/SD/outputs/txt2img-images',
            inferredType: A1111FolderType.TXT2IMG,
            isAlreadyLinked: true,
            isPriority: true,
            variant: WebUIVariant.A1111
        });
        expect(result.candidates[1]).toMatchObject({
            path: 'D:/SD/outputs/custom',
            inferredType: A1111FolderType.UNKNOWN,
            isAlreadyLinked: false,
            isPriority: false,
            variant: WebUIVariant.UNKNOWN
        });
    });

    it('applies manual variant override without changing backend discovery', async () => {
        const result = await discoverA1111Candidates(
            'D:/SD/outputs',
            new Set(),
            WebUIVariant.FORGE
        );

        expect(result.detectedVariant).toBe(WebUIVariant.FORGE);
        expect(result.candidates.map(candidate => candidate.variant)).toEqual([
            WebUIVariant.FORGE,
            WebUIVariant.FORGE
        ]);
        expect(result.logs).toContain('[Info] Manual Override applied: Forced all candidates to Forge');
    });
});

describe('getUnlinkedPriorityCandidatePaths', () => {
    it('returns only unlinked priority candidates for auto-selection', () => {
        const candidates: DiscoveryCandidate[] = [
            {
                path: 'D:/SD/outputs/img2img-images',
                name: 'img2img-images',
                imageCount: 1,
                inferredType: A1111FolderType.IMG2IMG,
                isAlreadyLinked: false,
                isPriority: true,
                variant: WebUIVariant.A1111
            },
            {
                path: 'D:/SD/outputs/txt2img',
                name: 'txt2img',
                imageCount: 1,
                inferredType: A1111FolderType.TXT2IMG,
                isAlreadyLinked: true,
                isPriority: true,
                variant: WebUIVariant.A1111
            },
            {
                path: 'D:/SD/outputs/custom',
                name: 'custom',
                imageCount: 1,
                inferredType: A1111FolderType.UNKNOWN,
                isAlreadyLinked: false,
                isPriority: false,
                variant: WebUIVariant.A1111
            }
        ];

        expect(getUnlinkedPriorityCandidatePaths(candidates)).toEqual([
            'D:/SD/outputs/img2img-images'
        ]);
    });
});
