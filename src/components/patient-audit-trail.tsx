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

export function PatientAuditTrail({
  events,
  embedded = false,
}: {
  events: AuditEvent[];
  /** When true, omit the outer panel chrome (used inside History tab). */
  embedded?: boolean;
}) {
  const body = (
    <>
      <p className="fieldHelp auditTrailHelp">
        Who registered, updated, merged, archived, or restored this file.
      </p>
      {events.length === 0 ? (
        <p className="muted">No activity recorded on this file yet.</p>
      ) : (
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
      )}
    </>
  );

  if (embedded) {
    return <div className="auditTrail embeddedAudit">{body}</div>;
  }

  return (
    <section className="formPanel auditTrail auditTrailSecondary">
      <h2 className="formPanelHeader">Activity history</h2>
      <div className="formPanelBody">{body}</div>
    </section>
  );
}

export type { AuditEvent };
