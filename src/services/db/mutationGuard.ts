export const assertMutationMatched = (
    result: { rowsAffected: number } | undefined,
    recordId: string,
    operation: string,
    subject: 'asset' | 'collection' = 'asset'
): void => {
    if (result?.rowsAffected === 0) {
        throw new Error(`${operation} failed because the ${subject} was not found: ${recordId}`);
    }
};
