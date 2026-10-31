export const throwIfInvokeAborted = (signal?: AbortSignal): void => {
    if (signal?.aborted) throw new Error('Aborted');
};
