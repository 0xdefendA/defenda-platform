import { ListFilter, Plus, Trash2 } from 'lucide-react';
import type { CriteriaRow, CriteriaOperator } from '../../lib/rules';

interface FilterBarProps {
    rows: CriteriaRow[];
    onRowsChange: (rows: CriteriaRow[]) => void;
    matchedCount: number;
    totalCount: number;
    /** datalist suggestions for the field input */
    suggestions: string[];
    /** noun for the "N of M" readout, e.g. "alerts" */
    itemsLabel: string;
    fieldPlaceholder?: string;
}

const OPERATORS: CriteriaOperator[] = ['=', '!=', 'contains', '>', '<', '>=', '<='];

/**
 * Client-side filter conditions (AND-joined) applied to a streamed record
 * list — shared by the alerts triage queue and the incidents list.
 */
export const FilterBar = ({
    rows, onRowsChange, matchedCount, totalCount, suggestions, itemsLabel, fieldPlaceholder,
}: FilterBarProps) => {
    const updateRow = (index: number, patch: Partial<CriteriaRow>) => {
        onRowsChange(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
    };

    const hasActive = rows.some(r => r.field.trim() && r.value.trim() !== '');
    const datalistId = `filter-field-suggestions-${itemsLabel}`;

    return (
        <div className="border-b border-thin border-border-color bg-surface px-4 py-2 flex flex-col gap-1.5">
            <div className="flex items-center gap-2 flex-wrap">
                <span className="flex items-center gap-1 text-[10px] font-display font-bold text-muted uppercase tracking-widest">
                    <ListFilter className="w-3.5 h-3.5" />
                    Filters
                </span>
                {rows.length === 0 && (
                    <button
                        onClick={() => onRowsChange([{ field: '', operator: '=', value: '' }])}
                        className="flex items-center gap-1 text-xs text-primary hover:underline font-medium"
                    >
                        <Plus className="w-3 h-3" /> Add condition
                    </button>
                )}
                {hasActive && (
                    <span className="ml-auto font-mono text-[11px] text-muted">
                        {matchedCount} of {totalCount} {itemsLabel}
                    </span>
                )}
            </div>

            {rows.map((row, i) => (
                <div key={i} className="flex items-center gap-2">
                    {i > 0 ? (
                        <span className="text-[10px] font-mono font-bold text-muted w-8 text-right">AND</span>
                    ) : (
                        <span className="w-8" />
                    )}
                    <input
                        list={datalistId}
                        value={row.field}
                        onChange={(e) => updateRow(i, { field: e.target.value })}
                        placeholder={fieldPlaceholder ?? 'field'}
                        className="flex-1 text-xs font-mono bg-background border border-border-color rounded px-2 py-1 text-text-main placeholder:text-muted/60"
                    />
                    <select
                        value={row.operator}
                        onChange={(e) => updateRow(i, { operator: e.target.value as CriteriaOperator })}
                        className="text-xs font-mono bg-background border border-border-color rounded px-2 py-1 text-text-main"
                    >
                        {OPERATORS.map(op => <option key={op} value={op}>{op}</option>)}
                    </select>
                    <input
                        value={row.value}
                        onChange={(e) => updateRow(i, { value: e.target.value })}
                        placeholder="value"
                        className="flex-1 text-xs font-mono bg-background border border-border-color rounded px-2 py-1 text-text-main placeholder:text-muted/60"
                    />
                    <button
                        onClick={() => onRowsChange(rows.filter((_, idx) => idx !== i))}
                        className="text-muted hover:text-accent"
                        title="Remove condition"
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>
                </div>
            ))}

            {rows.length > 0 && (
                <button
                    onClick={() => onRowsChange([...rows, { field: '', operator: '=', value: '' }])}
                    className="self-start flex items-center gap-1 text-xs text-primary hover:underline font-medium ml-10"
                >
                    <Plus className="w-3 h-3" /> Add condition
                </button>
            )}

            <datalist id={datalistId}>
                {suggestions.map(f => <option key={f} value={f} />)}
            </datalist>
        </div>
    );
};
