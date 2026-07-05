import { useState, useEffect } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { RuleDoc } from '../lib/rules';

/** Streams the Firestore `rules` collection (UI-created detection rules). */
export const useRules = () => {
    const [rules, setRules] = useState<RuleDoc[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);

    useEffect(() => {
        const unsubscribe = onSnapshot(
            collection(db, 'rules'),
            (snapshot) => {
                const data: RuleDoc[] = [];
                snapshot.forEach((doc) => {
                    data.push({ name: doc.id, ...doc.data() } as RuleDoc);
                });
                data.sort((a, b) => a.name.localeCompare(b.name));
                setRules(data);
                setLoading(false);
            },
            (err) => {
                console.error('Error fetching rules:', err);
                setError(err as Error);
                setLoading(false);
            }
        );
        return () => unsubscribe();
    }, []);

    return { rules, loading, error };
};
