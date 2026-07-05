import { useState } from 'react';
import { Plus } from 'lucide-react';
import type { JsonPath } from '../../lib/rules';
import { parseFieldPath, type EventColumn } from '../../lib/columns';

interface ColumnPickerProps {
    columns: EventColumn[];
    defaults: EventColumn[];
    onAddColumn: (path: JsonPath, label?: string) => void;
    placeholder?: string;
    tip?: string;
}

/** "+" header button: re-add removed defaults or add any field by path. */
export const ColumnPicker = ({ columns, defaults, onAddColumn, placeholder, tip }: ColumnPickerProps) => {
    const [open, setOpen] = useState(false);
    const [customPath, setCustomPath] = useState('');

    const missingDefaults = defaults.filter(d => !columns.some(c => c.id === d.id));

    const addCustom = () => {
        const path = parseFieldPath(customPath);
        if (!path) return;
        onAddColumn(path);
        setCustomPath('');
        setOpen(false);
    };

    return (
        <div className="relative">
            <button
                onClick={() => setOpen(o => !o)}
                title="Add column"
                className="p-1 rounded text-muted hover:text-primary hover:bg-primary/10 transition-colors"
            >
                <Plus className="w-4 h-4" />
            </button>
            {open && (
                <>
                    <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
                    <div className="absolute right-0 top-full mt-1 z-30 w-64 bg-surface border border-border-color rounded-lg shadow-xl p-2 flex flex-col gap-1 normal-case tracking-normal">
                        {missingDefaults.length > 0 && (
                            <>
                                <span className="text-[10px] font-display font-bold text-muted uppercase tracking-widest px-1">Defaults</span>
                                {missingDefaults.map(d => (
                                    <button
                                        key={d.id}
                                        onClick={() => { onAddColumn(d.path, d.label); setOpen(false); }}
                                        className="text-left text-xs font-mono text-text-main px-2 py-1 rounded hover:bg-row-hover"
                                    >
                                        {d.label}
                                    </button>
                                ))}
                            </>
                        )}
                        <span className="text-[10px] font-display font-bold text-muted uppercase tracking-widest px-1 mt-1">Field path</span>
                        <div className="flex gap-1">
                            <input
                                value={customPath}
                                onChange={(e) => setCustomPath(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && addCustom()}
                                placeholder={placeholder ?? 'details.sourceipaddress'}
                                className="flex-1 min-w-0 text-xs font-mono bg-background border border-border-color rounded px-2 py-1 text-text-main placeholder:text-muted/60"
                            />
                            <button
                                onClick={addCustom}
                                disabled={!parseFieldPath(customPath)}
                                className="text-xs font-bold text-white bg-primary rounded px-2 py-1 disabled:opacity-40"
                            >
                                Add
                            </button>
                        </div>
                        {tip && <span className="text-[10px] text-muted px-1">{tip}</span>}
                    </div>
                </>
            )}
        </div>
    );
};
