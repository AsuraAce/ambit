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
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (!src) {
      setStatus('error');
      return;
    }
    // DEBUG: Inspect unsafe URLs
    console.log('SmartImage Loading:', src);

    setStatus('loading');
    // Reset retry count when src changes
    setRetryCount(0);
  }, [src]);

  // Effect for retrying image load
  useEffect(() => {
    if (status === 'loading' && retryCount > 0) {
      // Retry logic handled by onError triggering re-render if needed
    }
  }, [retryCount, status]);

  const handleLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    setStatus('loaded');
    if (onLoad) onLoad(e);
  };

  const handleError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    if (retryCount < 3) {
      // Exponential backoff for retries
      setTimeout(() => {
        setRetryCount(c => c + 1);
      }, Math.pow(2, retryCount) * 1000);
    } else {
      setStatus('error');
      if (onImageError) onImageError();
    }
    if (props.onError) props.onError(e);
  };

  const processedSrc = React.useMemo(() => {
    if (!src) return '';
    // Only convert if it's likely a local path (not http, blob, data, or asset)
    if (!src.startsWith('http') && !src.startsWith('blob:') && !src.startsWith('data:') && !src.startsWith('asset:')) {
      return convertFileSrc(src);
    }
    return src;
  }, [src]);

  const finalWrapperClass = wrapperClassName || className || '';
  // Default to w-full h-full if no specific img class provided (maintains existing grid behavior)
  const finalImgClass = imgClassName || `w-full h-full transition-opacity duration-300 ${status === 'loaded' ? 'opacity-100' : 'opacity-0'}`;

  if (!src && status === 'error') {
    return (
      <div className={`flex items-center justify-center bg-gray-100 dark:bg-white/5 text-gray-300 dark:text-gray-600 ${finalWrapperClass}`}>
        <ImageOff className="w-1/3 h-1/3" />
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden ${finalWrapperClass}`}>
      {status === 'loading' && (
        <div className="absolute inset-0 bg-gray-200 dark:bg-white/5 animate-pulse flex items-center justify-center">
          <ImageIcon className="w-8 h-8 text-gray-400 dark:text-gray-600 opacity-50" />
        </div>
      )}

      {status === 'error' ? (
        <div className="absolute inset-0 bg-gray-100 dark:bg-white/5 flex flex-col items-center justify-center text-gray-300 dark:text-gray-600 p-4 border border-gray-200 dark:border-white/5">
          <AlertCircle className="w-8 h-8 mb-2 opacity-50" />
          <span className="text-xs text-center font-medium">Failed to load</span>
        </div>
      ) : (
        <img
          ref={imgRef}
          src={processedSrc}
          alt={alt}
          draggable="false" // Disable inner drag so parent GridItem handles it cleanly
          onLoad={handleLoad}
          onError={handleError}
          style={{ objectFit }}
          className={finalImgClass}
          loading="lazy"
          decoding="async"
          {...props}
        />
      )}
    </div>
  );
};