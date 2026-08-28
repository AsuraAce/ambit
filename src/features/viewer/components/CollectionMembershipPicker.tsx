import * as React from 'react';
import { Check, Folder, Layout, Plus, Search } from 'lucide-react';
import type { Collection } from '../../../types';
import { getCollectionsForImage } from '../../../services/db/collectionRepo';
import { useCollectionStore } from '../../../stores/collectionStore';
import { PrivacyAwareThumbnail } from '../../../components/ui/PrivacyAwareThumbnail';
import { CollectionThumbnailSkeleton } from '../../../components/ui/CollectionThumbnailSkeleton';
import { TooltipButton } from '../../../components/ui/InfoTooltip';
import { MetadataSectionHeader } from './metadata/MetadataSectionHeader';

interface CollectionMembershipPickerProps {
    assetId: string;
    collections: Collection[];
    onSetCollectionMembership: (assetId: string, collectionId: string, shouldBelong: boolean) => Promise<boolean>;
}

type MembershipLoadState = {
    assetId: string;
    status: 'loading' | 'ready' | 'error';
};

const membershipKeySeparator = '\u0000';

const retainRelevantMemberships = (
    memberships: Map<string, string[]>,
    activeAssetId: string,
    pendingKeys: Set<string>
): Map<string, string[]> => {
    const retainedAssetIds = new Set([activeAssetId]);
    pendingKeys.forEach(key => retainedAssetIds.add(key.split(membershipKeySeparator, 1)[0]));
    if (memberships.size <= retainedAssetIds.size
        && [...memberships.keys()].every(assetId => retainedAssetIds.has(assetId))) {
        return memberships;
    }

    const retained = new Map<string, string[]>();
    retainedAssetIds.forEach(assetId => {
        const assetMemberships = memberships.get(assetId);
        if (assetMemberships) retained.set(assetId, assetMemberships);
    });
    return retained;
};

const hasPendingMembershipForAsset = (pendingKeys: Set<string>, assetId: string): boolean => (
    [...pendingKeys].some(key => key.startsWith(`${assetId}${membershipKeySeparator}`))
);

export const CollectionMembershipPicker: React.FC<CollectionMembershipPickerProps> = ({
    assetId,
    collections,
    onSetCollectionMembership,
}) => {
    const [query, setQuery] = React.useState('');
    const [isSearchOpen, setIsSearchOpen] = React.useState(false);
    const searchInputRef = React.useRef<HTMLInputElement>(null);
    const listRef = React.useRef<HTMLDivElement>(null);
    const searchRegionId = React.useId();
    const [membershipsByAsset, setMembershipsByAsset] = React.useState<Map<string, string[]>>(
        () => new Map([[assetId, []]])
    );
    const [loadState, setLoadState] = React.useState<MembershipLoadState>({ assetId, status: 'loading' });
    const [retryToken, setRetryToken] = React.useState(0);
    const [pendingKeys, setPendingKeys] = React.useState<Set<string>>(() => new Set());
    const pendingKeysRef = React.useRef(new Set<string>());
    const activeAssetIdRef = React.useRef(assetId);
    const requestIdRef = React.useRef(0);
    const thumbnailHydrationPendingIds = useCollectionStore(state => state.thumbnailHydrationPendingIds) ?? {};

    const memberships = membershipsByAsset.get(assetId) ?? [];
    const isLoading = loadState.assetId !== assetId || loadState.status === 'loading';
    const hasError = loadState.assetId === assetId && loadState.status === 'error';
    const isReady = loadState.assetId === assetId && loadState.status === 'ready';
    const manualCollections = React.useMemo(
        () => collections.filter(collection => !collection.filters),
        [collections]
    );
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const membershipIds = React.useMemo(() => new Set(memberships), [memberships]);
    const memberCollections = manualCollections.filter(collection => membershipIds.has(collection.id));
    const otherCollections = manualCollections.filter(collection => !membershipIds.has(collection.id));
    const matchesQuery = (collection: Collection) => (
        !normalizedQuery || collection.name.toLocaleLowerCase().includes(normalizedQuery)
    );
    const visibleMemberCollections = memberCollections.filter(matchesQuery);
    const visibleOtherCollections = otherCollections.filter(matchesQuery);
    const hasVisibleCollections = visibleMemberCollections.length > 0 || visibleOtherCollections.length > 0;

    React.useEffect(() => {
        if (isSearchOpen) searchInputRef.current?.focus();
    }, [isSearchOpen]);

    React.useEffect(() => {
        if (listRef.current) listRef.current.scrollTop = 0;
    }, [isSearchOpen, query]);

    const closeSearch = () => {
        setIsSearchOpen(false);
        setQuery('');
    };

    const toggleSearch = () => {
        if (isSearchOpen) {
            closeSearch();
            return;
        }
        setIsSearchOpen(true);
    };

    React.useLayoutEffect(() => {
        activeAssetIdRef.current = assetId;
        setMembershipsByAsset(current => retainRelevantMemberships(
            current,
            assetId,
            pendingKeysRef.current
        ));
    }, [assetId]);

    React.useEffect(() => {
        let cancelled = false;
        const requestedAssetId = assetId;
        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;
        setLoadState({ assetId: requestedAssetId, status: 'loading' });

        void getCollectionsForImage(requestedAssetId)
            .then(collectionIds => {
                if (cancelled || requestIdRef.current !== requestId) return;
                setMembershipsByAsset(current => {
                    const next = new Map(retainRelevantMemberships(
                        current,
                        requestedAssetId,
                        pendingKeysRef.current
                    ));
                    next.set(requestedAssetId, collectionIds);
                    return next;
                });
                setLoadState({ assetId: requestedAssetId, status: 'ready' });
            })
            .catch(error => {
                console.error('[CollectionMembershipPicker] Failed to load collection membership', error);
                if (!cancelled && requestIdRef.current === requestId) {
                    setLoadState({ assetId: requestedAssetId, status: 'error' });
                }
            });

        return () => { cancelled = true; };
    }, [assetId, retryToken]);

    const toggleMembership = async (collectionId: string, wasMember: boolean) => {
        const membershipKey = `${assetId}${membershipKeySeparator}${collectionId}`;
        if (pendingKeysRef.current.has(membershipKey)) return;

        const requestedAssetId = assetId;
        const shouldBelong = !wasMember;
        pendingKeysRef.current.add(membershipKey);
        setPendingKeys(current => new Set(current).add(membershipKey));
        setMembershipsByAsset(current => {
            const currentMemberships = current.get(requestedAssetId) ?? [];
            const next = new Map(retainRelevantMemberships(
                current,
                activeAssetIdRef.current,
                pendingKeysRef.current
            ));
            next.set(requestedAssetId, shouldBelong
                ? (currentMemberships.includes(collectionId) ? currentMemberships : [...currentMemberships, collectionId])
                : currentMemberships.filter(id => id !== collectionId));
            return next;
        });

        let didPersist = false;
        try {
            didPersist = await onSetCollectionMembership(requestedAssetId, collectionId, shouldBelong);
        } catch {
            didPersist = false;
        }

        const settledMembership = didPersist ? shouldBelong : wasMember;
        pendingKeysRef.current.delete(membershipKey);
        setMembershipsByAsset(current => {
            const currentMemberships = current.get(requestedAssetId) ?? [];
            const next = new Map(retainRelevantMemberships(
                current,
                activeAssetIdRef.current,
                pendingKeysRef.current
            ));
            if (activeAssetIdRef.current === requestedAssetId
                || hasPendingMembershipForAsset(pendingKeysRef.current, requestedAssetId)) {
                next.set(requestedAssetId, settledMembership
                    ? (currentMemberships.includes(collectionId) ? currentMemberships : [...currentMemberships, collectionId])
                    : currentMemberships.filter(id => id !== collectionId));
            }
            return next;
        });

        if (activeAssetIdRef.current === requestedAssetId) {
            requestIdRef.current += 1;
            setLoadState({ assetId: requestedAssetId, status: 'ready' });
        }
        setPendingKeys(current => {
            const next = new Set(current);
            next.delete(membershipKey);
            return next;
        });
    };

    const renderCollection = (collection: Collection) => {
        const isMember = membershipIds.has(collection.id);
        const membershipKey = `${assetId}${membershipKeySeparator}${collection.id}`;
        const isPending = pendingKeys.has(membershipKey);
        const showThumbnailSkeleton = !!thumbnailHydrationPendingIds[collection.id] && !collection.thumbnail;

        return (
            <button
                type="button"
                key={collection.id}
                aria-pressed={isMember}
                aria-busy={isPending}
                disabled={!isReady || isPending}
                onClick={() => void toggleMembership(collection.id, isMember)}
                className={`group flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-500 disabled:cursor-wait disabled:opacity-70 ${isMember ? 'border-sage-300 bg-sage-100 dark:border-sage-400/50 dark:bg-sage-500/15' : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50 dark:border-white/5 dark:bg-zinc-800/50 dark:hover:bg-white/5'}`}
            >
                {collection.thumbnail ? (
                    <PrivacyAwareThumbnail
                        src={collection.thumbnail}
                        safeSrc={collection.safeThumbnail}
                        alt=""
                        isSensitive={collection.thumbnailIsSensitive}
                        wrapperClassName="h-10 w-10 shrink-0 rounded-lg"
                        imgClassName="h-full w-full rounded-lg border border-gray-200 object-cover shadow-sm dark:border-white/5"
                        fallback={<Folder className="h-5 w-5 text-gray-400" />}
                    />
                ) : showThumbnailSkeleton ? (
                    <CollectionThumbnailSkeleton className="h-10 w-10 shrink-0 rounded-lg" />
                ) : (
                    <span data-testid="collection-thumbnail-fallback" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-gray-100 dark:border-white/5 dark:bg-zinc-800" aria-hidden="true">
                        <Folder className="h-5 w-5 text-gray-400 dark:text-zinc-500" />
                    </span>
                )}
                <span className="min-w-0 flex-1 truncate font-medium text-gray-900 group-hover:text-sage-700 dark:text-gray-100 dark:group-hover:text-sage-300">{collection.name}</span>
                {isMember
                    ? <Check data-membership-indicator="selected" className="h-4 w-4 shrink-0 text-sage-600 dark:text-sage-300" aria-hidden="true" />
                    : <Plus className="h-4 w-4 shrink-0" aria-hidden="true" />}
            </button>
        );
    };

    return (
        <section className="mb-6">
            <MetadataSectionHeader
                title="Collections"
                icon={Layout}
                trailing={(
                    <TooltipButton
                        label="Search Collections"
                        content="Search Collections"
                        aria-expanded={isSearchOpen}
                        aria-controls={searchRegionId}
                        onClick={toggleSearch}
                        className={`rounded-lg border p-1.5 transition-colors ${isSearchOpen ? 'border-sage-200 bg-sage-50 text-sage-600 dark:border-sage-500/30 dark:bg-sage-900/40 dark:text-sage-300' : 'border-gray-200 bg-gray-50 text-gray-400 hover:text-gray-600 dark:border-white/5 dark:bg-white/5 dark:hover:text-gray-300'}`}
                    >
                        <Search className="h-3.5 w-3.5" aria-hidden="true" />
                    </TooltipButton>
                )}
                className="mb-3"
            />
            {isSearchOpen ? (
                <div id={searchRegionId} className="animate-in fade-in slide-in-from-top-1 mb-2 duration-150">
                    <label className="relative block">
                        <span className="sr-only">Find collection</span>
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
                        <input
                            ref={searchInputRef}
                            type="search"
                            aria-label="Find collection"
                            placeholder="Find collection..."
                            value={query}
                            onChange={event => setQuery(event.target.value)}
                            onKeyDown={event => {
                                if (event.key !== 'Escape') return;
                                event.preventDefault();
                                event.stopPropagation();
                                closeSearch();
                            }}
                            className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-xs text-gray-900 outline-none focus:border-sage-500 focus:ring-2 focus:ring-sage-500/20 dark:border-white/10 dark:bg-zinc-800/50 dark:text-white"
                        />
                    </label>
                </div>
            ) : null}
            <div ref={listRef} data-testid="collection-membership-list" className="custom-scrollbar relative max-h-60 min-h-12 space-y-3 overflow-y-auto pr-1">
                {isLoading && (
                    <div role="status" aria-label="Loading collection membership" className="absolute inset-0 z-10 flex items-center justify-center bg-white/50 backdrop-blur-[1px] dark:bg-zinc-900/50">
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-sage-500 border-t-transparent" />
                    </div>
                )}
                {hasError && (
                    <div role="alert" className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-white/90 px-4 text-center dark:bg-zinc-900/90">
                        <span className="text-xs text-gray-600 dark:text-gray-300">Could not load collection membership.</span>
                        <button type="button" onClick={() => setRetryToken(token => token + 1)} className="text-xs font-medium text-sage-700 hover:underline dark:text-sage-300">Retry</button>
                    </div>
                )}
                {!isLoading && !hasError && !hasVisibleCollections && (
                    <p className="px-3 py-4 text-center text-xs text-gray-500">
                        {manualCollections.length === 0 ? 'No collections available.' : 'No collections found.'}
                    </p>
                )}
                {visibleMemberCollections.length > 0 && (
                    <div className="space-y-2">
                        <p className="px-1 text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                            Member of ({memberCollections.length})
                        </p>
                        {visibleMemberCollections.map(renderCollection)}
                    </div>
                )}
                {visibleOtherCollections.length > 0 && (
                    <div className="space-y-2">
                        <p className="px-1 text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">{memberCollections.length > 0 ? 'Add to another collection' : 'Add to a collection'}</p>
                        {visibleOtherCollections.map(renderCollection)}
                    </div>
                )}
            </div>
        </section>
    );
};
