import * as React from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { ExternalLink, Heart, Pin, RotateCcw, RotateCw, Save, Trash2, X } from 'lucide-react';
import { commands } from '../../../bindings';
import { useCollectionStore } from '../../../stores/collectionStore';
import { VideoAsset } from '../../../types';
import { openFileInDefaultApp } from '../../../services/osOpen';
import { updateVideoPlaybackStatus } from '../../../services/db/imageRepo';
import { getCollectionsForImage } from '../../../services/db/collectionRepo';
import { unwrap } from '../../../utils/spectaUtils';
import { useToast } from '../../../hooks/useToast';
import { MaskedViewerGate } from './MaskedViewerGate';

interface VideoViewerProps {
    video: VideoAsset;
    isMasked: boolean;
    initiallyRevealed?: boolean;
    onClose: () => void;
    onNext: () => void;
    onPrev: () => void;
    onToggleFavorite: (id: string) => void;
    onTogglePin?: (id: string, isPinned: boolean) => void;
    onDelete?: (id: string) => void;
    onUpdateNotes?: (id: string, notes: string) => void;
    onSetCollectionMembership: (assetId: string, collectionId: string, shouldBelong: boolean) => Promise<boolean>;
}

export const VideoViewer: React.FC<VideoViewerProps> = ({
    video,
    isMasked,
    initiallyRevealed = false,
    onClose,
    onNext,
    onPrev,
    onToggleFavorite,
    onTogglePin,
    onDelete,
    onUpdateNotes,
    onSetCollectionMembership
}) => {
    const { addToast } = useToast();
    const collections = useCollectionStore(state => state.collections);
    const playerRef = React.useRef<HTMLVideoElement>(null);
    const activeVideoIdRef = React.useRef(video.id);
    const membershipRequestIdRef = React.useRef(0);
    const pendingMembershipKeysRef = React.useRef(new Set<string>());
    const [revealedVideoId, setRevealedVideoId] = React.useState<string | null>(
        initiallyRevealed ? video.id : null
    );
    const revealed = !isMasked || initiallyRevealed || revealedVideoId === video.id;
    const [playerKey, setPlayerKey] = React.useState(0);
    const [playbackStatus, setPlaybackStatus] = React.useState(video.playbackStatus);
    const [notes, setNotes] = React.useState(video.notes ?? '');
    const [membershipState, setMembershipState] = React.useState({
        videoId: video.id,
        collectionIds: new Set<string>()
    });
    const [membershipLoadState, setMembershipLoadState] = React.useState<{
        videoId: string;
        status: 'loading' | 'ready' | 'error';
    }>({ videoId: video.id, status: 'loading' });
    const [membershipRetryToken, setMembershipRetryToken] = React.useState(0);
    const [pendingMembershipKeys, setPendingMembershipKeys] = React.useState<Set<string>>(new Set());
    const [playbackUrl, setPlaybackUrl] = React.useState<string | null>(null);
    const membership = membershipState.videoId === video.id
        ? membershipState.collectionIds
        : new Set<string>();
    const isMembershipReady = membershipLoadState.videoId === video.id
        && membershipLoadState.status === 'ready';
    const hasMembershipError = membershipLoadState.videoId === video.id
        && membershipLoadState.status === 'error';

    React.useLayoutEffect(() => {
        activeVideoIdRef.current = video.id;
    }, [video.id]);

    React.useEffect(() => {
        setRevealedVideoId(initiallyRevealed ? video.id : null);
        setPlaybackStatus(video.playbackStatus);
        setNotes(video.notes ?? '');
        setPlaybackUrl(null);
    }, [video.id, video.notes, video.playbackStatus, initiallyRevealed]);

    React.useEffect(() => {
        let cancelled = false;
        const videoId = video.id;
        const requestId = membershipRequestIdRef.current + 1;
        membershipRequestIdRef.current = requestId;
        setMembershipLoadState({ videoId, status: 'loading' });
        setMembershipState({ videoId, collectionIds: new Set() });

        void getCollectionsForImage(videoId)
            .then(collectionIds => {
                if (!cancelled && membershipRequestIdRef.current === requestId) {
                    setMembershipState({ videoId, collectionIds: new Set(collectionIds) });
                    setMembershipLoadState({ videoId, status: 'ready' });
                }
            })
            .catch(error => {
                console.error('[VideoViewer] Failed to load collection membership', error);
                if (!cancelled && membershipRequestIdRef.current === requestId) {
                    setMembershipLoadState({ videoId, status: 'error' });
                }
            });

        return () => { cancelled = true; };
    }, [video.id, membershipRetryToken]);

    React.useEffect(() => {
        if (!revealed || video.isMissing) return;
        let cancelled = false;
        void unwrap(commands.prepareVideoPlayback(video.id))
            .then(path => {
                if (!cancelled) setPlaybackUrl(convertFileSrc(path));
            })
            .catch(error => {
                console.error('[VideoViewer] Failed to prepare scoped video playback', error);
                if (!cancelled) setPlaybackStatus('external_required');
            });
        return () => { cancelled = true; };
    }, [revealed, video.id, video.isMissing, playerKey]);

    const seekBy = React.useCallback((seconds: number) => {
        const player = playerRef.current;
        if (!player || !Number.isFinite(player.duration)) return;

        const currentTime = Number.isFinite(player.currentTime) ? player.currentTime : 0;
        player.currentTime = Math.min(player.duration, Math.max(0, currentTime + seconds));
    }, []);

    React.useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            const target = event.target;
            if (target instanceof HTMLElement && (
                target.matches('input, textarea, select') || target.isContentEditable
            )) return;

            if (event.key === 'Escape') onClose();
            else if (event.key === 'ArrowRight') onNext();
            else if (event.key === 'ArrowLeft') onPrev();
            else if (event.key.toLowerCase() === 'j') {
                event.preventDefault();
                seekBy(-10);
            } else if (event.key.toLowerCase() === 'l') {
                event.preventDefault();
                seekBy(10);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose, onNext, onPrev, seekBy]);

    const recordPlaybackStatus = (status: 'playable' | 'external_required') => {
        setPlaybackStatus(status);
        void updateVideoPlaybackStatus(video.id, status).catch(error => {
            console.error('[VideoViewer] Failed to persist playback status', error);
        });
    };

    const handleExport = async () => {
        try {
            const { open } = await import('@tauri-apps/plugin-dialog');
            const destination = await open({ directory: true, multiple: false });
            if (typeof destination !== 'string') return;
            const result = await unwrap(commands.exportAssetOriginal(video.id, destination));
            const displayPath = result.outputPath
                .replace(/^\/\/\?\/UNC\//i, '//')
                .replace(/^\/\/\?\//, '');
            addToast(`Exported ${displayPath}`, 'success');
        } catch (error) {
            addToast(`Could not export original: ${String(error)}`, 'error');
        }
    };

    const handleOpenExternal = async () => {
        const result = await openFileInDefaultApp(video.id);
        if (result.status === 'error') addToast(result.error, 'error');
    };

    if (!revealed && !video.isMissing) {
        return (
            <MaskedViewerGate
                filename={video.filename}
                mediaLabel="video"
                onReveal={() => setRevealedVideoId(video.id)}
                onClose={onClose}
            />
        );
    }

    return (
        <div role="dialog" aria-modal="true" aria-label={`Video viewer: ${video.filename}`} className="fixed inset-0 z-[100] flex bg-black text-white">
            <main className="relative flex min-w-0 flex-1 items-center justify-center bg-black">
                <div className="absolute left-4 top-4 z-20 rounded-lg bg-black/70 px-3 py-2 text-sm font-mono">{video.filename}</div>
                <div className="absolute right-4 top-4 z-20 flex gap-2">
                    {!video.isMissing && <button aria-label="Open in default app" onClick={() => void handleOpenExternal()} className="rounded-full bg-black/70 p-2.5 hover:bg-white/15"><ExternalLink className="h-5 w-5" /></button>}
                    {!video.isMissing && <button aria-label="Export original" onClick={() => void handleExport()} className="rounded-full bg-black/70 p-2.5 hover:bg-white/15"><Save className="h-5 w-5" /></button>}
                    <button aria-label={video.isFavorite ? 'Remove from favorites' : 'Add to favorites'} onClick={() => onToggleFavorite(video.id)} className="rounded-full bg-black/70 p-2.5 hover:bg-white/15"><Heart className={`h-5 w-5 ${video.isFavorite ? 'fill-red-500 text-red-500' : ''}`} /></button>
                    {onTogglePin && <button aria-label={video.isPinned ? 'Unpin' : 'Pin'} onClick={() => onTogglePin(video.id, !video.isPinned)} className="rounded-full bg-black/70 p-2.5 hover:bg-white/15"><Pin className={`h-5 w-5 ${video.isPinned ? 'fill-current text-sage-400' : ''}`} /></button>}
                    {onDelete && <button aria-label="Remove from library" onClick={() => onDelete(video.id)} className="rounded-full bg-black/70 p-2.5 hover:bg-red-500/20"><Trash2 className="h-5 w-5" /></button>}
                    <button aria-label="Close video viewer" onClick={onClose} className="rounded-full bg-black/70 p-2.5 hover:bg-white/15"><X className="h-5 w-5" /></button>
                </div>

                {video.isMissing ? (
                    <div className="flex max-w-md flex-col items-center rounded-2xl border border-red-500/30 bg-zinc-900 p-8 text-center shadow-2xl">
                        <h2 className="text-xl font-bold">Source file missing</h2>
                        <p className="mt-2 text-sm text-zinc-400">Ambit still keeps this library record. Restore the file at its original location or remove the record.</p>
                    </div>
                ) : playbackStatus === 'external_required' ? (
                    <div className="flex max-w-md flex-col items-center rounded-2xl border border-white/10 bg-zinc-900 p-8 text-center">
                        <h2 className="text-xl font-bold">Playback unavailable here</h2>
                        <p className="mt-2 text-sm text-zinc-400">The file is still in your library and can be opened with your default video app.</p>
                        <div className="mt-6 flex gap-3">
                            <button onClick={() => { setPlaybackStatus('unknown'); setPlaybackUrl(null); setPlayerKey(key => key + 1); }} className="flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2"><RotateCcw className="h-4 w-4" /> Retry</button>
                            <button onClick={() => void handleOpenExternal()} className="rounded-lg bg-sage-500 px-4 py-2 font-bold">Open externally</button>
                        </div>
                    </div>
                ) : playbackUrl ? (
                    <div className="flex w-full max-w-[calc(100vw-24rem)] flex-col items-center gap-4 px-6">
                        <video
                            key={`${video.id}:${playerKey}`}
                            ref={playerRef}
                            src={playbackUrl}
                            controls
                            muted
                            playsInline
                            preload="metadata"
                            onCanPlay={() => recordPlaybackStatus('playable')}
                            onError={() => recordPlaybackStatus('external_required')}
                            className="max-h-[calc(100vh-8rem)] max-w-full bg-black"
                        />
                        <div className="flex items-center gap-3 text-xs text-zinc-400">
                            <button type="button" aria-label="Back 10 seconds" onClick={() => seekBy(-10)} className="flex items-center gap-1.5 rounded border border-white/10 bg-zinc-900 px-2.5 py-1.5 text-white hover:bg-white/10">
                                <RotateCcw className="h-3.5 w-3.5" /> 10s
                            </button>
                            <label className="flex items-center gap-2">
                                Playback speed
                                <select defaultValue="1" onChange={event => { if (playerRef.current) playerRef.current.playbackRate = Number(event.target.value); }} className="rounded border border-white/10 bg-zinc-900 px-2 py-1 text-white">
                                    <option value="0.5">0.5×</option><option value="0.75">0.75×</option><option value="1">1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option>
                                </select>
                            </label>
                            <button type="button" aria-label="Forward 10 seconds" onClick={() => seekBy(10)} className="flex items-center gap-1.5 rounded border border-white/10 bg-zinc-900 px-2.5 py-1.5 text-white hover:bg-white/10">
                                10s <RotateCw className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    </div>
                ) : (
                    <div role="status" className="text-sm text-zinc-400">Preparing secure playback…</div>
                )}
            </main>

            <aside className="w-80 shrink-0 overflow-y-auto border-l border-white/10 bg-zinc-950 p-5">
                <h2 className="text-lg font-bold">Video details</h2>
                <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                    <dt className="text-zinc-500">Duration</dt><dd>{formatDuration(video.durationMs)}</dd>
                    <dt className="text-zinc-500">Dimensions</dt><dd>{video.width}×{video.height}</dd>
                    <dt className="text-zinc-500">Codec</dt><dd>{video.videoCodec}</dd>
                    <dt className="text-zinc-500">Container</dt><dd>{video.mediaContainer ?? 'Unknown'}</dd>
                    <dt className="text-zinc-500">Audio</dt><dd>{video.audioPresent ? (video.audioCodec ?? 'Present') : 'None'}</dd>
                </dl>

                <label className="mt-6 block text-xs font-bold text-zinc-400">Notes
                    <textarea value={notes} onChange={event => setNotes(event.target.value)} onBlur={() => onUpdateNotes?.(video.id, notes)} rows={5} className="mt-2 w-full rounded-lg border border-white/10 bg-black p-3 text-sm text-white" />
                </label>

                <fieldset className="mt-6">
                    <legend className="text-xs font-bold text-zinc-400">Collections</legend>
                    <div className="mt-2 space-y-2">
                        {hasMembershipError && (
                            <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
                                <p>Could not load collection membership.</p>
                                <button type="button" onClick={() => setMembershipRetryToken(token => token + 1)} className="mt-2 font-bold underline">Retry</button>
                            </div>
                        )}
                        {collections.filter(collection => !collection.filters).map(collection => {
                            const membershipKey = `${video.id}\u0000${collection.id}`;
                            const isPending = pendingMembershipKeys.has(membershipKey);
                            return (
                                <label key={collection.id} className="flex items-center gap-2 text-sm">
                                    <input type="checkbox" checked={membership.has(collection.id)} disabled={!isMembershipReady || isPending} onChange={async event => {
                                        const shouldBelong = event.target.checked;
                                        const videoId = video.id;
                                        if (pendingMembershipKeysRef.current.has(membershipKey)) return;
                                        pendingMembershipKeysRef.current.add(membershipKey);
                                        setPendingMembershipKeys(current => new Set(current).add(membershipKey));
                                        let didPersist = false;
                                        try {
                                            didPersist = await onSetCollectionMembership(videoId, collection.id, shouldBelong);
                                        } catch (error) {
                                            console.error('[VideoViewer] Failed to update collection membership', error);
                                        }
                                        if (didPersist && activeVideoIdRef.current === videoId) {
                                            membershipRequestIdRef.current += 1;
                                            setMembershipState(current => {
                                                if (current.videoId !== videoId) return current;
                                                const collectionIds = new Set(current.collectionIds);
                                                shouldBelong ? collectionIds.add(collection.id) : collectionIds.delete(collection.id);
                                                return { videoId, collectionIds };
                                            });
                                            setMembershipLoadState({ videoId, status: 'ready' });
                                        }
                                        pendingMembershipKeysRef.current.delete(membershipKey);
                                        setPendingMembershipKeys(current => {
                                            const next = new Set(current);
                                            next.delete(membershipKey);
                                            return next;
                                        });
                                    }} />
                                    {collection.name}
                                </label>
                            );
                        })}
                    </div>
                </fieldset>
            </aside>
        </div>
    );
};

const formatDuration = (durationMs: number): string => {
    const seconds = Math.max(0, Math.round(durationMs / 1000));
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
};
