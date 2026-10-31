import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { InvokeOwnerDiscovery } from '../../../types';
import { inspectInvokeConnection, resolveInvokePaths } from '../../../services/invoke/connection';
import { getInvokePathIdentity } from '../../../services/invoke/pathIdentity';
import { isSameInvokeConnectionSource } from '../../../services/invoke/connectionDraft';

const getQueryKey = (rootPath: string) => [
    'invoke-owner-discovery',
    getInvokePathIdentity(resolveInvokePaths(rootPath.trim()).dbPath),
] as const;

export interface InvokeOwnerDiscoverySession {
    discovery?: InvokeOwnerDiscovery;
    inspect: (candidate?: string) => Promise<InvokeOwnerDiscovery>;
    invalidate: (nextRoot?: string) => void;
    reset: () => void;
    isInspecting: boolean;
    canUseAppliedDiscovery: boolean;
}

export class StaleInvokeOwnerDiscoveryRequestError extends Error {
    constructor() {
        super('The InvokeAI connection check was superseded.');
    }
}

export const isStaleInvokeOwnerDiscoveryRequestError = (error: unknown): error is StaleInvokeOwnerDiscoveryRequestError =>
    error instanceof StaleInvokeOwnerDiscoveryRequestError;

export const useInvokeOwnerDiscovery = (rootPath: string): InvokeOwnerDiscoverySession => {
    const queryClient = useQueryClient();
    const rootRef = React.useRef(rootPath.trim());
    const requestGenerationRef = React.useRef(0);
    const [testedSource, setTestedSource] = React.useState<string | null>(null);
    const [failedSource, setFailedSource] = React.useState<string | null>(null);
    const [canUseAppliedDiscovery, setCanUseAppliedDiscovery] = React.useState(true);
    const root = rootPath.trim();
    const query = useQuery({
        queryKey: getQueryKey(root || '__empty__'),
        queryFn: () => inspectInvokeConnection(root),
        enabled: false,
        retry: false,
    });

    React.useEffect(() => {
        rootRef.current = root;
    }, [root]);

    const invalidate = React.useCallback((nextRoot?: string) => {
        requestGenerationRef.current += 1;
        rootRef.current = nextRoot?.trim() ?? root;
        setTestedSource(null);
        setFailedSource(null);
        setCanUseAppliedDiscovery(false);
        void queryClient.invalidateQueries({ queryKey: ['invoke-owner-discovery'] });
    }, [queryClient, root]);

    const reset = React.useCallback(() => {
        invalidate();
        setCanUseAppliedDiscovery(true);
    }, [invalidate]);

    const inspect = React.useCallback(async (candidate = root): Promise<InvokeOwnerDiscovery> => {
        const requestGeneration = ++requestGenerationRef.current;
        rootRef.current = candidate.trim();
        setCanUseAppliedDiscovery(false);
        let discovery: InvokeOwnerDiscovery;
        try {
            discovery = await queryClient.fetchQuery({
                queryKey: getQueryKey(candidate),
                queryFn: () => inspectInvokeConnection(candidate),
                staleTime: 0,
            });
        } catch (error) {
            if (requestGeneration !== requestGenerationRef.current) throw new StaleInvokeOwnerDiscoveryRequestError();
            if (isSameInvokeConnectionSource(rootRef.current, candidate)) {
                setTestedSource(null);
                setFailedSource(candidate);
            }
            throw error;
        }
        if (requestGeneration !== requestGenerationRef.current
            || !isSameInvokeConnectionSource(rootRef.current, candidate)) {
            throw new StaleInvokeOwnerDiscoveryRequestError();
        }
        setTestedSource(candidate);
        setFailedSource(null);
        return discovery;
    }, [queryClient, root]);

    const hasFailedCurrentSource = !!failedSource && isSameInvokeConnectionSource(failedSource, root);

    return {
        discovery: !hasFailedCurrentSource && testedSource && isSameInvokeConnectionSource(testedSource, root) ? query.data : undefined,
        inspect,
        invalidate,
        reset,
        isInspecting: query.isFetching,
        canUseAppliedDiscovery,
    };
};
