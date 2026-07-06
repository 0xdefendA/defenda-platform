import { describe, expect, it } from 'vitest';
import {
    columnForPath, compareValues, formatCellValue, getValueAtPath,
    loadColumns, parseFieldPath, pathToString, EVENT_DEFAULT_COLUMNS,
} from '../columns';

describe('parseFieldPath / pathToString', () => {
    it('round-trips dotted paths with array indices', () => {
        const path = parseFieldPath('details._ipaddresses[0]');
        expect(path).toEqual(['details', '_ipaddresses', 0]);
        expect(pathToString(path!)).toBe('details._ipaddresses[0]');
    });

    it('handles simple and nested paths', () => {
        expect(parseFieldPath('severity')).toEqual(['severity']);
        expect(parseFieldPath('events[0].details.sourceipaddress'))
            .toEqual(['events', 0, 'details', 'sourceipaddress']);
    });

    it('rejects empty input', () => {
        expect(parseFieldPath('')).toBeNull();
        expect(parseFieldPath('   ')).toBeNull();
    });
});

describe('getValueAtPath', () => {
    const event = {
        source: 'gsuite',
        tags: ['a', 'b'],
        details: { actor: { email: 'x@y.z' }, _ipaddresses: ['1.2.3.4'] },
    };

    it('walks objects and arrays', () => {
        expect(getValueAtPath(event, ['source'])).toBe('gsuite');
        expect(getValueAtPath(event, ['details', 'actor', 'email'])).toBe('x@y.z');
        expect(getValueAtPath(event, ['details', '_ipaddresses', 0])).toBe('1.2.3.4');
        expect(getValueAtPath(event, ['tags', 1])).toBe('b');
    });

    it('returns undefined for missing/mistyped paths', () => {
        expect(getValueAtPath(event, ['details', 'nope'])).toBeUndefined();
        expect(getValueAtPath(event, ['source', 0])).toBeUndefined();
        expect(getValueAtPath(event, ['tags', 9])).toBeUndefined();
    });
});

describe('formatCellValue', () => {
    it('formats scalars, missing values, and objects', () => {
        expect(formatCellValue('x')).toBe('x');
        expect(formatCellValue(42)).toBe('42');
        expect(formatCellValue(null)).toBe('—');
        expect(formatCellValue(undefined)).toBe('—');
        expect(formatCellValue({ a: 1 })).toBe('{"a":1}');
    });

    it('formats Firestore-Timestamp-like values as UTC datetime', () => {
        const fakeTimestamp = { toDate: () => new Date(Date.UTC(2026, 6, 4, 16, 54, 7)) };
        expect(formatCellValue(fakeTimestamp)).toBe('2026-07-04 16:54:07');
    });
});

describe('compareValues', () => {
    it('compares numbers numerically and strings lexically', () => {
        expect(compareValues(2, 10)).toBeLessThan(0);
        expect(compareValues('b', 'a')).toBeGreaterThan(0);
    });

    it('compares timestamp-likes by epoch', () => {
        const early = { toDate: () => new Date(1000) };
        const late = { toDate: () => new Date(2000) };
        expect(compareValues(early, late)).toBeLessThan(0);
        expect(compareValues(late, early)).toBeGreaterThan(0);
    });
});

describe('columnForPath / loadColumns', () => {
    it('labels columns by their last string segment, with overrides', () => {
        expect(columnForPath(['details', '_ipaddresses', 0]).label).toBe('_ipaddresses');
        expect(columnForPath(['created_at'], 'date').label).toBe('date');
        expect(columnForPath(['details', 'actor', 'email']).id).toBe('details.actor.email');
    });

    it('falls back to defaults when localStorage is unavailable (node env)', () => {
        expect(loadColumns('any-key', EVENT_DEFAULT_COLUMNS)).toEqual(EVENT_DEFAULT_COLUMNS);
    });
});
