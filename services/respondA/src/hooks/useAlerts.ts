import { useState, useEffect } from 'react';
import { collection, query, orderBy, onSnapshot, limit } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Alert } from '../types';

export const useAlerts = (maxAlerts = 50) => {
    const [alerts, setAlerts] = useState<Alert[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);

    useEffect(() => {
        const q = query(
            collection(db, 'alerts'),
            orderBy('createdAt', 'desc'),
            limit(maxAlerts)
        );

        const unsubscribe = onSnapshot(
            q,
            (snapshot) => {
                const alertsData: Alert[] = [];
                snapshot.forEach((doc) => {
                    alertsData.push({ id: doc.id, ...doc.data() } as Alert);
                });
                setAlerts(alertsData);
                setLoading(false);
            },
            (err) => {
                console.error('Error fetching alerts:', err);
                setError(err as Error);
                setLoading(false);
            }
        );

        return () => unsubscribe();
    }, [maxAlerts]);

    return { alerts, loading, error };
};
