import * as React from 'react';
import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Play, Pause, ChevronLeft, ChevronRight, Shuffle, Clock, Maximize2, Info } from 'lucide-react';
import { AIImage } from '../../../types';
import { SmartImage } from '../../../features/library/components/SmartImage';

interface SlideshowModalProps {
  isOpen: boolean;
  images: AIImage[];
  initialIndex: number;
  onClose: () => void;
  isShuffleDefault?: boolean;
}

export const SlideshowModal: React.FC<SlideshowModalProps> = ({
  isOpen,
  images,
  initialIndex,
  onClose,
  isShuffleDefault = false
}) => {
  // Playback State
  const [isPlaying, setIsPlaying] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [isShuffle, setIsShuffle] = useState(isShuffleDefault);
  const [duration, setDuration] = useState(5000); // ms
  const nextIndexRef = useRef<number | null>(null);

  // UI State
  const [showHud, setShowHud] = useState(true);
  const [showInfo, setShowInfo] = useState(true);

  // Logic
  const hudTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shuffledIndicesRef = useRef<number[]>([]);

  // Generate shuffled order on mount or when shuffle toggled
  useEffect(() => {
    if (isShuffle) {
      const indices = images.map((_, i) => i);
      for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
      }
      shuffledIndicesRef.current = indices;
    }
  }, [isShuffle, images.length]);

  // Handle Mouse Movement to toggle HUD
  const handleMouseMove = () => {
    setShowHud(true);
    if (hudTimeoutRef.current) clearTimeout(hudTimeoutRef.current);
    hudTimeoutRef.current = setTimeout(() => setShowHud(false), 3500);
  };

  useEffect(() => {
    if (isOpen) {
      handleMouseMove();
    }
    return () => {
      if (hudTimeoutRef.current) clearTimeout(hudTimeoutRef.current);
    };
  }, [isOpen]);

  // Pre-calculate and Pre-load Next Image
  useEffect(() => {
    if (!isOpen || images.length <= 1) return;

    // Calculate next index
    let next: number;
    if (isShuffle) {
      next = Math.floor(Math.random() * images.length);
      if (next === currentIndex) next = (next + 1) % images.length;
    } else {
      next = (currentIndex + 1) % images.length;
    }
    nextIndexRef.current = next;

    // Pre-load
    const img = new Image();
    img.src = images[next].url;
  }, [currentIndex, isShuffle, images.length, isOpen]); // Stable images.length instead of images array

  // Navigation Logic
  const nextImage = useCallback(() => {
    if (nextIndexRef.current !== null) {
      setCurrentIndex(nextIndexRef.current);
    } else {
      // Fallback if ref isn't ready
      setCurrentIndex(prev => (prev + 1) % images.length);
    }
  }, [images.length]); // Stable: only depends on length

  const prevImage = useCallback(() => {
    setCurrentIndex(prev => {
      if (isShuffle) {
        const nextRandom = Math.floor(Math.random() * images.length);
        return nextRandom;
      }
      return prev === 0 ? images.length - 1 : prev - 1;
    });
  }, [images.length, isShuffle]);

  // Timer
  useEffect(() => {
    if (!isPlaying || !isOpen) return;

    const timer = setTimeout(() => {
      nextImage();
    }, duration);

    return () => clearTimeout(timer);
  }, [isPlaying, isOpen, duration, nextImage, currentIndex]);

  // Keyboard Support
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === ' ') { e.preventDefault(); setIsPlaying(p => !p); }
      if (e.key === 'ArrowRight') nextImage();
      if (e.key === 'ArrowLeft') prevImage();
      if (e.key === 'i') setShowInfo(p => !p);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, nextImage, prevImage]);

  if (!isOpen || !images[currentIndex]) return null;

  const currentImage = images[currentIndex];

  const getDurationLabel = (d: number) => {
    if (d === 3000) return '3s';
    if (d === 5000) return '5s';
    if (d === 10000) return '10s';
    return '30s';
  };

  const cycleDuration = () => {
    setDuration(d => {
      if (d === 3000) return 5000;
      if (d === 5000) return 10000;
      if (d === 10000) return 30000;
      return 3000;
    });
  };

  return (
    <div
      className={`fixed inset-0 z-[100] bg-black flex items-center justify-center overflow-hidden ${!showHud ? 'cursor-none' : ''}`}
      onMouseMove={handleMouseMove}
      onClick={() => setIsPlaying(p => !p)}
    >
      {/* Background Blur Ambience */}
      <div
        className="absolute inset-0 z-0 opacity-30 blur-3xl scale-110 pointer-events-none"
        style={{ backgroundImage: `url(${currentImage.url})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
      />

      {/* Main Image */}
      <SmartImage
        key={currentImage.id}
        src={currentImage.url}
        alt="slideshow"
        wrapperClassName="relative z-10 w-full h-full flex items-center justify-center pointer-events-none"
        imgClassName="max-w-full max-h-full object-contain shadow-2xl animate-in fade-in zoom-in-95 duration-700 ease-spring"
        objectFit="contain"
      />

      {/* Progress Bar */}
      {isPlaying && (
        <div
          key={`${currentIndex}-${duration}-${isPlaying}`}
          className="absolute top-0 left-0 h-1 bg-sage-500 z-50 transition-all ease-linear shadow-[0_0_10px_rgba(99,102,241,0.8)]"
          style={{
            width: '100%',
            transitionDuration: `${duration}ms`,
            transformOrigin: 'left',
            animation: `progress ${duration}ms linear forwards`
          }}
        >
          <style>{`
                @keyframes progress {
                    from { transform: scaleX(0); }
                    to { transform: scaleX(1); }
                }
              `}</style>
        </div>
      )}

      {/* Cinematic Info Bar */}
      {showInfo && (
        <div className={`absolute bottom-0 left-0 right-0 pt-44 pb-8 px-12 z-20 pointer-events-none bg-gradient-to-t from-black via-black/90 to-transparent transition-opacity duration-1000 ${showHud ? 'opacity-100' : 'opacity-0 md:opacity-100'}`}>
          <div className="max-w-5xl mx-auto text-center">
            <p className="text-xl md:text-2xl text-gray-200 font-medium leading-relaxed drop-shadow-lg line-clamp-3 text-balance font-serif tracking-wide">
              "{currentImage.metadata.positivePrompt}"
            </p>
            <div className="flex items-center justify-center gap-6 mt-6 text-sm font-bold text-gray-400 uppercase tracking-widest opacity-80">
              <span>{currentImage.metadata.model}</span>
              <span className="w-1 h-1 bg-gray-500 rounded-full" />
              <span>{new Date(currentImage.timestamp).toLocaleDateString()}</span>
            </div>
          </div>
        </div>
      )}

      {/* HUD Controls */}
      <div
        className={`absolute inset-0 pointer-events-none transition-opacity duration-300 ${showHud ? 'opacity-100' : 'opacity-0'}`}
      >
        <div className="absolute top-0 left-0 right-0 p-6 flex justify-end bg-gradient-to-b from-black/60 to-transparent pointer-events-auto z-50">
          <button onClick={onClose} className="p-3 hover:bg-white/10 rounded-full text-white/80 hover:text-white transition-colors">
            <X className="w-8 h-8" />
          </button>
        </div>

        {/* Floating Playback Controls - Moved to Top Center */}
        <div
          className="absolute top-8 left-1/2 -translate-x-1/2 flex items-center gap-6 bg-black/40 backdrop-blur-xl px-8 py-3 rounded-full border border-white/10 shadow-2xl pointer-events-auto hover:bg-black/60 transition-colors z-50"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => setIsShuffle(s => !s)}
            className={`p-2 rounded-full transition-colors ${isShuffle ? 'text-sage-400' : 'text-white/50 hover:text-white'}`}
            title="Shuffle Order"
          >
            <Shuffle className="w-5 h-5" />
          </button>

          <button onClick={prevImage} className="p-2 hover:bg-white/10 rounded-full text-white transition-colors">
            <ChevronLeft className="w-6 h-6" />
          </button>

          <button
            onClick={() => setIsPlaying(p => !p)}
            className="p-3 bg-white text-black hover:scale-105 transition-transform rounded-full shadow-lg shadow-white/20"
          >
            {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-1" />}
          </button>

          <button onClick={nextImage} className="p-2 hover:bg-white/10 rounded-full text-white transition-colors">
            <ChevronRight className="w-6 h-6" />
          </button>

          <button
            onClick={cycleDuration}
            className="flex items-center gap-1 text-xs font-mono text-white/70 hover:text-white w-12 justify-center"
            title="Toggle Duration"
          >
            <Clock className="w-3 h-3" />
            {getDurationLabel(duration)}
          </button>
        </div>
      </div>
    </div>
  );
};
