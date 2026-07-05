import { useEffect, useRef, useState } from 'react';
import { ShieldPlus, Zap } from 'lucide-react';
import { Sidebar } from '../components/layout/Sidebar';
import { QueryBuilder, type QueryMode } from '../components/events/QueryBuilder';
import { EventsTable } from '../components/events/EventsTable';
import { RuleEditorModal } from '../components/events/RuleEditorModal';
import { Toast, useToast } from '../components/ui/Toast';
import { queryEvents, type EventRecord } from '../lib/queryApi';
import { compileCriteria, compileRow, type CriteriaRow, type JsonPath } from '../lib/rules';
import {
    EVENTS_COLUMNS_KEY, EVENT_DEFAULT_COLUMNS, columnForPath, loadColumns, saveColumns,
    type EventColumn,
} from '../lib/columns';

export const EventsPage = () => {
    const [mode, setMode] = useState<QueryMode>('builder');
    const [rows, setRows] = useState<CriteriaRow[]>([{ field: '', operator: '=', value: '' }]);
    const [rawCriteria, setRawCriteria] = useState('');
    const [minutes, setMinutes] = useState(1440);
    const [limit, setLimit] = useState(100);

    const [events, setEvents] = useState<EventRecord[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [hasRun, setHasRun] = useState(false);
    const [lastStats, setLastStats] = useState<{ count: number; elapsed_ms: number } | null>(null);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const { toast, showToast, clearToast } = useToast();
    const [columns, setColumns] = useState<EventColumn[]>(
        () => loadColumns(EVENTS_COLUMNS_KEY, EVENT_DEFAULT_COLUMNS)
    );

    const updateColumns = (next: EventColumn[]) => {
        setColumns(next);
        saveColumns(EVENTS_COLUMNS_KEY, next);
    };

    const handleAddColumn = (path: JsonPath) => {
        const col = columnForPath(path);
        if (columns.some(c => c.id === col.id)) return;
        updateColumns([...columns, col]);
    };

    const handleRemoveColumn = (id: string) => {
        updateColumns(columns.filter(c => c.id !== id));
    };

    const effectiveCriteria = mode === 'builder' ? compileCriteria(rows) : rawCriteria.trim();

    /** Click-to-filter from an expanded event's JSON tree. */
    const handleAddCondition = (row: CriteriaRow) => {
        if (mode === 'builder') {
            const kept = rows.filter(r => r.field.trim() && r.value.trim() !== '');
            const duplicate = kept.some(
                r => r.field === row.field && r.operator === row.operator && r.value === row.value
            );
            setRows(duplicate ? kept : [...kept, row]);
        } else {
            const predicate = compileRow(row);
            if (!predicate) return;
            setRawCriteria(prev => {
                const current = prev.trim();
                if (current.includes(predicate)) return prev;
                return current ? `${current} AND ${predicate}` : predicate;
            });
        }
    };

    // An empty criteria is valid: browse mode, most recent events first.
    const handleRun = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await queryEvents(effectiveCriteria, minutes, limit);
            setEvents(res.events);
            setLastStats({ count: res.count, elapsed_ms: res.elapsed_ms });
            setHasRun(true);
        } catch (err) {
            console.error('Query failed:', err);
            setError(err instanceof Error ? err.message : 'Query failed');
        } finally {
            setLoading(false);
        }
    };

    // Land on data, not a blank screen: browse the most recent events on mount.
    const autoRan = useRef(false);
    useEffect(() => {
        if (autoRan.current) return;
        autoRan.current = true;
        handleRun();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <div className="flex h-screen bg-background text-text-main overflow-hidden">
            <Sidebar />

            <main className="flex-1 flex flex-col h-full overflow-hidden">
                {/* Page header */}
                <div className="h-[48px] flex items-center gap-3 px-4 border-b border-thin border-border-color bg-surface flex-shrink-0">
                    <h1 className="font-display font-bold text-base text-text-main flex items-center gap-2">
                        <Zap className="w-4 h-4 text-primary" />
                        Events
                    </h1>
                    <span className="text-xs text-muted">Query the data lake — the same criteria syntax powers detection rules.</span>
                    {lastStats && (
                        <span className="ml-auto font-mono text-[11px] text-muted">
                            {lastStats.count} events · {lastStats.elapsed_ms}ms
                        </span>
                    )}
                </div>

                <div className="flex flex-col flex-1 overflow-hidden p-4 gap-3">
                    <QueryBuilder
                        mode={mode}
                        onModeChange={setMode}
                        rows={rows}
                        onRowsChange={setRows}
                        rawCriteria={rawCriteria}
                        onRawCriteriaChange={setRawCriteria}
                        minutes={minutes}
                        onMinutesChange={setMinutes}
                        limit={limit}
                        onLimitChange={setLimit}
                        onRun={handleRun}
                        loading={loading}
                    />

                    {error && (
                        <div className="text-xs text-accent border border-accent/30 bg-accent/5 rounded px-3 py-2 font-mono break-all">
                            {error}
                        </div>
                    )}

                    {/* Any non-empty criteria can become a rule — including ones
                        with no current matches (arming for future events). */}
                    {effectiveCriteria && (
                        <div className="flex items-center">
                            <button
                                onClick={() => setShowCreateModal(true)}
                                className="flex items-center gap-2 border border-primary text-primary py-1.5 px-4 rounded-lg text-xs font-bold hover:bg-primary hover:text-white transition-all"
                            >
                                <ShieldPlus className="w-4 h-4" />
                                Create alert from this query
                            </button>
                        </div>
                    )}

                    <div className="flex-1 flex flex-col border border-thin border-border-color bg-surface rounded-lg overflow-hidden">
                        <EventsTable
                            events={events}
                            loading={loading}
                            hasRun={hasRun}
                            columns={columns}
                            onAddCondition={handleAddCondition}
                            onAddColumn={handleAddColumn}
                            onRemoveColumn={handleRemoveColumn}
                            onColumnsChange={updateColumns}
                        />
                    </div>
                </div>
            </main>

            {showCreateModal && (
                <RuleEditorModal
                    criteria={effectiveCriteria}
                    onClose={() => setShowCreateModal(false)}
                    onSaved={showToast}
                />
            )}

            <Toast message={toast} onDismiss={clearToast} />
        </div>
    );
};
