import { beforeEach, describe, expect, it, vi } from 'vitest';
import { insertImagesBatch } from '../../../services/db/imageRepo';
import { GeneratorTool } from '../../../types';
import { generateStressTestData } from '../dataGenerator';

vi.mock('../../../services/db/imageRepo', () => ({ insertImagesBatch: vi.fn() }));

const mockedInsertImagesBatch = vi.mocked(insertImagesBatch);

describe('generateStressTestData', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockedInsertImagesBatch.mockResolvedValue(undefined);
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
    });

    it('creates deterministic chunked records and reports cumulative progress', async () => {
        const randomValues = [0, 0.8, 0.99];
        let randomIndex = 0;
        vi.spyOn(Math, 'random').mockImplementation(() => randomValues[randomIndex++ % randomValues.length]);
        vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
        const onProgress = vi.fn();

        await generateStressTestData(1001, onProgress);

        expect(mockedInsertImagesBatch).toHaveBeenCalledTimes(2);
        const firstBatch = mockedInsertImagesBatch.mock.calls[0][0];
        const secondBatch = mockedInsertImagesBatch.mock.calls[1][0];
        expect(firstBatch).toHaveLength(1000);
        expect(secondBatch).toHaveLength(1);
        expect(firstBatch[0]).toMatchObject({
            id: expect.stringMatching(/^stress_test_0_/),
            url: expect.stringMatching(/^stress:\/\/stress_test_0_/),
            width: 1024,
            height: 1024,
            thumbnailUrl: '/branding/ambit-window-icon.png',
            metadata: {
                tool: GeneratorTool.AUTOMATIC1111,
                loras: [],
            },
        });
        expect(secondBatch[0].id).toMatch(/^stress_test_1000_/);
        expect(onProgress).toHaveBeenNthCalledWith(1, 1000, 1001);
        expect(onProgress).toHaveBeenNthCalledWith(2, 1001, 1001);
        expect(console.log).toHaveBeenCalledWith('[StressTest] Generated 1001 mock images.');
    });

    it('handles an empty request without inserts or a progress callback', async () => {
        await generateStressTestData(0);
        expect(mockedInsertImagesBatch).not.toHaveBeenCalled();
        expect(console.log).toHaveBeenCalledWith('[StressTest] Generated 0 mock images.');
    });

    it('generates records when progress reporting is omitted', async () => {
        vi.spyOn(Math, 'random').mockReturnValue(0);
        vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);

        await generateStressTestData(1);

        expect(mockedInsertImagesBatch).toHaveBeenCalledWith([expect.objectContaining({
            id: expect.stringMatching(/^stress_test_0_/),
        })]);
    });
});
