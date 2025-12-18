import { useState, useEffect } from 'react';

export const usePalette = (imageUrl: string) => {
  const [palette, setPalette] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isActive = true;
    setIsLoading(true);

    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.src = imageUrl;

    img.onload = () => {
      if (!isActive) return;
      
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (ctx) {
            // Resize for faster processing
            canvas.width = 100; 
            canvas.height = 100;
            ctx.drawImage(img, 0, 0, 100, 100);
            
            const data = ctx.getImageData(0,0,100,100).data;
            const colors: Record<string,number> = {};
            
            // Sample pixels
            for(let i=0; i<data.length; i+=40) { // Step 10 pixels (4 bytes each)
                // Filter out transparent or very dark pixels
                if(data[i+3] < 128 || (data[i] < 20 && data[i+1] < 20 && data[i+2] < 20)) continue;
                
                // Quantize colors to reduce noise (bucket by 20s)
                const r = Math.round(data[i]/20)*20;
                const g = Math.round(data[i+1]/20)*20;
                const b = Math.round(data[i+2]/20)*20;
                
                const rgb = `${r},${g},${b}`;
                colors[rgb] = (colors[rgb]||0)+1;
            }
            
            const sorted = Object.entries(colors).sort((a,b) => b[1]-a[1]).slice(0,5);
            
            setPalette(sorted.map(([rgb]) => {
                const [r,g,b] = rgb.split(',');
                return `#${Number(r).toString(16).padStart(2,'0')}${Number(g).toString(16).padStart(2,'0')}${Number(b).toString(16).padStart(2,'0')}`;
            }));
        }
      } catch (e) {
        console.warn("Failed to extract palette", e);
      } finally {
        if (isActive) setIsLoading(false);
      }
    };

    img.onerror = () => {
        if (isActive) setIsLoading(false);
    };

    return () => { isActive = false; };
  }, [imageUrl]);

  return { palette, isLoading };
};