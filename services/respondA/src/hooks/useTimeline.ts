import { useState, useEffect } from 'react';
import { collection, query, where, orderBy, onSnapshot, doc, updateDoc, deleteDoc, writeBatch } from 'firebase/firestore';
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
            
            // Sort by sortOrder then timestamp
            eventData.sort((a, b) => {
                const orderA = a.sortOrder ?? a.timestamp;
                const orderB = b.sortOrder ?? b.timestamp;
                if (orderA !== orderB) return orderA - orderB;
                return a.timestamp - b.timestamp;
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

    const updateEventDetails = async (id: string, details: Partial<TimelineEvent>) => {
        try {
            const eventRef = doc(db, 'timeline', id);
            await updateDoc(eventRef, {
                ...details,
                editedAt: Date.now()
            });
        } catch (err) {
            console.error('Error updating event details:', err);
        }
    };

    const reorderEvents = async (orderedEvents: TimelineEvent[]) => {
        try {
            const batch = writeBatch(db);
            orderedEvents.forEach((event, index) => {
                const eventRef = doc(db, 'timeline', event.id);
                batch.update(eventRef, { sortOrder: index });
            });
            await batch.commit();
        } catch (err) {
            console.error('Error reordering events:', err);
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

    return { events, loading, updateEvent, updateEventDetails, reorderEvents, deleteEvent };
};
