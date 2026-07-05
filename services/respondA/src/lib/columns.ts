// Customizable result columns for the Events page.

import type { JsonPath } from './rules';

export interface EventColumn {
    id: string;     // canonical path string, e.g. 'details.sourceipaddress'
    label: string;  // short header label, e.g. 'sourceipaddress'
    path: JsonPath; // exact segments into the event object
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

export const columnForPath = (path: JsonPath): EventColumn => {
    const stringSegs = path.filter((s): s is string => typeof s === 'string');
    return {
        id: pathToString(path),
        label: stringSegs[stringSegs.length - 1] ?? pathToString(path),
        path,
    };
};

export const DEFAULT_COLUMNS: EventColumn[] = [
    columnForPath(['severity']),
    columnForPath(['source']),
    columnForPath(['category']),
    columnForPath(['summary']),
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

export const formatCellValue = (value: unknown): string => {
    if (value === null || value === undefined) return '—';
    if (typeof value === 'string') return value;
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
};

// --- Persistence -------------------------------------------------------------

const STORAGE_KEY = 'responda.events.columns';

export const loadColumns = (): EventColumn[] => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return DEFAULT_COLUMNS;
        const parsed = JSON.parse(raw) as EventColumn[];
        if (!Array.isArray(parsed)) return DEFAULT_COLUMNS;
        return parsed.filter(c => c && typeof c.id === 'string' && Array.isArray(c.path));
    } catch {
        return DEFAULT_COLUMNS;
    }
};

export const saveColumns = (columns: EventColumn[]) => {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(columns));
    } catch {
        // localStorage unavailable — columns just won't persist
    }
};
