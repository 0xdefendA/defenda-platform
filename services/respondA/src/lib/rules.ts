// Criteria compilation + rule YAML generation.
//
// Criteria strings use the exact BigQuery-native-JSON syntax that alertA
// rule YAML expects, so anything built here can be dropped straight into a
// rule's `criteria` field (and vice versa).

export type CriteriaOperator = '=' | '!=' | 'contains' | '>' | '<' | '>=' | '<=';

export interface CriteriaRow {
    field: string;      // 'source', 'category', 'severity', 'tags', or 'details.<path>'
    operator: CriteriaOperator;
    value: string;
}

export const TOP_LEVEL_STRING_FIELDS = ['source', 'category', 'severity', 'summary', 'eventid'];

const escapeSqlString = (v: string) => v.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

const isNumeric = (v: string) => v.trim() !== '' && !Number.isNaN(Number(v));

/** Compiles a single builder row to a BigQuery predicate. */
export const compileRow = (row: CriteriaRow): string | null => {
    const field = row.field.trim();
    const value = row.value;
    if (!field || value.trim() === '') return null;

    const quoted = `'${escapeSqlString(value)}'`;

    if (field === 'tags' || field === 'plugins') {
        if (row.operator === '!=') return `${quoted} NOT IN UNNEST(${field})`;
        return `${quoted} IN UNNEST(${field})`;
    }

    if (TOP_LEVEL_STRING_FIELDS.includes(field)) {
        if (row.operator === 'contains') return `${field} LIKE '%${escapeSqlString(value)}%'`;
        if (row.operator === '=' || row.operator === '!=') return `${field} ${row.operator} ${quoted}`;
        return `${field} ${row.operator} ${quoted}`;
    }

    // Everything else is treated as a path into the native JSON details
    // column: 'details.useridentity.arn' or shorthand 'useridentity.arn'.
    const path = field.startsWith('details.') ? field : `details.${field}`;

    if (['>', '<', '>=', '<='].includes(row.operator) && isNumeric(value)) {
        return `CAST(JSON_VALUE(${path}) AS FLOAT64) ${row.operator} ${Number(value)}`;
    }
    // JSON_VALUE (rather than STRING()) tolerates JSON numbers/booleans and
    // returns NULL instead of erroring when the field is missing.
    if (row.operator === 'contains') {
        return `JSON_VALUE(${path}) LIKE '%${escapeSqlString(value)}%'`;
    }
    return `JSON_VALUE(${path}) ${row.operator} ${quoted}`;
};

// --- Click-to-filter from an event JSON tree --------------------------------

export type JsonPath = (string | number)[];

const jsonPathSegment = (key: string | number): string => {
    if (typeof key === 'number') return `[${key}]`;
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return `.${key}`;
    return `."${key.replace(/"/g, '\\"')}"`;
};

/**
 * Converts a path into an event document (e.g. ['details','actor','email'] or
 * ['details','_ipaddresses',0]) plus its scalar value into a builder row.
 * Returns null for paths that don't make sense as criteria (timestamps,
 * non-scalar values).
 */
export const rowForJsonPath = (path: JsonPath, value: unknown): CriteriaRow | null => {
    if (path.length === 0) return null;
    if (value === null || value === undefined || typeof value === 'object') return null;

    const root = path[0];
    const valueStr = String(value);

    if (root === 'utctimestamp') return null; // the time range filter owns this
    if ((root === 'tags' || root === 'plugins') && path.length === 2) {
        return { field: root, operator: '=', value: valueStr };
    }
    if (typeof root === 'string' && TOP_LEVEL_STRING_FIELDS.includes(root) && path.length === 1) {
        return { field: root, operator: '=', value: valueStr };
    }
    if (root === 'details' && path.length > 1) {
        const field = 'details' + path.slice(1).map(jsonPathSegment).join('');
        return { field, operator: '=', value: valueStr };
    }
    return null;
};

/** Compiles all rows (AND-joined) to a criteria string. */
export const compileCriteria = (rows: CriteriaRow[]): string =>
    rows.map(compileRow).filter(Boolean).join(' AND ');

// --- Rule YAML generation ---------------------------------------------------

export interface ThresholdRuleDraft {
    alert_name: string;
    severity: string;
    category: string;
    criteria: string;
    summary: string;
    threshold: number;
    aggregation_key: string;
    event_snippet: string;
    event_sample_count: number;
    tags: string[];
}

const yamlQuote = (v: string) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/**
 * Serializes a threshold rule draft to YAML matching the hand-written rules
 * in services/alertA/rules/. Intentionally hand-rolled: the shape is flat and
 * known, and it saves a dependency.
 */
export const generateRuleYaml = (draft: ThresholdRuleDraft): string => {
    const lines: string[] = ['---'];
    lines.push(`alert_name: ${yamlQuote(draft.alert_name)}`);
    lines.push(`alert_type: "threshold"`);
    lines.push(`category: ${yamlQuote(draft.category)}`);
    lines.push(`criteria: ${yamlQuote(draft.criteria)}`);
    lines.push(`severity: ${yamlQuote(draft.severity)}`);
    lines.push(`summary: ${yamlQuote(draft.summary)}`);
    if (draft.event_snippet.trim()) {
        lines.push(`event_snippet: ${yamlQuote(draft.event_snippet)}`);
        lines.push(`event_sample_count: ${Math.max(0, Math.floor(draft.event_sample_count))}`);
    }
    lines.push(`threshold: ${Math.max(1, Math.floor(draft.threshold))}`);
    if (draft.aggregation_key.trim() && draft.aggregation_key !== 'none') {
        lines.push(`aggregation_key: ${yamlQuote(draft.aggregation_key)}`);
    }
    if (draft.tags.length > 0) {
        lines.push('tags:');
        draft.tags.forEach(t => lines.push(`  - ${yamlQuote(t)}`));
    }
    return lines.join('\n') + '\n';
};

/** Rule names double as Firestore doc IDs and (eventually) YAML filenames. */
export const isValidRuleName = (name: string) => /^[a-z0-9_]{3,64}$/.test(name);

/** Shape of a document in the Firestore `rules` collection. */
export interface RuleDoc {
    name: string;
    yaml: string;
    enabled: boolean;
    created_by?: string;
    created_at?: unknown; // Firestore Timestamp
    updated_at?: unknown; // Firestore Timestamp
    // Structured form state for UI-created rules; lets the editor prefill
    // without parsing YAML. Absent on hand-added docs → raw YAML editing.
    draft?: ThresholdRuleDraft;
}

/** Best-effort scalar extraction from rule YAML for list display. */
export const yamlField = (yaml: string, key: string): string | null => {
    const match = yaml.match(new RegExp(`^${key}:\\s*"?([^"\\n]+)"?\\s*$`, 'm'));
    return match ? match[1].trim() : null;
};
