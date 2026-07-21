import Link from "next/link";
import { WarningIcon } from "./icons";
import type { PatientListScope } from "./patient-search";

export type PatientListItem = {
  id: string;
  file_number: string;
  first_names: string;
  surname: string;
  date_of_birth: string;
  identity_type: string;
  identity_last4: string | null;
  phone: string | null;
  status: string;
  is_merged?: boolean | null;
  duplicate_tier?: "likely" | "possible" | null;
};

export type SortColumn = "file_number" | "name" | "date_of_birth";
export type SortDir = "asc" | "desc";

function identityLabel(patient: PatientListItem): string {
  if (patient.identity_type === "none" || !patient.identity_last4) return "No identity document";
  return `${patient.identity_type === "sa_id" ? "SA ID" : "Document"} •••• ${patient.identity_last4}`;
}

function listParams(
  query: string,
  sort?: SortColumn,
  dir?: SortDir,
  scope?: PatientListScope,
): URLSearchParams {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (sort) params.set("sort", sort);
  if (dir) params.set("dir", dir);
  if (scope && scope !== "active") params.set("scope", scope);
  return params;
}

function sortHref(
  query: string,
  column: SortColumn,
  sort?: SortColumn,
  dir?: SortDir,
  scope?: PatientListScope,
): string {
  const params = listParams(query, column, sort === column && dir === "asc" ? "desc" : "asc", scope);
  params.set("sort", column);
  params.set("dir", sort === column && dir === "asc" ? "desc" : "asc");
  return `/patients?${params.toString()}`;
}

function SortableHeader({
  label,
  column,
  query,
  sort,
  dir,
  scope,
}: {
  label: string;
  column: SortColumn;
  query: string;
  sort?: SortColumn;
  dir?: SortDir;
  scope?: PatientListScope;
}) {
  const active = sort === column;
  const ariaSort = active ? (dir === "asc" ? "ascending" : "descending") : undefined;
  return (
    <th aria-sort={ariaSort}>
      <Link className="sortHeader" href={sortHref(query, column, sort, dir, scope)}>
        {label}
        <span className="sortIndicator" aria-hidden="true">
          {active ? (dir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </Link>
    </th>
  );
}

function StatusCell({ patient }: { patient: PatientListItem }) {
  if (patient.status === "archived") {
    return (
      <span className="statusCell">
        <span className={`archiveStatus${patient.is_merged ? " archiveStatusMerged" : ""}`}>
          {patient.is_merged ? "Merged" : "Archived"}
        </span>
      </span>
    );
  }

  return (
    <span className="statusCell">
      <span className="cashStatus">Cash patient</span>
      {patient.duplicate_tier && (
        <Link
          className="duplicateBadge"
          href={`/patients/duplicates?patient=${patient.id}`}
          title="Review this pair on the possible duplicates page"
        >
          <WarningIcon size={14} />
          {patient.duplicate_tier === "likely" ? "Likely duplicate" : "Possible duplicate"}
        </Link>
      )}
    </span>
  );
}

export function PatientTable({
  patients,
  total,
  page,
  pageSize,
  heading,
  query,
  sort,
  dir,
  scope = "active",
  emptyMessage,
  emptyActionHref,
  emptyActionLabel,
}: {
  patients: PatientListItem[];
  total: number;
  page: number;
  pageSize: number;
  heading: string;
  query: string;
  sort?: SortColumn;
  dir?: SortDir;
  scope?: PatientListScope;
  emptyMessage: string;
  emptyActionHref?: string;
  emptyActionLabel?: string;
}) {
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  return (
    <section className="patientListSection" aria-labelledby="patient-list-heading">
      <h2 id="patient-list-heading">{heading}</h2>
      <div className="patientTableWrap">
        <table className="patientTable">
          <thead>
            <tr>
              <SortableHeader label="File number" column="file_number" query={query} sort={sort} dir={dir} scope={scope} />
              <SortableHeader label="Patient" column="name" query={query} sort={sort} dir={dir} scope={scope} />
              <SortableHeader label="Date of birth" column="date_of_birth" query={query} sort={sort} dir={dir} scope={scope} />
              <th>Identity</th>
              <th>Phone</th>
              <th>Status</th>
              <th>
                <span className="srOnly">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {patients.map((patient) => (
              <tr
                key={patient.id}
                className={[
                  patient.duplicate_tier ? "duplicateRow" : "",
                  patient.status === "archived" ? "archivedRow" : "",
                ]
                  .filter(Boolean)
                  .join(" ") || undefined}
              >
                <td data-label="File number" className="mono">
                  <Link className="rowLink" href={`/patients/${patient.id}`}>
                    {patient.file_number}
                  </Link>
                </td>
                <td data-label="Patient">
                  {patient.first_names} {patient.surname}
                </td>
                <td data-label="Date of birth">{patient.date_of_birth}</td>
                <td data-label="Identity">{identityLabel(patient)}</td>
                <td data-label="Phone">{patient.phone ?? "—"}</td>
                <td data-label="Status">
                  <StatusCell patient={patient} />
                </td>
                <td data-label="Actions" className="rowActions">
                  <Link className="button buttonSecondary buttonSmall" href={`/patients/${patient.id}`}>
                    Open
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {patients.length === 0 && (
          <div className="emptyStatePanel">
            <p className="emptyState">{emptyMessage}</p>
            {emptyActionHref && emptyActionLabel && (
              <Link className="button buttonPrimary" href={emptyActionHref}>
                {emptyActionLabel}
              </Link>
            )}
          </div>
        )}
      </div>
      {total > 0 && (
        <p className="tableCount">
          Showing {first} to {last} of {total} {total === 1 ? "patient" : "patients"}
        </p>
      )}
    </section>
  );
}
