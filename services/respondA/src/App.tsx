import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { TriagePage } from './pages/TriagePage';
import { IncidentsPage } from './pages/IncidentsPage';
import { EventsPage } from './pages/EventsPage';
import { DetectionsPage } from './pages/DetectionsPage';
import { SettingsPage } from './pages/SettingsPage';
import { IncidentWorkspace } from './components/incident/IncidentWorkspace';
import { LoginPage } from './pages/LoginPage';
import { AuthProvider } from './hooks/useAuth';
import { AuthGuard } from './components/layout/AuthGuard';

function App() {
  return (
    <AuthProvider>
      <Router>
        <div className="min-h-screen bg-background text-text font-body">
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/"
              element={
                <AuthGuard>
                  <TriagePage />
                </AuthGuard>
              }
            />
            <Route
              path="/incidents"
              element={
                <AuthGuard>
                  <IncidentsPage />
                </AuthGuard>
              }
            />
            <Route
              path="/events"
              element={
                <AuthGuard>
                  <EventsPage />
                </AuthGuard>
              }
            />
            <Route
              path="/detections"
              element={
                <AuthGuard>
                  <DetectionsPage />
                </AuthGuard>
              }
            />
            <Route
              path="/settings"
              element={
                <AuthGuard>
                  <SettingsPage />
                </AuthGuard>
              }
            />
            <Route
              path="/incident/:id"
              element={
                <AuthGuard>
                  <IncidentWorkspace />
                </AuthGuard>
              }
            />
            {/* Fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </Router>
    </AuthProvider>
  );
}

export default App;
