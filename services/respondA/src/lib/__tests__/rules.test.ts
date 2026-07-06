import { describe, expect, it } from 'vitest';
import { load as parseYaml } from 'js-yaml';
import {
    compileCriteria, compileRow, emptySlot, generateRuleYaml, isValidRuleName,
    rowForJsonPath, yamlField, type CriteriaRow, type ThresholdRuleDraft,
} from '../rules';

const row = (field: string, operator: CriteriaRow['operator'], value: string): CriteriaRow =>
    ({ field, operator, value });

describe('compileRow', () => {
    it('compiles top-level fields', () => {
        expect(compileRow(row('source', '=', 'cloudtrail'))).toBe("source = 'cloudtrail'");
        expect(compileRow(row('severity', '!=', 'INFO'))).toBe("severity != 'INFO'");
        expect(compileRow(row('summary', 'contains', 'login'))).toBe("summary LIKE '%login%'");
    });

    it('compiles tags/plugins membership', () => {
        expect(compileRow(row('tags', '=', 'aws'))).toBe("'aws' IN UNNEST(tags)");
        expect(compileRow(row('tags', '!=', 'aws'))).toBe("'aws' NOT IN UNNEST(tags)");
        expect(compileRow(row('plugins', '=', 'geoip'))).toBe("'geoip' IN UNNEST(plugins)");
    });

    it('compiles details paths with JSON_VALUE (handles JSON numbers/bools)', () => {
        expect(compileRow(row('details.eventname', '=', 'ConsoleLogin')))
            .toBe("JSON_VALUE(details.eventname) = 'ConsoleLogin'");
        expect(compileRow(row('details.user', 'contains', 'jeff')))
            .toBe("JSON_VALUE(details.user) LIKE '%jeff%'");
    });

    it('prefixes bare JSON paths with details.', () => {
        expect(compileRow(row('useridentity.arn', '=', 'x')))
            .toBe("JSON_VALUE(details.useridentity.arn) = 'x'");
    });

    it('uses numeric CAST for comparisons with numeric values', () => {
        expect(compileRow(row('details.risk_score', '>', '80')))
            .toBe('CAST(JSON_VALUE(details.risk_score) AS FLOAT64) > 80');
        expect(compileRow(row('details.risk_score', '<=', '10')))
            .toBe('CAST(JSON_VALUE(details.risk_score) AS FLOAT64) <= 10');
    });

    it('escapes single quotes in values', () => {
        expect(compileRow(row('details.user', '=', "O'Brien")))
            .toBe("JSON_VALUE(details.user) = 'O\\'Brien'");
    });

    it('returns null for incomplete rows', () => {
        expect(compileRow(row('', '=', 'x'))).toBeNull();
        expect(compileRow(row('source', '=', ''))).toBeNull();
    });
});

describe('compileCriteria', () => {
    it('AND-joins complete rows and skips incomplete ones', () => {
        const criteria = compileCriteria([
            row('source', '=', 'cloudtrail'),
            row('', '=', ''),
            row('details.eventname', '=', 'ConsoleLogin'),
        ]);
        expect(criteria).toBe(
            "source = 'cloudtrail' AND JSON_VALUE(details.eventname) = 'ConsoleLogin'"
        );
    });

    it('returns empty string for no usable rows', () => {
        expect(compileCriteria([row('', '=', '')])).toBe('');
    });
});

describe('rowForJsonPath (click-to-filter)', () => {
    it('maps top-level scalar fields', () => {
        expect(rowForJsonPath(['source'], 'gsuite'))
            .toEqual({ field: 'source', operator: '=', value: 'gsuite' });
    });

    it('maps details paths including array indices', () => {
        expect(rowForJsonPath(['details', 'actor', 'email'], 'a@b.com'))
            .toEqual({ field: 'details.actor.email', operator: '=', value: 'a@b.com' });
        expect(rowForJsonPath(['details', '_ipaddresses', 0], '1.2.3.4'))
            .toEqual({ field: 'details._ipaddresses[0]', operator: '=', value: '1.2.3.4' });
    });

    it('quotes JSON keys that are not identifiers', () => {
        expect(rowForJsonPath(['details', 'weird-key'], 'v'))
            .toEqual({ field: 'details."weird-key"', operator: '=', value: 'v' });
    });

    it('maps tags membership and stringifies non-strings', () => {
        expect(rowForJsonPath(['tags', 1], 'aws'))
            .toEqual({ field: 'tags', operator: '=', value: 'aws' });
        expect(rowForJsonPath(['details', 'impersonation'], false))
            .toEqual({ field: 'details.impersonation', operator: '=', value: 'false' });
    });

    it('rejects timestamps and non-scalars', () => {
        expect(rowForJsonPath(['utctimestamp'], '2026-01-01')).toBeNull();
        expect(rowForJsonPath(['details', 'actor'], { email: 'x' })).toBeNull();
        expect(rowForJsonPath(['details', 'x'], null)).toBeNull();
    });
});

describe('generateRuleYaml', () => {
    const base: ThresholdRuleDraft = {
        alert_name: 'aws_console_login',
        alert_type: 'threshold',
        severity: 'INFO',
        category: 'authentication',
        criteria: "source='cloudtrail' AND JSON_VALUE(details.eventname) = 'ConsoleLogin'",
        summary: '{{metadata.value}} matched {{metadata.count}} times',
        threshold: 3,
        aggregation_key: 'details.useridentity.arn',
        event_snippet: '{{details.sourceipaddress}}',
        event_sample_count: 5,
        tags: ['aws', 'login'],
    };

    it('produces YAML that parses to the threshold rule shape alertA expects', () => {
        const rule = parseYaml(generateRuleYaml(base)) as Record<string, unknown>;
        expect(rule).toMatchObject({
            alert_name: 'aws_console_login',
            alert_type: 'threshold',
            category: 'authentication',
            criteria: base.criteria,
            severity: 'INFO',
            threshold: 3,
            aggregation_key: 'details.useridentity.arn',
            event_snippet: '{{details.sourceipaddress}}',
            event_sample_count: 5,
            tags: ['aws', 'login'],
        });
        // 5-minute default lookback is implicit, not written
        expect(rule.lookback_minutes).toBeUndefined();
    });

    it('deadman rules keep threshold 0 and always carry lookback', () => {
        const rule = parseYaml(generateRuleYaml({
            ...base,
            alert_type: 'deadman',
            threshold: 0,
            lookback_minutes: 60,
        })) as Record<string, unknown>;
        expect(rule.alert_type).toBe('deadman');
        expect(rule.threshold).toBe(0);
        expect(rule.lookback_minutes).toBe(60);
    });

    it('threshold rules floor threshold at 1', () => {
        const rule = parseYaml(generateRuleYaml({ ...base, threshold: 0 })) as Record<string, unknown>;
        expect(rule.threshold).toBe(1);
    });

    it('sequence rules emit lifespan and typed slots with generated names', () => {
        const rule = parseYaml(generateRuleYaml({
            ...base,
            alert_type: 'sequence',
            lifespan_days: 7,
            slots: [
                { ...emptySlot("source='onelogin'"), aggregation_key: 'details.user_name' },
                { ...emptySlot("JSON_VALUE(details.user_name)='{{slots.0.events.0.details.user_name}}'"), alert_type: 'deadman', threshold: 0, lookback_minutes: 30 },
            ],
        })) as any;
        expect(rule.alert_type).toBe('sequence');
        expect(rule.lifespan).toBe('7 days');
        expect(rule.criteria).toBeUndefined(); // top-level criteria is slot-only
        expect(rule.slots).toHaveLength(2);
        expect(rule.slots[0]).toMatchObject({
            alert_name: 'aws_console_login_slot_1',
            alert_type: 'threshold',
            threshold: 1,
            aggregation_key: 'details.user_name',
        });
        expect(rule.slots[1]).toMatchObject({
            alert_name: 'aws_console_login_slot_2',
            alert_type: 'deadman',
            threshold: 0,
            lookback_minutes: 30,
        });
        // cross-slot templating survives YAML round-trip intact
        expect(rule.slots[1].criteria).toContain('{{slots.0.events.0.details.user_name}}');
    });

    it('escapes double quotes in templated strings', () => {
        const rule = parseYaml(generateRuleYaml({
            ...base,
            summary: 'said "hello" {{metadata.count}} times',
        })) as Record<string, unknown>;
        expect(rule.summary).toBe('said "hello" {{metadata.count}} times');
    });
});

describe('helpers', () => {
    it('isValidRuleName enforces slug rules', () => {
        expect(isValidRuleName('aws_console_login')).toBe(true);
        expect(isValidRuleName('ab')).toBe(false);
        expect(isValidRuleName('Has Spaces')).toBe(false);
        expect(isValidRuleName('UPPER')).toBe(false);
    });

    it('yamlField extracts top-level scalars only', () => {
        const yaml = generateRuleYaml({
            alert_name: 'x_rule', alert_type: 'threshold', severity: 'HIGH',
            category: 'general', criteria: "source='x'", summary: 's',
            threshold: 2, aggregation_key: '', event_snippet: '', event_sample_count: 3, tags: [],
        });
        expect(yamlField(yaml, 'severity')).toBe('HIGH');
        expect(yamlField(yaml, 'threshold')).toBe('2');
        expect(yamlField(yaml, 'nonexistent')).toBeNull();
    });
});
