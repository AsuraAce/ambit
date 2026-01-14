import * as React from 'react';
import { createContext, useState, useCallback, ReactNode } from 'react';
import { ToastMessage } from '../types';
import { ToastContainer } from '../components/ui/Toast';

interface ToastContextType {
  addToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning', action?: { label: string; onClick: () => void }) => void;
  removeToast: (id: string) => void;
}

export const ToastContext = createContext<ToastContextType | undefined>(undefined);

const MAX_TOASTS = 5;
const DEDUPE_WINDOW = 1000; // 1 second

export const ToastProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const lastToastRef = React.useRef<{ message: string; timestamp: number } | null>(null);

  const addToast = useCallback((
    message: string,
    type: 'success' | 'error' | 'info' | 'warning' = 'info',
    action?: { label: string; onClick: () => void }
  ) => {
    // Deduplication check
    const now = Date.now();
    if (lastToastRef.current && lastToastRef.current.message === message && (now - lastToastRef.current.timestamp) < DEDUPE_WINDOW) {
      return;
    }
    lastToastRef.current = { message, timestamp: now };

    setToasts(prev => {
      const newToast: ToastMessage = { id: now.toString() + Math.random(), message, type, action };
      const nextToasts = [...prev, newToast];
      // Max stack limit
      return nextToasts.length > MAX_TOASTS ? nextToasts.slice(nextToasts.length - MAX_TOASTS) : nextToasts;
    });
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ addToast, removeToast }}>
      {children}
      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </ToastContext.Provider>
  );
};
