import { useQuery } from '@tanstack/react-query';
import { commands, ParameterRanges } from '../bindings';

/**
 * Hook to fetch parameter ranges for dynamic filter UI.
 * Returns min/max for numeric parameters and distinct values for categorical ones.
 * Only shows parameters that have actual data in the database.
 */
export function useParameterRangesQuery() {
    return useQuery<ParameterRanges>({
        queryKey: ['parameterRanges'],
        queryFn: async () => {
            const result = await commands.getParameterRanges();
            if (result.status === 'error') {
                throw new Error(result.error);
            }
            return result.data;
        },
        staleTime: 5 * 60 * 1000, // 5 minutes - ranges don't change often
        gcTime: 30 * 60 * 1000,   // 30 minutes cache
    });
}

