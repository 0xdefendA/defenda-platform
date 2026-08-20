export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type AlertStatus = 'open' | 'investigating' | 'resolved';
export type AlertResolution = 'true_positive' | 'false_positive' | 'true_negative' | 'false_negative';
export type AlertImpact = 'maximum' | 'high' | 'medium' | 'low' | 'none';
export type Likelihood = 'high' | 'medium' | 'low';
export type EventType = 'system' | 'action' | 'note';

export interface User {
    id: string;
    name: string;
    avatarColor: string;
}

export interface Presence {
    userId: string;
    userName?: string;
    userColor?: string;
    userPhoto?: string | null;
    cursor?: { x: number; y: number } | null;
    activeContextId: string | null;
    lastActive: any; // Firestore Timestamp (or epoch ms from older docs)
}

export interface Alert {
    id: string;
    alert_id: string;
    alert_name: string;
    alert_type: string;
    severity: string;
    summary: string;
    category: string;
    tags: string[];
    status: string;
    created_at: any; // Firestore Timestamp
    events: Record<string, any>[];
    assigneeId?: string | null;
    assigneeName?: string | null;
    resolution?: AlertResolution | null;
    impact?: AlertImpact | null;
    // Deadman alerts: repeated triggers fold into the open alert
    deadman_hits?: number | null;
    last_triggered_at?: any | null; // Firestore Timestamp
}

export interface Theory {
    id: string;
    description: string;
    likelihood: Likelihood;
    authorId: string;
}

export interface Task {
    id: string;
    description: string;
    completedAt: number | null;
    completedBy: string | null;
}

export interface Incident {
    id: string;
    title: string;
    alertIds: string[];
    theories: Theory[];
    done: Task[];
    todo: Task[];
    playbookRef: string | null;
    slackLink: string | null;
    createdAt: number;
}

export interface TimelineEvent {
    id: string;
    contextId: string; // alertId or incidentId
    type: EventType;
    actorId: string | 'system';
    message: string;
    timestamp: number;
    editedAt?: number;
    sortOrder?: number;
    timezone?: string;
}

// --- huntA: scheduled AI threat-hunt reports (hunt_reports collection) ---

export type HuntVerdict = 'findings' | 'nothing_of_concern' | 'no_report';

export interface HuntFinding {
    title: string;
    confidence: 'high' | 'medium' | 'low';
    entities: string[];
    narrative: string;
    evidence_eventids: string[];
    why_not_benign: string;
}

export interface HuntTranscriptRecord {
    ts?: string;
    kind: string; // 'query_run' | 'tool_result' | 'model_text' | 'budget_exhausted' | ...
    n?: number;
    sql?: string;
    row_count?: number;
    truncated?: boolean;
    bytes?: number;
    text?: string;
    [key: string]: unknown;
}

export interface HuntReport {
    id: string;
    run_id: string;
    verdict: HuntVerdict;
    summary: string;
    findings: HuntFinding[];
    window: { since?: string; until?: string };
    model: string;
    cost?: {
        queries?: number;
        bytes_scanned?: number;
        budget_exhausted?: boolean;
        llm_cap_exceeded?: boolean;
    };
    transcript?: HuntTranscriptRecord[];
    produced_report?: boolean;
    created_at: any; // Firestore Timestamp
}
