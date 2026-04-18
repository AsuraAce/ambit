import * as React from 'react';
import { useState, useEffect, useRef } from 'react';
import { ImageOff, AlertCircle } from 'lucide-react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { ensureAssetPathAccessible } from '../../../services/assetScope';
import { repairAssetUrl } from '../../../utils/pathUtils';

interface SmartImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  alt: string;
  className?: string; // Backwards compatibility: acts as wrapper class
  wrapperClassName?: string; // Explicit wrapper class control
  imgClassName?: string; // Explicit img class control
  fallbackSrc?: string;
  /** Base64 data URI for instant micro-preview (32px) */
  microSrc?: string;
  onImageError?: () => void;
  objectFit?: 'cover' | 'contain' | 'fill' | 'none' | 'scale-down';
}

export const SmartImage: React.FC<SmartImageProps> = ({
  src,
  alt,
  className,
  wrapperClassName,
  imgClassName,
  onLoad,
  draggable = false,
  onImageError,
  fallbackSrc,
  microSrc,
  objectFit = 'cover',
  ...props
}) => {
  // Use a ref to track the last source to avoid useEffect delays for loading state
  const lastSrcRef = useRef(src);
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [retryCount, setRetryCount] = useState(0);
  const [currentSrc, setCurrentSrc] = useState(src);
  const [showShimmer, setShowShimmer] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  // Sync state if src changes
  if (src !== lastSrcRef.current) {
    const isInitial = lastSrcRef.current === undefined;
    lastSrcRef.current = src;
    setCurrentSrc(src);
    // Only reset to loading if it's the very first load or if we were in an error state
    // We DON'T reset status to 'loading' if it was already 'loaded' to prevent flicker
    // instead we let the browser swap the src and handleLoad update it when ready.
    if (status === 'error' || isInitial) {
      setStatus('loading');
    }
    setRetryCount(0);
    setShowShimmer(false);
  }

  // Only show shimmer if loading takes more than 50ms AND no microSrc is available
  useEffect(() => {
    if (status === 'loading' && !microSrc) {
      const timer = setTimeout(() => setShowShimmer(true), 50);
      return () => clearTimeout(timer);
    }
  }, [status, currentSrc, microSrc]);

  useEffect(() => {
    void ensureAssetPathAccessible(currentSrc).catch((error) => {
      console.warn('[SmartImage] Failed to register current image path', error);
    });
  }, [currentSrc]);

  useEffect(() => {
    if (!fallbackSrc) return;

    void ensureAssetPathAccessible(fallbackSrc).catch((error) => {
      console.warn('[SmartImage] Failed to register fallback image path', error);
    });
  }, [fallbackSrc]);

  const handleLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    setStatus('loaded');
    if (onLoad) onLoad(e);
  };

  // Check if image is already loaded (cache)
  React.useEffect(() => {
    if (imgRef.current && imgRef.current.complete && imgRef.current.naturalWidth > 0) {
      setStatus('loaded');
    }
  }, [currentSrc]);

  const handleError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    if (retryCount < 3) {
      setTimeout(() => {
        setRetryCount(c => c + 1);
      }, Math.pow(2, retryCount) * 500);
    } else if (fallbackSrc && currentSrc !== fallbackSrc) {
      // Make sure release builds have scope access before switching to the source image.
      void ensureAssetPathAccessible(fallbackSrc)
        .catch((error) => {
          console.warn('[SmartImage] Failed to register fallback before swap', error);
        })
        .finally(() => {
          setCurrentSrc(fallbackSrc);
          setRetryCount(0);
          setStatus('loading');
          setShowShimmer(false);
        });
    } else {
      setStatus('error');
      if (onImageError) onImageError();
    }
    if (props.onError) props.onError(e);
  };

  const processedSrc = React.useMemo(() => {
    if (!currentSrc) return '';

    let result = currentSrc;

    try {
      // If it's already an asset URL, use it directly to avoid double-encoding
      if (currentSrc.startsWith('http://asset.localhost/') || currentSrc.startsWith('asset:')) {
        result = repairAssetUrl(currentSrc);
      }
      // Handle local paths that aren't yet converted
      else if (!currentSrc.startsWith('http') && !currentSrc.startsWith('blob:') && !currentSrc.startsWith('data:')) {
        // Normalize slashes but DO NOT encode them before convertFileSrc
        const normalizedPath = currentSrc.replace(/\\/g, '/');
        const url = convertFileSrc(normalizedPath);
        result = repairAssetUrl(url);
      }
    } catch (e) {
      console.warn('[SmartImage] Error normalizing URL:', e, { currentSrc });
    }

    // Add cache-buster when retrying to force browser to reload
    if (retryCount > 0 && result && !result.includes('?')) {
      result = `${result}?retry=${retryCount}`;
    } else if (retryCount > 0 && result) {
      result = `${result}&retry=${retryCount}`;
    }

    return result;
  }, [currentSrc, retryCount]);

  const finalWrapperClass = wrapperClassName || className || '';
  const loadingClasses = `transition-all duration-500 ease-out ${status === 'loaded' ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`;
  const finalImgClass = `${imgClassName || 'w-full h-full'} ${loadingClasses}`;

  // Extract filename for display in error state
  const displayFilename = React.useMemo(() => {
    try {
      const path = currentSrc.startsWith('http') ? decodeURIComponent(currentSrc.split('/').pop() || '') : currentSrc.split(/[\\/]/).pop();
      return path || 'Unknown Image';
    } catch {
      return 'Unknown Image';
    }
  }, [currentSrc]);

  if (!src && !fallbackSrc) {
    return (
      <div className={`flex items-center justify-center bg-gray-100 dark:bg-white/5 text-gray-300 dark:text-gray-600 ${finalWrapperClass}`}>
        <ImageOff className="w-1/3 h-1/3" />
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden ${finalWrapperClass}`}>
      {/* Micro-thumbnail: Instant blurred preview while main image loads */}
      {microSrc && status === 'loading' && (
        <img
          src={microSrc}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 w-full h-full blur-sm scale-110"
          style={{ objectFit }}
        />
      )}

      {/* Shimmer fallback: Only show if no microSrc and loading takes time */}
      {status === 'loading' && showShimmer && !microSrc && (
        <div className="absolute inset-0 bg-gray-200 dark:bg-white/5 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/10 to-transparent -translate-x-full animate-shimmer" />
        </div>
      )}

      {status === 'error' ? (
        <div className="absolute inset-0 bg-gray-100 dark:bg-zinc-900 flex flex-col items-center justify-center text-gray-400 dark:text-gray-600 p-4 border border-gray-200 dark:border-white/5">
          <AlertCircle className="w-8 h-8 mb-2 opacity-50 text-red-500/50" />
          <span className="text-xs text-center font-medium">Failed to load</span>
          <span className="text-[10px] text-center opacity-70 mt-1 truncate max-w-full font-mono">{displayFilename}</span>
        </div>
      ) : (
        <img
          // Removed key={`${currentSrc}-${retryCount}`} to prevent remounting the img element
          // This allows the browser to keep the old image visible while the new one loads,
          // preventing a flicker. The src attribute change itself triggers the load.
          ref={imgRef}
          src={processedSrc}
          alt={alt}
          draggable={draggable}
          onLoad={handleLoad}
          onError={handleError}
          style={{ objectFit }}
          className={finalImgClass}
          decoding="async"
          {...props}
        />
      )}
    </div>
  );
};
