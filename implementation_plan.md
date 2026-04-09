# Implementation Plan

[Overview]
The goal is to bootstrap and implement the `respondA` user interface, a real-time, multiplayer incident response environment for security analysts.

We will build this using a React + Vite Single Page Application (SPA) architecture combined with native Firebase (Firestore) SDKs for real-time state synchronization. This approach aligns perfectly with the project's serverless GCP monorepo philosophy. The interface will reflect the modern, luminous, high-density design system specified in the PRD, featuring crisp typography (Space Grotesk, IBM Plex), soft precision (12px rounded corners), and a distinctive Brand Blue (#0d59f2) aesthetic. Real-time multiplayer presence (e.g., viewing indicators and cursors) will be managed via Firestore by throttling document write updates. Crucially, the platform manages both initial alert triage and full-scale incident investigations, seamlessly escalating alerts to collaborative incident workspaces featuring active theories, synchronized HAVEDONE/TODO lists, timeline ledgers, and automated Markdown summarization.

[Types]  
Core TypeScript data structures defining the state of alerts, incidents, tasks, timeline events, and multiplayer presence synchronization.

- `User`: `{ id: string; name: string; avatarColor: string; }`
- `Presence`: `{ userId: string; cursor: { x: number, y: number } | null; activeContextId: string | null; lastActive: number; }`
- `Alert`: `{ id: string; severity: 'critical' | 'high' | 'medium' | 'low'; title: string; entity: string; assigneeId: string | null; status: 'open' | 'investigating' | 'resolved'; resolution: 'true_positive' | 'false_positive' | 'true_negative' | 'false_negative' | null; impact: 'maximum' | 'high' | 'medium' | 'low' | 'none' | null; payload: Record<string, any>; createdAt: number; }`
- `Incident`: `{ id: string; title: string; alertIds: string[]; theories: Theory[]; done: Task[]; todo: Task[]; playbookRef: string | null; slackLink: string | null; createdAt: number; }`
- `Theory`: `{ id: string; description: string; likelihood: 'high' | 'medium' | 'low'; authorId: string; }`
- `Task`: `{ id: string; description: string; completedAt: number | null; completedBy: string | null; }`
- `TimelineEvent`: `{ id: string; contextId: string; type: 'system' | 'action' | 'note'; actorId: string | 'system'; message: string; timestamp: number; }` tracking the chronological ledger of the investigation.

[Files]
Bootstrapping the Vite project and defining the precise component hierarchy within the `respondA` service directory.

- New files to be created:
  - `services/respondA/package.json`: Project and dependency configuration.
  - `services/respondA/vite.config.ts`: Vite bundler configuration.
  - `services/respondA/index.html`: Entry point for the SPA.
  - `services/respondA/src/main.tsx`: React application root.
  - `services/respondA/src/App.tsx`: Main layout wrapper and routing.
  - `services/respondA/src/styles/design-tokens.css`: Core CSS variables reflecting `UI_DESIGN_SYSTEM.md`.
  - `services/respondA/src/styles/globals.css`: Base Tailwind imports and global styles.
  - `services/respondA/src/lib/firebase.ts`: Firebase app initialization and Firestore refs.
  - `services/respondA/src/hooks/useAlerts.ts`: Hook for streaming the Triage Queue.
  - `services/respondA/src/hooks/useIncident.ts`: Hook for syncing live Incident Workspaces.
  - `services/respondA/src/hooks/usePresence.ts`: Hook for syncing multiplayer presence states.
  - `services/respondA/src/components/layout/Header.tsx`: Top navigation with active user avatars.
  - `services/respondA/src/components/triage/TriageQueue.tsx`: High-density table component for alerts.
  - `services/respondA/src/components/triage/AlertRow.tsx`: Individual alert rows.
  - `services/respondA/src/components/canvas/ActionCanvas.tsx`: Sliding 60% drawer for alert investigation.
  - `services/respondA/src/components/canvas/TelemetryBlock.tsx`: Monospace JSON payload summary viewer.
  - `services/respondA/src/components/canvas/ParryRiposte.tsx`: Layout for swift mitigations.
  - `services/respondA/src/components/canvas/AlertResolution.tsx`: Component for setting resolution/impact.
  - `services/respondA/src/components/incident/IncidentWorkspace.tsx`: 4-quadrant active investigation view.
  - `services/respondA/src/components/incident/TheoryBoard.tsx`: Collaborative root cause scratchpad.
  - `services/respondA/src/components/incident/TaskList.tsx`: Shared component for TODOs and HAVEDONEs.
  - `services/respondA/src/components/incident/SummaryGenerator.tsx`: Markdown summary creator.
  - `services/respondA/src/components/timeline/LiveTimeline.tsx`: Shared chronological ledger.
  - `services/respondA/src/components/ui/AvatarCluster.tsx`: Reusable overlapping avatars.
  - `services/respondA/src/components/ui/SeverityBadge.tsx`: Reusable stylized indicator.

[Functions]
Creation of custom React hooks and specialized utility functions bridging the frontend components to the Firestore backend.

- `resolveAlert(alertId, resolution, impact)`: Function to mark alert outcomes and close it.
- `escalateToIncident(alertId)`: Function to transition a single alert into a full collaborative incident workspace.
- `useIncident(incidentId)`: Custom hook handling real-time sync of theories, tasks, and playbook refs.
- `generateIncidentSummary(incidentId)`: Function to parse current incident state (theories, timeline, tasks) into a structured markdown report.
- `usePresence(contextId)`: Handles throttled pointer/viewing updates to a Firestore presence collection.
- `executeParry(action, alertId)`: Executes mitigation and appends timeline event.

[Classes]
Implementation of functional React components and customized contexts as the primary architectural units.

- `TriageQueue`: Orchestrates the high-density grid logic and inline rendering of active collaborators.
- `ActionCanvas`: Manages the complex split-pane view, sliding drawer animations, and alert resolution flow.
- `IncidentWorkspace`: Manages the four-quadrant view (Timeline, Theories, Actions Taken/HAVEDONE, Next Steps/TODO) keeping all analysts in sync.
- `LiveTimeline`: Renders system dots vs. analyst avatars based on chronological Firestore events.

[Dependencies]
Addition of essential NPM packages required to build the React application and interface with Firebase.

- Framework: `react`, `react-dom`
- Routing: `react-router-dom` (to navigate between Triage Queue and specific Incident Workspaces)
- Build/Dev: `vite`, `@vitejs/plugin-react`, `typescript`
- Backend: `firebase` (Native Firestore integration)
- Styling: `tailwindcss`, `postcss`, `autoprefixer`, `clsx`, `tailwind-merge`
- Icons/UI: `lucide-react`
- Utilities: `date-fns` (Timeline formatting), `react-markdown` (for rendering summaries)
- Animation: `framer-motion` (Ensuring fluid 60fps sliding for drawers and presence cursors)

[Implementation Order]
A logical sequence to scaffold the Vite application, configure the design system, and iteratively build the core flows (Triage -> Alert Resolution -> Incident).

1. Scaffold Vite React + TS project inside `services/respondA`, configuring Tailwind + Design Tokens CSS.
2. Setup Firebase initialization and define core models (Alert, Incident, Theory, Task).
3. Implement `useAlerts`, `useIncident`, and `usePresence` Firestore sync hooks.
4. Build `TriageQueue` grid and shared UI atoms (Header, SeverityBadge).
5. Build the `ActionCanvas` drawer, including the `TelemetryBlock`, `ParryRiposte`, and `AlertResolution` states.
6. Build the full `IncidentWorkspace` covering the 4 core quadrants: TheoryBoard, TaskList (TODO/HAVEDONE), and Playbook/Slack integration.
7. Implement `LiveTimeline` and embed it in both the `ActionCanvas` and `IncidentWorkspace`.
8. Implement the Markdown `SummaryGenerator` for active incidents.
9. Assemble components via React Router and conduct end-to-end testing of the escalation flows and multiplayer presence.