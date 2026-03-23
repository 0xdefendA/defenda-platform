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
    cursor: { x: number; y: number } | null;
    activeContextId: string | null;
    lastActive: number;
}

export interface Alert {
    id: string;
    severity: Severity;
    title: string;
    entity: string;
    assigneeId: string | null;
    status: AlertStatus;
    resolution: AlertResolution | null;
    impact: AlertImpact | null;
    payload: Record<string, any>;
    createdAt: number;
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
}
