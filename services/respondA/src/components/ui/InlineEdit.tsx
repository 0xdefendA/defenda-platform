import React, { useState, useEffect, useRef } from 'react';
import { Check, X } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface InlineEditProps {
    value: string;
    onSave: (value: string) => void;
    onCancel: () => void;
    placeholder?: string;
    multiline?: boolean;
    className?: string;
}

export const InlineEdit: React.FC<InlineEditProps> = ({
    value,
    onSave,
    onCancel,
    placeholder,
    multiline = false,
    className
}) => {
    const [editValue, setEditValue] = useState(value);
    const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

    useEffect(() => {
        if (inputRef.current) {
            inputRef.current.focus();
            // Move cursor to end
            if ('selectionStart' in inputRef.current) {
                inputRef.current.selectionStart = inputRef.current.selectionEnd = editValue.length;
            }
        }
    }, []);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && (!multiline || e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            onSave(editValue);
        } else if (e.key === 'Escape') {
            onCancel();
        }
    };

    const inputClasses = cn(
        "w-full bg-muted/20 border border-border rounded-lg px-3 py-1 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all",
        className
    );

    return (
        <div className="flex items-start gap-2 w-full group">
            {multiline ? (
                <textarea
                    ref={inputRef as React.RefObject<HTMLTextAreaElement>}
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={placeholder}
                    className={cn(inputClasses, "min-h-[80px] resize-y")}
                />
            ) : (
                <input
                    ref={inputRef as React.RefObject<HTMLInputElement>}
                    type="text"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={placeholder}
                    className={inputClasses}
                />
            )}
            <div className="flex flex-col gap-1">
                <button
                    onClick={() => onSave(editValue)}
                    className="p-1 hover:bg-success/20 text-success rounded-md transition-colors"
                    title="Save"
                >
                    <Check size={16} />
                </button>
                <button
                    onClick={onCancel}
                    className="p-1 hover:bg-destructive/20 text-destructive rounded-md transition-colors"
                    title="Cancel"
                >
                    <X size={16} />
                </button>
            </div>
        </div>
    );
};
