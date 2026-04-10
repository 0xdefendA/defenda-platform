import type { Incident, TimelineEvent, Theory, Task } from '../types';
import { format } from 'date-fns';

export const generateMarkdownSummary = (incident: Incident, events: TimelineEvent[]) => {
    const now = new Date();

    let markdown = `# Incident Summary: ${incident.title}\n`;
    markdown += `**Generated At:** ${format(now, 'yyyy-MM-dd HH:mm:ss')}\n`;
    markdown += `**Incident ID:** ${incident.id}\n\n`;

    markdown += `## Status Overview\n`;
    markdown += `- **Theories:** ${incident.theories?.length || 0} active hypotheses\n`;
    markdown += `- **Actions Taken:** ${incident.done?.length || 0} tasks completed\n`;
    markdown += `- **Pending Tasks:** ${incident.todo?.length || 0} tasks remaining\n\n`;

    if (incident.theories && incident.theories.length > 0) {
        markdown += `## Active Theories\n`;
        incident.theories.forEach((t: Theory) => {
            markdown += `- [${t.likelihood.toUpperCase()}] ${t.description}\n`;
        });
        markdown += `\n`;
    }

    if (incident.done && incident.done.length > 0) {
        markdown += `## Actions Taken (HAVEDONE)\n`;
        incident.done.forEach((d: Task) => {
            markdown += `- ${d.description} (Completed by: ${d.completedBy || 'System'})\n`;
        });
        markdown += `\n`;
    }

    if (incident.todo && incident.todo.length > 0) {
        markdown += `## Next Steps (TODO)\n`;
        incident.todo.forEach((t: Task) => {
            markdown += `- [ ] ${t.description}\n`;
        });
        markdown += `\n`;
    }

    if (events.length > 0) {
        markdown += `## Key Timeline Events\n`;
        events.forEach(e => {
            markdown += `- \`${format(e.timestamp, 'yyyy-MM-dd HH:mm:ss')}\` **${e.actorId}**: ${e.message}\n`;
        });
    }

    return markdown;
};
