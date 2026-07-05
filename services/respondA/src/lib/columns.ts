// Customizable, sortable result columns — shared by the Events results table
// and the alerts triage queue.

import type { JsonPath } from './rules';

export interface EventColumn {
    id: string;     // canonical path string, e.g. 'details.sourceipaddress'
    label: string;  // short header label, e.g. 'sourceipaddress'
    path: JsonPath; // exact segments into the record object
}

export const pathToString = (path: JsonPath): string =>
    path.reduce<string>(
        (acc, seg, i) =>
            typeof seg === 'number' ? `${acc}[${seg}]` : i === 0 ? String(seg) : `${acc}.${seg}`,
        ''
    );

/** Parses 'details._ipaddresses[0]' → ['details', '_ipaddresses', 0]. */
export const parseFieldPath = (input: string): JsonPath | null => {
    const trimmed = input.trim();
    if (!trimmed) return null;
    const path: JsonPath = [];
    const re = /([^.[\]]+)|\[(\d+)\]/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(trimmed)) !== null) {
        if (match[1] !== undefined) path.push(match[1]);
        else path.push(Number(match[2]));
    }
    return path.length > 0 ? path : null;
};

export const columnForPath = (path: JsonPath, label?: string): EventColumn => {
    const stringSegs = path.filter((s): s is string => typeof s === 'string');
    return {
        id: pathToString(path),
        label: label ?? stringSegs[stringSegs.length - 1] ?? pathToString(path),
        path,
    };
};

/** Defaults for the Events page results table. */
export const EVENT_DEFAULT_COLUMNS: EventColumn[] = [
    columnForPath(['severity']),
    columnForPath(['source']),
    columnForPath(['category']),
    columnForPath(['summary']),
];

/** Defaults for the alerts triage queue (mirrors the original fixed layout + date). */
export const ALERT_DEFAULT_COLUMNS: EventColumn[] = [
    columnForPath(['severity']),
    columnForPath(['id'], 'alert id'),
    columnForPath(['created_at'], 'date'),
    columnForPath(['alert_name'], 'title'),
    columnForPath(['summary'], 'entity'),
    columnForPath(['resolution']),
    columnForPath(['impact']),
    columnForPath(['assigneeName'], 'assignee'),
];

export const getValueAtPath = (obj: unknown, path: JsonPath): unknown => {
    let val: unknown = obj;
    for (const seg of path) {
        if (val === null || val === undefined) return undefined;
        if (typeof seg === 'number') {
            if (!Array.isArray(val)) return undefined;
            val = val[seg];
        } else if (typeof val === 'object') {
            val = (val as Record<string, unknown>)[seg];
        } else {
            return undefined;
        }
    }
    return val;
};

/** Firestore Timestamps (or anything with toDate()) → Date, else passthrough. */
const asDate = (value: unknown): Date | null => {
    if (value instanceof Date) return value;
    const maybe = value as { toDate?: () => Date } | null;
    if (maybe && typeof maybe.toDate === 'function') return maybe.toDate();
    return null;
};

export const formatCellValue = (value: unknown): string => {
    if (value === null || value === undefined) return '—';
    const date = asDate(value);
    if (date) return date.toISOString().replace('T', ' ').slice(0, 19);
    if (typeof value === 'string') return value;
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
};

/**
 * Comparator for column sorting: numbers numerically, timestamps by epoch,
 * everything else as strings. Missing values sort last regardless of
 * direction (handled by the caller returning early).
 */
export const compareValues = (a: unknown, b: unknown): number => {
    const da = asDate(a);
    const db = asDate(b);
    if (da && db) return da.getTime() - db.getTime();
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    return String(a).localeCompare(String(b));
};

// --- Persistence -------------------------------------------------------------

export const EVENTS_COLUMNS_KEY = 'responda.events.columns';
export const TRIAGE_COLUMNS_KEY = 'responda.triage.columns';

export const loadColumns = (storageKey: string, defaults: EventColumn[]): EventColumn[] => {
    try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) return defaults;
        const parsed = JSON.parse(raw) as EventColumn[];
        if (!Array.isArray(parsed)) return defaults;
        const valid = parsed.filter(c => c && typeof c.id === 'string' && Array.isArray(c.path));
        return valid.length > 0 ? valid : defaults;
    } catch {
        return defaults;
    }
};

export const saveColumns = (storageKey: string, columns: EventColumn[]) => {
    try {
        localStorage.setItem(storageKey, JSON.stringify(columns));
    } catch {
        // localStorage unavailable — columns just won't persist
    }
};
