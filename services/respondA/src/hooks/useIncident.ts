import { useState, useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Incident } from '../types';

export const useIncident = (incidentId: string | undefined) => {
    const [incident, setIncident] = useState<Incident | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);

    useEffect(() => {
        if (!incidentId) {
            setLoading(false);
            return;
        }

        const docRef = doc(db, 'incidents', incidentId);

        const unsubscribe = onSnapshot(
            docRef,
            (docSnap) => {
                if (docSnap.exists()) {
                    setIncident({ id: docSnap.id, ...docSnap.data() } as Incident);
                } else {
                    setIncident(null);
                }
                setLoading(false);
            },
            (err) => {
                console.error('Error fetching incident:', err);
                setError(err as Error);
                setLoading(false);
            }
        );

        return () => unsubscribe();
    }, [incidentId]);

    return { incident, loading, error };
};
