import type { Json } from "@/lib/supabase/database.types";
import type { AuditEvent } from "@/components/patient-audit-trail";

const ACTION_LABELS: Record<string, string> = {
  patient_created: "Patient registered",
  patient_updated: "Patient details updated",
  patient_archived: "Record archived",
  patient_merged: "Duplicate merged into this file",
  patient_deleted: "Patient deleted (legacy)",
  duplicate_reviewed: "Soft duplicate reviewed at registration",
  duplicate_resolved: "Duplicate pair marked as different patients",
};

function asRecord(value: Json | undefined): Record<string, Json | undefined> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, Json | undefined>;
}

function formatMetadata(action: string, metadata: Json): string {
  const base = ACTION_LABELS[action] ?? action.replace(/_/g, " ");
  const meta = asRecord(metadata);
  if (!meta) return base;

  if (action === "patient_merged") {
    const source = typeof meta.source_file_number === "string" ? meta.source_file_number : null;
    const copied = Array.isArray(meta.fields_copied) ? meta.fields_copied.filter((v) => typeof v === "string") : [];
    const parts = [base];
    if (source) parts.push(`from ${source}`);
    if (copied.length) parts.push(`copied: ${copied.join(", ")}`);
    return parts.join(" · ");
  }

  if (action === "patient_archived") {
    const into = typeof meta.merged_into_file_number === "string"
      ? meta.merged_into_file_number
      : typeof meta.survivor_file_number === "string"
        ? meta.survivor_file_number
        : null;
    return into ? `${base} (merged into ${into})` : base;
  }

  if (action === "duplicate_resolved" && typeof meta.reason === "string") {
    return `${base}: ${meta.reason}`;
  }

  if (action === "duplicate_reviewed" && typeof meta.review_reason === "string") {
    return `${base}: ${meta.review_reason}`;
  }

  if (action === "patient_updated") {
    const fields = Array.isArray(meta.changed_fields)
      ? meta.changed_fields.filter((v) => typeof v === "string")
      : [];
    if (fields.length) return `${base} (${fields.join(", ")})`;
  }

  return base;
}

export function mapAuditRows(
  rows: {
    id: number;
    action: string;
    metadata: Json;
    created_at: string;
    actor_user_id: string;
  }[],
  actorNames: Map<string, string>,
): AuditEvent[] {
  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    created_at: row.created_at,
    actor_name: actorNames.get(row.actor_user_id) ?? "Staff member",
    summary: formatMetadata(row.action, row.metadata),
  }));
}
