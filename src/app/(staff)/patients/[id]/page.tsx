import Link from "next/link";
import { notFound } from "next/navigation";
import { PatientAuditTrail } from "@/components/patient-audit-trail";
import { PatientEditForm, type DuplicateNotice, type PatientRecord } from "@/components/patient-edit-form";
import { PatientRestoreButton } from "@/components/patient-restore-button";
import { WarningIcon } from "@/components/icons";
import { requireStaffPage } from "@/lib/auth/session";
import { mapAuditRows } from "@/lib/patients/audit";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type PatientRow = PatientRecord & {
  merged_into: string | null;
  archived_at: string | null;
};

function formatDate(value: string | null): string {
  if (!value) return "";
  return new Date(value).toLocaleDateString("en-ZA", { year: "numeric", month: "long", day: "numeric" });
}

async function loadAuditTrail(patientId: string) {
  const supabase = await createClient();
  const { data: events, error } = await supabase
    .from("audit_events")
    .select("id, action, metadata, created_at, actor_user_id")
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false })
    .limit(40);

  // RLS: only doctors can read audit_events; staff get an empty list / error.
  if (error || !events) return [];

  const actorIds = Array.from(new Set(events.map((event) => event.actor_user_id)));
  const actorNames = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, display_name")
      .in("user_id", actorIds);
    for (const profile of profiles ?? []) {
      actorNames.set(profile.user_id, profile.display_name);
    }
  }

  return mapAuditRows(events, actorNames);
}

export default async function PatientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const staff = await requireStaffPage();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("patients")
    .select(
      "id, file_number, first_names, surname, date_of_birth, identity_type, identity_number, identity_country, no_identity_reason, phone, email, residential_address, status, merged_into, archived_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (error || !data) notFound();
  const patient = data as PatientRow;
  const auditEvents = staff.role === "doctor" ? await loadAuditTrail(id) : [];

  // Archived records are read only. Merged archives point at the survivor;
  // manually archived files can be restored by a doctor.
  if (patient.status === "archived") {
    let survivor: { id: string; file_number: string } | null = null;
    if (patient.merged_into) {
      const { data: survivorRow } = await supabase
        .from("patients")
        .select("id, file_number")
        .eq("id", patient.merged_into)
        .maybeSingle();
      survivor = survivorRow ?? null;
    }
    const canRestore = !patient.merged_into && staff.role === "doctor";

    return (
      <main className="pageShell">
        <div className="archivedBanner" role="status">
          <WarningIcon size={18} />
          <span>
            {survivor ? (
              <>
                This record was merged into{" "}
                <Link className="rowLink" href={`/patients/${survivor.id}`}>{survivor.file_number}</Link>
                {patient.archived_at ? ` on ${formatDate(patient.archived_at)}` : ""} and is read only.
              </>
            ) : (
              <>
                This record was archived{patient.archived_at ? ` on ${formatDate(patient.archived_at)}` : ""} and
                is not on the active register.
                {staff.role === "doctor"
                  ? " A doctor can restore it if it was archived in error."
                  : " Ask a doctor if it should be restored."}
              </>
            )}
          </span>
        </div>

        <div className="formTitleRow">
          <div>
            <h1>{patient.first_names} {patient.surname}</h1>
            <p className="mono muted">{patient.file_number} · Archived</p>
          </div>
          <div className="archivedActions">
            {survivor ? (
              <Link className="button buttonPrimary" href={`/patients/${survivor.id}`}>
                Open kept record {survivor.file_number}
              </Link>
            ) : canRestore ? (
              <PatientRestoreButton patientId={patient.id} fileNumber={patient.file_number} />
            ) : (
              <Link className="button buttonSecondary" href="/patients">Back to patients</Link>
            )}
          </div>
        </div>

        <section className="formPanel">
          <h2 className="formPanelHeader">Archived details (read only)</h2>
          <div className="formPanelBody">
            <dl className="archivedDetails">
              <div><dt>Date of birth</dt><dd>{patient.date_of_birth}</dd></div>
              <div>
                <dt>Identity</dt>
                <dd>
                  {patient.identity_type === "none" || !patient.identity_number
                    ? "No identity document"
                    : `${patient.identity_type === "sa_id" ? "SA ID" : "Document"} •••• ${patient.identity_number.slice(-4)}`}
                </dd>
              </div>
              <div><dt>Phone</dt><dd>{patient.phone}</dd></div>
              <div><dt>Email</dt><dd>{patient.email ?? "—"}</dd></div>
              <div><dt>Address</dt><dd>{patient.residential_address}</dd></div>
            </dl>
          </div>
        </section>

        {staff.role === "doctor" && <PatientAuditTrail events={auditEvents} />}
      </main>
    );
  }

  // Non-blocking notice when this record is part of an unresolved pair.
  const { data: flaggedRows } = await supabase
    .from("duplicate_reviews")
    .select("patient_id, candidate_patient_id")
    .eq("status", "flagged")
    .or(`patient_id.eq.${id},candidate_patient_id.eq.${id}`);

  let duplicateNotice: DuplicateNotice | null = null;
  const otherIds = Array.from(
    new Set(
      (flaggedRows ?? []).map((row) =>
        row.patient_id === id ? row.candidate_patient_id : row.patient_id,
      ),
    ),
  );
  if (otherIds.length > 0) {
    const { data: others } = await supabase
      .from("patients")
      .select("id, file_number, status")
      .in("id", otherIds)
      .eq("status", "active");
    if (others && others.length > 0) {
      duplicateNotice = {
        fileNumbers: others.map((other) => other.file_number),
        reviewHref: `/patients/duplicates?patient=${id}`,
      };
    }
  }

  return (
    <>
      <PatientEditForm patient={patient} duplicateNotice={duplicateNotice} />
      {staff.role === "doctor" && (
        <div className="pageShell auditTrailWrap">
          <PatientAuditTrail events={auditEvents} />
        </div>
      )}
    </>
  );
}
