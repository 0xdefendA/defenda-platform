// Client-side condition matching for records already streamed to the browser
// (e.g. Firestore alerts in the triage queue). Same row shape as the Events
// query builder, but evaluated in-memory instead of compiled to SQL.

import type { CriteriaRow } from './rules';
import { getValueAtPath, parseFieldPath } from './columns';

const asComparable = (value: unknown): unknown => {
    const maybe = value as { toDate?: () => Date } | null;
    if (maybe && typeof maybe.toDate === 'function') return maybe.toDate().toISOString();
    if (value instanceof Date) return value.toISOString();
    return value;
};

/** True when the record satisfies the condition. Incomplete rows match everything. */
export const matchesRow = (record: unknown, row: CriteriaRow): boolean => {
    const field = row.field.trim();
    const target = row.value.trim();
    if (!field || target === '') return true;

    const path = parseFieldPath(field);
    if (!path) return true;

    const raw = asComparable(getValueAtPath(record, path));

    // Arrays (tags, plugins): '=' means membership, 'contains' means substring
    // match on any element.
    if (Array.isArray(raw)) {
        const items = raw.map(v => String(v).toLowerCase());
        const t = target.toLowerCase();
        switch (row.operator) {
            case '=': return items.includes(t);
            case '!=': return !items.includes(t);
            case 'contains': return items.some(v => v.includes(t));
            default: return false;
        }
    }

    if (raw === null || raw === undefined) {
        // Missing fields only match negative conditions.
        return row.operator === '!=';
    }

    const rawStr = String(raw).toLowerCase();
    const t = target.toLowerCase();

    switch (row.operator) {
        case '=': return rawStr === t;
        case '!=': return rawStr !== t;
        case 'contains': return rawStr.includes(t);
        case '>':
        case '<':
        case '>=':
        case '<=': {
            const a = Number(raw);
            const b = Number(target);
            // Numeric when possible, else lexicographic (works for ISO dates).
            const cmp = !Number.isNaN(a) && !Number.isNaN(b)
                ? a - b
                : String(raw).localeCompare(target);
            if (row.operator === '>') return cmp > 0;
            if (row.operator === '<') return cmp < 0;
            if (row.operator === '>=') return cmp >= 0;
            return cmp <= 0;
        }
        default: return true;
    }
};

export const matchesAllRows = (record: unknown, rows: CriteriaRow[]): boolean =>
    rows.every(row => matchesRow(record, row));
