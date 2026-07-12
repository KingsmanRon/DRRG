type AuditEvent = {
  id: number;
  action: string;
  created_at: string;
  actor_name: string;
  summary: string;
};

function formatWhen(value: string): string {
  return new Date(value).toLocaleString("en-ZA", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function PatientAuditTrail({ events }: { events: AuditEvent[] }) {
  if (events.length === 0) {
    return (
      <section className="formPanel auditTrail">
        <h2 className="formPanelHeader">Activity history</h2>
        <div className="formPanelBody">
          <p className="muted">No audit events recorded for this file yet.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="formPanel auditTrail">
      <h2 className="formPanelHeader">Activity history</h2>
      <div className="formPanelBody">
        <p className="fieldHelp">Visible to doctors only. Shows who created, updated, merged, or reviewed this file.</p>
        <ol className="auditList">
          {events.map((event) => (
            <li key={event.id} className="auditItem">
              <div className="auditWhen mono">{formatWhen(event.created_at)}</div>
              <div>
                <div className="auditAction">{event.summary}</div>
                <div className="candidateMeta">{event.actor_name}</div>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export type { AuditEvent };
