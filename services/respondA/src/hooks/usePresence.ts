import { useState, useEffect, useRef } from 'react';
import { collection, query, where, onSnapshot, setDoc, doc, serverTimestamp, deleteDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Presence, User } from '../types';

// Mock user for local development - in a real app this would come from Auth
const MOCK_USER: User = {
    id: 'analyst-' + Math.random().toString(36).substr(2, 5),
    name: 'Analyst ' + Math.floor(Math.random() * 100),
    avatarColor: '#' + Math.floor(Math.random() * 16777215).toString(16)
};

export const usePresence = (contextId: string | null) => {
    const [presences, setPresences] = useState<Presence[]>([]);
    const lastUpdateRef = useRef<number>(0);
    const THROTTLE_MS = 2000; // Throttle Firestore writes to 2 seconds

    useEffect(() => {
        if (!contextId) return;

        // 1. Subscribe to presence updates for this context
        const q = query(
            collection(db, 'presence'),
            where('activeContextId', '==', contextId)
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const presenceData: Presence[] = [];
            snapshot.forEach((doc) => {
                presenceData.push(doc.data() as Presence);
            });
            setPresences(presenceData);
        });

        // 2. Register current user's presence
        const userPresenceRef = doc(db, 'presence', MOCK_USER.id);

        const updatePresence = async (cursor: { x: number; y: number } | null = null) => {
            const now = Date.now();
            if (now - lastUpdateRef.current < THROTTLE_MS) return;

            lastUpdateRef.current = now;
            await setDoc(userPresenceRef, {
                userId: MOCK_USER.id,
                userName: MOCK_USER.name,
                userColor: MOCK_USER.avatarColor,
                cursor,
                activeContextId: contextId,
                lastActive: serverTimestamp()
            }, { merge: true });
        };

        updatePresence();

        // Clean up presence on unmount
        return () => {
            unsubscribe();
            deleteDoc(userPresenceRef).catch(console.error);
        };
    }, [contextId]);

    return { presences, currentUser: MOCK_USER };
};
