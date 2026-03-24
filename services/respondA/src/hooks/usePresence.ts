import { useState, useEffect, useRef, useMemo } from 'react';
import { collection, query, where, onSnapshot, setDoc, doc, serverTimestamp, deleteDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from './useAuth';
import type { Presence } from '../types';

export const usePresence = (contextId: string | null) => {
    const { user } = useAuth();
    const [presences, setPresences] = useState<Presence[]>([]);
    const lastUpdateRef = useRef<number>(0);
    const THROTTLE_MS = 2000; // Throttle Firestore writes to 2 seconds

    // Use actual user or a STABLE mock user
    const currentUser = useMemo(() => {
        if (user) {
            return {
                id: user.uid,
                name: user.displayName || user.email?.split('@')[0] || 'Analyst',
                avatarColor: '#0055FF',
                photoURL: user.photoURL
            };
        }

        // Fallback to stable mock in localStorage
        const stored = localStorage.getItem('respondA_mock_user');
        if (stored) return JSON.parse(stored);

        const newUser = {
            id: 'mock-' + Math.random().toString(36).substr(2, 5),
            name: 'Mock Analyst ' + Math.floor(Math.random() * 100),
            avatarColor: '#' + Math.floor(Math.random() * 16777215).toString(16)
        };
        localStorage.setItem('respondA_mock_user', JSON.stringify(newUser));
        return newUser;
    }, [user]);

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
            // Filter out stale presences (older than 30 seconds)
            const now = Date.now();
            const activeOnly = presenceData.filter(p => {
                const lastActiveVal = p.lastActive as any;
                const lastActive = lastActiveVal?.toMillis ? lastActiveVal.toMillis() : (lastActiveVal || now);
                return now - lastActive < 30000;
            });
            setPresences(activeOnly);
        });

        // 2. Register current user's presence
        const userPresenceRef = doc(db, 'presence', currentUser.id);

        const updatePresence = async (cursor: { x: number; y: number } | null = null) => {
            const now = Date.now();
            if (now - lastUpdateRef.current < THROTTLE_MS) return;

            lastUpdateRef.current = now;
            await setDoc(userPresenceRef, {
                userId: currentUser.id,
                userName: currentUser.name,
                userColor: currentUser.avatarColor,
                userPhoto: (currentUser as any).photoURL || null,
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
    }, [contextId, currentUser]);

    return { presences, currentUser };
};
