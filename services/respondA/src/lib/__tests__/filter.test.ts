import { describe, expect, it } from 'vitest';
import { matchesAllRows, matchesRow } from '../filter';
import type { CriteriaRow } from '../rules';

const row = (field: string, operator: CriteriaRow['operator'], value: string): CriteriaRow =>
    ({ field, operator, value });

const alert = {
    severity: 'HIGH',
    status: 'OPEN',
    alert_name: 'aws_console_login',
    tags: ['aws', 'login'],
    assigneeName: 'Jeff',
    created_at: { toDate: () => new Date(Date.UTC(2026, 6, 4, 12, 0, 0)) },
    events: [{ details: { sourceipaddress: '1.2.3.4', risk_score: 85 } }],
};

describe('matchesRow', () => {
    it('matches equality case-insensitively', () => {
        expect(matchesRow(alert, row('severity', '=', 'high'))).toBe(true);
        expect(matchesRow(alert, row('severity', '=', 'low'))).toBe(false);
        expect(matchesRow(alert, row('severity', '!=', 'low'))).toBe(true);
    });

    it('supports contains', () => {
        expect(matchesRow(alert, row('alert_name', 'contains', 'console'))).toBe(true);
        expect(matchesRow(alert, row('alert_name', 'contains', 'gsuite'))).toBe(false);
    });

    it('treats = on arrays as membership', () => {
        expect(matchesRow(alert, row('tags', '=', 'aws'))).toBe(true);
        expect(matchesRow(alert, row('tags', '=', 'azure'))).toBe(false);
        expect(matchesRow(alert, row('tags', '!=', 'azure'))).toBe(true);
        expect(matchesRow(alert, row('tags', 'contains', 'log'))).toBe(true);
    });

    it('reaches into triggering events by deep path', () => {
        expect(matchesRow(alert, row('events[0].details.sourceipaddress', '=', '1.2.3.4'))).toBe(true);
        expect(matchesRow(alert, row('events[0].details.risk_score', '>', '80'))).toBe(true);
        expect(matchesRow(alert, row('events[0].details.risk_score', '>', '90'))).toBe(false);
    });

    it('missing fields only match negative conditions', () => {
        expect(matchesRow(alert, row('nonexistent', '=', 'x'))).toBe(false);
        expect(matchesRow(alert, row('nonexistent', '!=', 'x'))).toBe(true);
    });

    it('compares timestamps lexicographically via ISO strings', () => {
        expect(matchesRow(alert, row('created_at', '>', '2026-01-01'))).toBe(true);
        expect(matchesRow(alert, row('created_at', '<', '2026-01-01'))).toBe(false);
    });

    it('incomplete conditions match everything', () => {
        expect(matchesRow(alert, row('', '=', ''))).toBe(true);
        expect(matchesRow(alert, row('severity', '=', ''))).toBe(true);
    });
});

describe('matchesAllRows', () => {
    it('ANDs all conditions', () => {
        expect(matchesAllRows(alert, [
            row('severity', '=', 'HIGH'),
            row('tags', '=', 'aws'),
        ])).toBe(true);
        expect(matchesAllRows(alert, [
            row('severity', '=', 'HIGH'),
            row('tags', '=', 'azure'),
        ])).toBe(false);
        expect(matchesAllRows(alert, [])).toBe(true);
    });
});
