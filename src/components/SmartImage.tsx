import * as React from 'react';
import { useState, useEffect, useRef } from 'react';
import { ImageOff, ImageIcon, AlertCircle } from 'lucide-react';
import { convertFileSrc } from '@tauri-apps/api/core';

interface SmartImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  alt: string;
  className?: string; // Backwards compatibility: acts as wrapper class
  wrapperClassName?: string; // Explicit wrapper class control
  imgClassName?: string; // Explicit img class control
  fallbackSrc?: string;
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
  objectFit = 'cover',
  ...props
}) => {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [retryCount, setRetryCount] = useState(0);
  const [currentSrc, setCurrentSrc] = useState(src);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (src !== currentSrc) {
      setCurrentSrc(src);
      setStatus('loading');
      setRetryCount(0);
    }
  }, [src]);

  const handleLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    setStatus('loaded');
    if (onLoad) onLoad(e);
  };

  // Fix: Check if image is already loaded from cache (common issue with re-mounts)
  React.useEffect(() => {
    if (imgRef.current && imgRef.current.complete) {
      if (imgRef.current.naturalWidth > 0) {
        setStatus('loaded');
      }
    }
  }, []);

  const handleError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    if (retryCount < 3) {
      setTimeout(() => {
        setRetryCount(c => c + 1);
      }, Math.pow(2, retryCount) * 500);
    } else if (fallbackSrc && currentSrc !== fallbackSrc) {
      console.warn('[SmartImage] Retries failed, switching to fallbackSrc:', fallbackSrc);
      setCurrentSrc(fallbackSrc);
      setRetryCount(0);
      setStatus('loading');
    } else {
      console.error('[SmartImage] Final failure for URL:', currentSrc);
      setStatus('error');
      if (onImageError) onImageError();
    }
    if (props.onError) props.onError(e);
  };

  const processedSrc = React.useMemo(() => {
    if (!currentSrc) return '';

    try {
      // Runtime Fix: Repair malformed asset URLs with mixed slashes
      if (currentSrc.startsWith('http://asset.localhost/')) {
        const rawPath = decodeURIComponent(currentSrc.replace('http://asset.localhost/', ''));
        // Normalize all backslashes to forward slashes
        const normalizedPath = rawPath.replace(/\\/g, '/');
        const finalUrl = convertFileSrc(normalizedPath);
        if (finalUrl.includes('undefined') || finalUrl.includes('null')) {
          console.error('[SmartImage] Path processing resulted in invalid URL:', { currentSrc, normalizedPath, finalUrl });
        }
        return finalUrl;
      }

      // Handle local paths that aren't yet converted
      if (!currentSrc.startsWith('http') && !currentSrc.startsWith('blob:') && !currentSrc.startsWith('data:') && !currentSrc.startsWith('asset:')) {
        const normalizedPath = currentSrc.replace(/\\/g, '/');
        const finalUrl = convertFileSrc(normalizedPath);
        return finalUrl;
      }
    } catch (e) {
      console.warn('[SmartImage] Error normalizing URL:', e, { currentSrc });
    }

    return currentSrc;
  }, [currentSrc]);

  const finalWrapperClass = wrapperClassName || className || '';
  const finalImgClass = imgClassName || `w-full h-full transition-all duration-700 ease-out transform ${status === 'loaded' ? 'opacity-100 scale-100' : 'opacity-0 scale-105'}`;

  // Allow empty src to be handled gracefully
  if (!src && !fallbackSrc) {
    return (
      <div className={`flex items-center justify-center bg-gray-100 dark:bg-white/5 text-gray-300 dark:text-gray-600 ${finalWrapperClass}`}>
        <ImageOff className="w-1/3 h-1/3" />
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden ${finalWrapperClass}`}>
      {status === 'loading' && (
        <div className="absolute inset-0 bg-gray-200 dark:bg-white/5 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/10 to-transparent -translate-x-full animate-shimmer" />
        </div>
      )}

      {status === 'error' ? (
        <div className="absolute inset-0 bg-gray-100 dark:bg-white/5 flex flex-col items-center justify-center text-gray-300 dark:text-gray-600 p-4 border border-gray-200 dark:border-white/5">
          <AlertCircle className="w-8 h-8 mb-2 opacity-50" />
          <span className="text-xs text-center font-medium">Failed to load</span>
        </div>
      ) : (
        <img
          key={`${currentSrc}-${retryCount}`}
          ref={imgRef}
          src={processedSrc}
          alt={alt}
          draggable="false"
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