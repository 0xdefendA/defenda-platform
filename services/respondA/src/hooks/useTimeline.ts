import { useState, useEffect } from 'react';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { TimelineEvent } from '../types';

export const useTimeline = (contextId: string | null) => {
    const [events, setEvents] = useState<TimelineEvent[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!contextId) return;

        const q = query(
            collection(db, 'timeline'),
            where('contextId', '==', contextId),
            orderBy('timestamp', 'asc')
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const eventData: TimelineEvent[] = [];
            snapshot.forEach((doc) => {
                eventData.push({ id: doc.id, ...doc.data() } as TimelineEvent);
            });
            setEvents(eventData);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [contextId]);

    return { events, loading };
};
