web application/stitch/projects/15965744641989712907/screens/5aabcf9c42784cbca30d3d61c37451b8
# The Collaborative Triage Canvas (respondA)

## Product Overview

**The Pitch:** A crisp, multiplayer incident response environment that replaces isolating dark-mode terminals with a luminous, collaborative workspace. respondA empowers security analysts to investigate threats together in real-time, executing swift "Parry" mitigations or complex "Riposte" playbooks to neutralize attacks. The platform robustly supports managing multiple concurrent incidents, allowing teams to seamlessly handle simultaneous threats without losing context.

**For:** Tier 1-3 SOC analysts and Incident Commanders who need high-signal visibility, rapid action execution, and seamless team synchronization during critical security events.

**Device:** desktop

**Design Direction:** A clean, modern aesthetic emphasizing high legibility and soft, rounded precision. Crisp analytical density meets fluid multiplayer collaboration.

**Inspired by:** Linear, Figma (multiplayer presence)

---

## Screens

- **Triage Queue:** High-density, real-time list of incoming alerts with multiplayer presence indicators.
- **Action Canvas:** Split-pane investigation space focusing on AI-suggested "Parry" and "Riposte" responses.
- **Live Timeline:** Chronological, shared investigation ledger showing automated events and analyst actions.
- **Incident Workspace:** A dedicated command area for active investigations, tracking timelines, theories, actions taken, and next steps.

---

## Key Flows

**Triage & Mitigate Flow:** Analysts coordinate to resolve a high-severity alert.

1. User is on Triage Queue -> sees `Ransomware Behavior` alert with colleague's avatar (active).
2. User clicks the alert -> opens Action Canvas, joining the live session.
3. User reviews AI suggestion -> clicks "Execute Parry (Isolate Host)".
4. Host is isolated, timeline updates instantly
5. User or AI can mark alert as resolved with categories: True or False positive/negative
6. User or AI can mark alert impact:maximum, high, medium, low, none.

**Incident Flow:** Alert is escalated to an incident for coordinated action
1. Any alert can escalate to an incident
2. An incident can be initiated without an alert
3. All incidents have main interactive components
    - A list of theories about root cause with likliehood rating
    - timeline of events (log entries, significant milestones, significant actions)
    - A running list of what has been done
    - A running list of what is left to be done
    - A reference to the incident playbook
    - A link to comm channel (slack)
    - A 'summarize' feature that creates a markdown summary of the incident at that point in time

---

<details>
<summary>Design System</summary>

## Color Palette

- **Primary:** `#0d59f2` - Custom Brand Blue for CTAs, active states, user cursors
- **Background:** `#F8F9FA` - Crisp off-white
- **Surface:** `#FFFFFF` - Cards, canvases, panels
- **Text:** `#1A1D20` - Gunmetal for primary readability
- **Muted:** `#868E96` - Steel gray for metadata, borders, secondary text
- **Accent:** `#E03131` - Crimson for critical alerts
- **Success:** `#089950` - Emerald for successful states

## Typography

- **Headings:** Space Grotesk, 600, 20-28px
- **Body:** IBM Plex Sans, 400, 14px
- **Small text:** IBM Plex Mono, 400, 12px
- **Buttons:** Space Grotesk, 500, 13px, uppercase tracking

**Style notes:** Soft 12px border radius (`ROUND_TWELVE`), subtle shadows, and thin 1px borders. UI elements feel approachable yet professional, maintaining the precision required for security operations. Multiplayer cursors and avatars use vibrant, distinct colors.

## Design Tokens

```css
:root {
  --color-primary: #0d59f2;
  --color-background: #F8F9FA;
  --color-surface: #FFFFFF;
  --color-text: #1A1D20;
  --color-muted: #868E96;
  --color-accent: #E03131;
  --color-border: #DEE2E6;
  --font-heading: 'Space Grotesk', sans-serif;
  --font-body: 'IBM Plex Sans', sans-serif;
  --font-mono: 'IBM Plex Mono', monospace;
  --radius: 12px;
  --spacing: 16px;
  --border-thin: 1px solid var(--color-border);
}
```

</details>

---

<details>
<summary>Screen Specifications</summary>

### Triage Queue

**Purpose:** Command center for viewing, filtering, and claiming incoming security alerts.

**Layout:** 240px left sidebar (filters/tags), fluid main content area (alert data grid), 48px sticky top header.

**Key Elements:**
- **Header:** 48px, white surface, bottom border. Left: "respondA" logo. Right: active user avatars.
- **Alert Grid:** High-density table. Columns: Severity, ID, Title, Entity, Assignee. Rows have 1px bottom border and soft hover states.
- **Presence Indicators:** Live cursors and glowing avatars on rows currently being viewed by other analysts.

**Components:**
- **Severity Badge:** 12px Mono font, 1px border, rounded corners.
- **Avatar Cluster:** Overlapping 24px circles, 2px white borders.

### Action Canvas

**Purpose:** Detailed investigation and response execution view for a specific alert.

**Layout:** 60% width sliding drawer from right. Split vertically: Top 40% alert details, Bottom 60% Response Actions (Parry/Riposte).

**Key Elements:**
- **Canvas Header:** Alert title, status dropdown.
- **Telemetry Block:** Monospace JSON payload summary, light gray background `#F8F9FA`, rounded 12px corners.
- **Action Split:** Two side-by-side columns. Left: **Parry** (quick actions). Right: **Riposte** (complex playbooks).

**Components:**
- **Parry Button:** Brand Blue outline, white background, rounded.
- **Riposte Card:** 1px steel border, 12px radius, contains playbook summary.

### Live Timeline

**Purpose:** Shared, real-time ledger of all events and analyst actions. Analysts can manually add information, notes, and evidence. This timeline seamlessly carries over into an incident.

**Layout:** Vertical timeline within the Action Canvas or Incident Workspace.

**Key Elements:**
- **Timeline Track:** 1px solid steel line.
- **System Event:** Monospace timestamp, gray dot.
- **Analyst Action:** Avatar replacing the dot, bold text.
- **Chat Input:** Rounded input field at the bottom.

### Incident Workspace

**Purpose:** Centralized command area for active investigations, managing the ongoing investigation across four core areas.

**Layout:** Four-quadrant/section workspace view, white background.

**Key Elements:**
- **1. Timeline:** The carried-over chronological ledger.
- **2. Active Theories:** A collaborative scratchpad for hypotheses.
- **3. Actions Taken:** A summary of past mitigations and executed actions.
- **4. Next Steps:** An active checklist of immediate to-dos.

</details>
