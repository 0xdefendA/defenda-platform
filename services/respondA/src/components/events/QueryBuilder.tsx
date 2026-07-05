import { Plus, Trash2, Play, Loader2 } from 'lucide-react';
import type { CriteriaRow, CriteriaOperator } from '../../lib/rules';
import { compileCriteria } from '../../lib/rules';

export type QueryMode = 'builder' | 'raw';

interface QueryBuilderProps {
    mode: QueryMode;
    onModeChange: (mode: QueryMode) => void;
    rows: CriteriaRow[];
    onRowsChange: (rows: CriteriaRow[]) => void;
    rawCriteria: string;
    onRawCriteriaChange: (criteria: string) => void;
    minutes: number;
    onMinutesChange: (minutes: number) => void;
    limit: number;
    onLimitChange: (limit: number) => void;
    onRun: () => void;
    loading: boolean;
}

const OPERATORS: CriteriaOperator[] = ['=', '!=', 'contains', '>', '<', '>=', '<='];

const TIME_RANGES = [
    { label: 'Last 15 min', minutes: 15 },
    { label: 'Last hour', minutes: 60 },
    { label: 'Last 24 hours', minutes: 1440 },
    { label: 'Last 7 days', minutes: 10080 },
    { label: 'Last 30 days', minutes: 43200 },
    { label: 'Last 90 days', minutes: 129600 },
];

const FIELD_SUGGESTIONS = ['source', 'category', 'severity', 'summary', 'tags', 'details.'];

export const QueryBuilder = ({
    mode, onModeChange, rows, onRowsChange, rawCriteria, onRawCriteriaChange,
    minutes, onMinutesChange, limit, onLimitChange, onRun, loading,
}: QueryBuilderProps) => {

    const updateRow = (index: number, patch: Partial<CriteriaRow>) => {
        onRowsChange(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
    };

    const switchMode = (next: QueryMode) => {
        if (next === mode) return;
        if (next === 'raw') {
            // Compile the builder state into the raw editor so nothing is lost.
            const compiled = compileCriteria(rows);
            if (compiled) onRawCriteriaChange(compiled);
        }
        onModeChange(next);
    };

    return (
        <div className="border border-thin border-border-color bg-surface rounded-lg p-4 flex flex-col gap-3">
            {/* Mode toggle + time range + run */}
            <div className="flex items-center gap-3 flex-wrap">
                <div className="flex border border-border-color rounded overflow-hidden">
                    <button
                        onClick={() => switchMode('builder')}
                        className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider transition-colors ${mode === 'builder' ? 'bg-primary text-white' : 'text-muted hover:text-text-main'}`}
                    >
                        Builder
                    </button>
                    <button
                        onClick={() => switchMode('raw')}
                        className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider transition-colors ${mode === 'raw' ? 'bg-primary text-white' : 'text-muted hover:text-text-main'}`}
                    >
                        Raw
                    </button>
                </div>

                <select
                    value={minutes}
                    onChange={(e) => onMinutesChange(Number(e.target.value))}
                    className="text-xs bg-surface border border-border-color rounded px-2 py-1.5 text-text-main"
                >
                    {TIME_RANGES.map(t => (
                        <option key={t.minutes} value={t.minutes}>{t.label}</option>
                    ))}
                </select>

                <select
                    value={limit}
                    onChange={(e) => onLimitChange(Number(e.target.value))}
                    className="text-xs bg-surface border border-border-color rounded px-2 py-1.5 text-text-main"
                >
                    {[100, 250, 500, 1000].map(n => (
                        <option key={n} value={n}>{n} rows</option>
                    ))}
                </select>

                <button
                    onClick={onRun}
                    disabled={loading}
                    className="ml-auto flex items-center gap-2 bg-primary text-white py-1.5 px-4 rounded-lg text-xs font-bold hover:bg-primary/90 transition-all shadow-sm shadow-primary/20 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                    Run Query
                </button>
            </div>

            {mode === 'builder' ? (
                <div
                    className="flex flex-col gap-2"
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && !loading) {
                            e.preventDefault();
                            onRun();
                        }
                    }}
                >
                    {rows.map((row, i) => (
                        <div key={i} className="flex items-center gap-2">
                            {i > 0 && <span className="text-[10px] font-mono font-bold text-muted w-8 text-right">AND</span>}
                            {i === 0 && <span className="w-8" />}
                            <input
                                list="qb-field-suggestions"
                                value={row.field}
                                onChange={(e) => updateRow(i, { field: e.target.value })}
                                placeholder="field (e.g. source, details.eventname)"
                                className="flex-1 text-xs font-mono bg-background border border-border-color rounded px-2 py-1.5 text-text-main placeholder:text-muted/60"
                            />
                            <select
                                value={row.operator}
                                onChange={(e) => updateRow(i, { operator: e.target.value as CriteriaOperator })}
                                className="text-xs font-mono bg-background border border-border-color rounded px-2 py-1.5 text-text-main"
                            >
                                {OPERATORS.map(op => <option key={op} value={op}>{op}</option>)}
                            </select>
                            <input
                                value={row.value}
                                onChange={(e) => updateRow(i, { value: e.target.value })}
                                placeholder="value"
                                className="flex-1 text-xs font-mono bg-background border border-border-color rounded px-2 py-1.5 text-text-main placeholder:text-muted/60"
                            />
                            <button
                                onClick={() => onRowsChange(rows.filter((_, idx) => idx !== i))}
                                disabled={rows.length === 1}
                                className="text-muted hover:text-text-main disabled:opacity-30"
                                title="Remove condition"
                            >
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>
                    ))}
                    <datalist id="qb-field-suggestions">
                        {FIELD_SUGGESTIONS.map(f => <option key={f} value={f} />)}
                    </datalist>
                    <button
                        onClick={() => onRowsChange([...rows, { field: '', operator: '=', value: '' }])}
                        className="self-start flex items-center gap-1 text-xs text-primary hover:underline font-medium mt-1"
                    >
                        <Plus className="w-3 h-3" /> Add condition
                    </button>
                    {compileCriteria(rows) && (
                        <div className="text-[11px] font-mono text-muted bg-background border border-thin border-border-color rounded px-2 py-1.5 mt-1 break-all">
                            {compileCriteria(rows)}
                        </div>
                    )}
                </div>
            ) : (
                <textarea
                    value={rawCriteria}
                    onChange={(e) => onRawCriteriaChange(e.target.value)}
                    onKeyDown={(e) => {
                        // Enter runs the query; Shift+Enter inserts a newline.
                        if (e.key === 'Enter' && !e.shiftKey && !loading) {
                            e.preventDefault();
                            onRun();
                        }
                    }}
                    title="Enter runs the query — Shift+Enter for a newline"
                    placeholder="source='cloudtrail' AND STRING(details.eventname) = 'ConsoleLogin' — or leave empty to browse the most recent events"
                    rows={3}
                    spellCheck={false}
                    className="w-full text-xs font-mono bg-background border border-border-color rounded px-3 py-2 text-text-main placeholder:text-muted/60 resize-y"
                />
            )}
        </div>
    );
};
