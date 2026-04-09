import { useState, useEffect } from 'react';
import { collection, query, where, orderBy, onSnapshot, doc, updateDoc, deleteDoc } from 'firebase/firestore';
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

    const updateEvent = async (id: string, message: string) => {
        try {
            const eventRef = doc(db, 'timeline', id);
            await updateDoc(eventRef, {
                message,
                editedAt: Date.now()
            });
        } catch (err) {
            console.error('Error updating event:', err);
        }
    };

    const deleteEvent = async (id: string) => {
        try {
            const eventRef = doc(db, 'timeline', id);
            await deleteDoc(eventRef);
        } catch (err) {
            console.error('Error deleting event:', err);
        }
    };

    return { events, loading, updateEvent, deleteEvent };
};
