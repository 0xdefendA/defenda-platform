import { auth } from './firebase';

const QUERYA_URL: string = import.meta.env.VITE_QUERYA_URL || 'http://localhost:8081';

export interface EventRecord {
    utctimestamp: string;
    severity: string | null;
    summary: string | null;
    category: string | null;
    source: string | null;
    tags: string[];
    plugins: string[];
    details: Record<string, unknown> | null;
    eventid: string | null;
}

export interface QueryResponse {
    events: EventRecord[];
    count: number;
    sql: string;
    elapsed_ms: number;
    bytes_processed: number | null;
}

export class QueryApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
        super(message);
        this.status = status;
    }
}

export const queryEvents = async (
    criteria: string,
    minutes: number,
    limit: number
): Promise<QueryResponse> => {
    const user = auth.currentUser;
    if (!user) throw new QueryApiError(401, 'Not signed in');
    const token = await user.getIdToken();

    const res = await fetch(`${QUERYA_URL}/query`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ criteria, minutes, limit }),
    });

    if (!res.ok) {
        let detail = `Query failed (${res.status})`;
        try {
            const body = await res.json();
            if (body.detail) detail = String(body.detail);
        } catch {
            // keep default
        }
        throw new QueryApiError(res.status, detail);
    }

    return res.json() as Promise<QueryResponse>;
};
