import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2 } from 'lucide-react';

/** Minimal success toast: const { toast, showToast } = useToast(); <Toast … /> */
export const useToast = () => {
    const [toast, setToast] = useState<string | null>(null);
    const showToast = useCallback((message: string) => setToast(message), []);
    const clearToast = useCallback(() => setToast(null), []);
    return { toast, showToast, clearToast };
};

interface ToastProps {
    message: string | null;
    onDismiss: () => void;
    durationMs?: number;
}

export const Toast = ({ message, onDismiss, durationMs = 4000 }: ToastProps) => {
    useEffect(() => {
        if (!message) return;
        const timer = setTimeout(onDismiss, durationMs);
        return () => clearTimeout(timer);
    }, [message, durationMs, onDismiss]);

    return (
        <AnimatePresence>
            {message && (
                <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 16 }}
                    transition={{ duration: 0.18 }}
                    onClick={onDismiss}
                    className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2 bg-surface border border-border-color rounded-lg shadow-xl px-4 py-2.5 cursor-pointer"
                    role="status"
                >
                    <CheckCircle2 className="w-4 h-4 text-success" />
                    <span className="text-xs font-medium text-text-main">{message}</span>
                </motion.div>
            )}
        </AnimatePresence>
    );
};
