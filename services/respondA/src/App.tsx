import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { TriagePage } from './pages/TriagePage';
import { IncidentWorkspace } from './components/incident/IncidentWorkspace';

function App() {
  return (
    <Router>
      <div className="min-h-screen bg-background text-text font-body">
        <Routes>
          <Route path="/" element={<TriagePage />} />
          <Route path="/incident/:id" element={<IncidentWorkspace />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
