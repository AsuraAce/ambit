
import * as React from 'react';
import { useEffect } from 'react';
import { AppSettings } from '../types';

export const useTheme = (theme: AppSettings['theme'], setSettings: React.Dispatch<React.SetStateAction<AppSettings>>) => {
  useEffect(() => {
    if (theme === 'dark') {
        document.documentElement.classList.add('dark');
    } else {
        document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  const toggleTheme = () => {
      setSettings(prev => ({
          ...prev,
          theme: prev.theme === 'dark' ? 'light' : 'dark'
      }));
  };

  return { toggleTheme };
};
