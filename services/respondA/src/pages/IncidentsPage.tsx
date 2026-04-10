import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, query, orderBy, onSnapshot, doc, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Sidebar } from '../components/layout/Sidebar';
import { Header } from '../components/layout/Header';
import { format } from 'date-fns';
import { ShieldAlert, ChevronRight } from 'lucide-react';
import type { Incident } from '../types';

export const IncidentsPage = () => {
    const navigate = useNavigate();
    const [incidents, setIncidents] = useState<Incident[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');

    useEffect(() => {
        const q = query(
            collection(db, 'incidents'),
            orderBy('createdAt', 'desc')
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const incidentData: Incident[] = [];
            snapshot.forEach((doc) => {
                incidentData.push({ id: doc.id, ...doc.data() } as Incident);
            });
            setIncidents(incidentData);
            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

    const handleCreateIncident = async () => {
        const incidentId = `incident-${Math.random().toString(36).substr(2, 9)}`;
        try {
            const incidentRef = doc(db, 'incidents', incidentId);
            await setDoc(incidentRef, {
                id: incidentId,
                title: `Manual Incident: ${new Date().toLocaleDateString()}`,
                alertIds: [],
                theories: [],
                done: [],
                todo: [
                    { id: '1', description: 'Investigate source', completedAt: null, completedBy: null }
                ],
                playbookRef: null,
                slackLink: null,
                createdAt: Date.now()
            });
            navigate(`/incident/${incidentId}`);
        } catch (err) {
            console.error('Error creating manual incident:', err);
        }
    };

    const filteredIncidents = incidents.filter(i => {
        const search = searchTerm.toLowerCase();
        return !searchTerm ||
            i.title.toLowerCase().includes(search) ||
            i.id.toLowerCase().includes(search);
    });

    return (
        <div className="flex h-screen bg-background-light dark:bg-background-dark text-text-main overflow-hidden">
            <Sidebar onCreateIncident={handleCreateIncident} />

            <main className="flex-1 flex flex-col h-full overflow-hidden relative">
                <Header searchTerm={searchTerm} onSearchChange={setSearchTerm} />

                <div className="flex-1 overflow-auto bg-surface relative">
                    {/* Table Header */}
                    <div className="sticky top-0 bg-background-light border-b border-thin border-border-color z-20">
                        <div className="grid grid-cols-[100px_minmax(300px,_1fr)_150px_120px_120px_100px] items-center px-6 py-2 text-[10px] font-display text-muted uppercase tracking-wider h-10">
                            <div>Incident ID</div>
                            <div>Title</div>
                            <div>Created</div>
                            <div className="text-center">Alerts</div>
                            <div className="text-center">Tasks</div>
                            <div className="text-right">Actions</div>
                        </div>
                    </div>

                    {/* Table Body */}
                    <div className="flex flex-col">
                        {loading ? (
                            <div className="flex items-center justify-center py-20">
                                <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full"></div>
                            </div>
                        ) : filteredIncidents.map((incident) => (
                            <div
                                key={incident.id}
                                onClick={() => navigate(`/incident/${incident.id}`)}
                                className="grid grid-cols-[100px_minmax(300px,_1fr)_150px_120px_120px_100px] items-center px-6 py-4 border-b border-thin border-border-color hover:bg-row-hover group transition-colors cursor-pointer"
                            >
                                <div className="font-mono text-xs text-text-main truncate pr-4">
                                    {incident.id
                                        .replace(/^incident-/, '')
                                        .replace(/-incident$/, '')
                                        .substring(0, 8)
                                        .toUpperCase()}
                                </div>
                                <div className="font-medium text-sm text-text-main flex items-center gap-2">
                                    <ShieldAlert className="w-4 h-4 text-primary" />
                                    {incident.title}
                                </div>
                                <div className="text-xs text-muted font-mono">
                                    {format(incident.createdAt, 'yyyy-MM-dd HH:mm')}
                                </div>
                                <div className="text-center">
                                    <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-full bg-primary/10 text-primary font-mono text-[10px] font-bold">
                                        {incident.alertIds?.length || 0}
                                    </span>
                                </div>
                                <div className="text-center">
                                    <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-full bg-success/10 text-success font-mono text-[10px] font-bold">
                                        {incident.done?.length || 0}/{(incident.todo?.length || 0) + (incident.done?.length || 0)}
                                    </span>
                                </div>
                                <div className="text-right">
                                    <ChevronRight className="w-5 h-5 text-muted opacity-0 group-hover:opacity-100 transition-all ml-auto" />
                                </div>
                            </div>
                        ))}

                        {!loading && filteredIncidents.length === 0 && (
                            <div className="flex flex-col items-center justify-center py-20 bg-surface">
                                <p className="font-display text-2xl font-semibold text-muted text-center">
                                    No incidents found. <br />
                                    <span className="text-sm font-normal italic">All clear on the horizon.</span>
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </main>
        </div>
    );
};
