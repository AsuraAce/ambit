import * as React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, Trash2, X } from 'lucide-react';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  isDangerous?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  zIndex?: number;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  message,
  confirmLabel = "Confirm",
  isDangerous = false,
  onConfirm,
  onCancel,
  zIndex = 60
}) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          style={{ zIndex }}
          className="fixed inset-0 flex items-center justify-center p-4 bg-slate-950/40 backdrop-blur-md"
        >
          {/* Overlay click to cancel */}
          <div className="absolute inset-0" onClick={onCancel} />

          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 30 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className="relative w-full max-w-sm bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl border border-gray-200/50 dark:border-white/10 rounded-3xl shadow-[0_32px_64px_-12px_rgba(0,0,0,0.5)] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header / Accent Bar */}
            <div className={`h-1.5 w-full ${isDangerous ? 'bg-gradient-to-r from-red-500 to-rose-600' : 'bg-gradient-to-r from-sage-500 to-emerald-600'}`} />

            <div className="p-8">
              <div className="flex flex-col items-center text-center">
                <div className={`p-4 rounded-2xl mb-6 shadow-xl ${isDangerous
                    ? 'bg-red-50 dark:bg-red-500/10 text-red-500'
                    : 'bg-sage-50 dark:bg-sage-500/10 text-sage-600 dark:text-sage-400'
                  }`}>
                  {isDangerous ? <Trash2 className="w-8 h-8" /> : <AlertTriangle className="w-8 h-8" />}
                </div>

                <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2 tracking-tight">
                  {title}
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed max-w-[240px]">
                  {message}
                </p>
              </div>

              <div className="mt-10 flex flex-col gap-3">
                <button
                  onClick={onConfirm}
                  className={`w-full py-3.5 px-6 text-sm font-bold text-white rounded-2xl shadow-lg transition-all active:scale-[0.98] ${isDangerous
                      ? 'bg-gradient-to-br from-red-500 to-rose-600 hover:shadow-red-500/40'
                      : 'bg-gradient-to-br from-sage-500 to-emerald-600 hover:shadow-sage-500/40'
                    }`}
                >
                  {confirmLabel}
                </button>
                <button
                  onClick={onCancel}
                  className="w-full py-3 px-6 text-sm font-semibold text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-white transition-colors rounded-2xl flex items-center justify-center gap-2"
                >
                  Cancel
                </button>
              </div>
            </div>

            {/* Close Button Top Right */}
            <button
              onClick={onCancel}
              className="absolute top-4 right-4 p-2 text-gray-400 hover:text-gray-600 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 rounded-full transition-all"
            >
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
