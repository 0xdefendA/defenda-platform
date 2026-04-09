import ReactMarkdown from 'react-markdown';
import { X, Copy } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface SummaryModalProps {
    isOpen: boolean;
    onClose: () => void;
    markdown: string;
}

export const SummaryModal = ({ isOpen, onClose, markdown }: SummaryModalProps) => {
    const copyToClipboard = () => {
        navigator.clipboard.writeText(markdown);
        alert('Copied to clipboard!');
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[100]"
                    />
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 20 }}
                        className="fixed top-[10%] left-[20%] right-[20%] bottom-[10%] bg-surface z-[110] rounded-2xl shadow-2xl flex flex-col border border-border"
                    >
                        <div className="h-14 border-b border-border flex items-center justify-between px-6 shrink-0">
                            <h2 className="font-heading font-bold text-lg">Incident Summary</h2>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={copyToClipboard}
                                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border text-xs font-bold hover:bg-muted transition-all"
                                >
                                    <Copy className="w-3 h-3" /> Copy
                                </button>
                                <button onClick={onClose} className="p-1 hover:bg-muted rounded-full transition-colors">
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                        </div>
                        <div className="flex-1 overflow-auto p-8 prose prose-sm max-w-none">
                            <ReactMarkdown>{markdown}</ReactMarkdown>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
};
