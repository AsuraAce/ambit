import * as React from 'react';
import { useEffect, useRef } from 'react';
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react';
import { ToastMessage } from '../../types';

interface ToastContainerProps {
  toasts: ToastMessage[];
  removeToast: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, removeToast }) => {
  return (
    <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[9999] flex flex-col items-center gap-3 pointer-events-none">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onRemove={() => removeToast(toast.id)} />
      ))}
    </div>
  );
};

const ToastItem: React.FC<{ toast: ToastMessage; onRemove: () => void }> = ({ toast, onRemove }) => {
  const onRemoveRef = useRef(onRemove);

  useEffect(() => {
    onRemoveRef.current = onRemove;
  }, [onRemove]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (onRemoveRef.current) {
        onRemoveRef.current();
      }
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

  const icons = {
    success: <CheckCircle className="w-4 h-4 text-emerald-400" />,
    error: <AlertCircle className="w-4 h-4 text-rose-400" />,
    info: <Info className="w-4 h-4 text-blue-400" />,
    warning: <AlertCircle className="w-4 h-4 text-amber-400" />
  };

  return (
    <div className="pointer-events-auto flex items-center gap-3 pl-4 pr-3 py-2.5 rounded-full border border-white/10 bg-zinc-900/80 backdrop-blur-md shadow-2xl text-white animate-in slide-in-from-bottom-4 zoom-in-95 duration-300 ease-spring transform transition-all hover:scale-105">
      <div className="shrink-0">
        {icons[toast.type]}
      </div>
      <span className="text-sm font-medium tracking-tight mr-1">{toast.message}</span>
      <button
        onClick={onRemove}
        className="p-1 rounded-full hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
