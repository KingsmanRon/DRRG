import Link from "next/link";
import { WarningIcon } from "./icons";

export type PatientListItem = {
  id: string;
  file_number: string;
  first_names: string;
  surname: string;
  date_of_birth: string;
  identity_type: string;
  identity_last4: string | null;
  phone: string;
  status: string;
  duplicate_tier?: "likely" | "possible" | null;
};

export type SortColumn = "file_number" | "name" | "date_of_birth";
export type SortDir = "asc" | "desc";

function identityLabel(patient: PatientListItem): string {
  if (patient.identity_type === "none" || !patient.identity_last4) return "No identity document";
  return `${patient.identity_type === "sa_id" ? "SA ID" : "Document"} •••• ${patient.identity_last4}`;
}

function sortHref(query: string, column: SortColumn, sort?: SortColumn, dir?: SortDir): string {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
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
}: {
  label: string;
  column: SortColumn;
  query: string;
  sort?: SortColumn;
  dir?: SortDir;
}) {
  const active = sort === column;
  const ariaSort = active ? (dir === "asc" ? "ascending" : "descending") : undefined;
  return (
    <th aria-sort={ariaSort}>
      <Link className="sortHeader" href={sortHref(query, column, sort, dir)}>
        {label}
        <span className="sortIndicator" aria-hidden="true">
          {active ? (dir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </Link>
    </th>
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
}: {
  patients: PatientListItem[];
  total: number;
  page: number;
  pageSize: number;
  heading: string;
  query: string;
  sort?: SortColumn;
  dir?: SortDir;
}) {
  const first = total === 0 ? 0 : ((page - 1) * pageSize) + 1;
  const last = Math.min(page * pageSize, total);
  return (
      <section className="patientListSection" aria-labelledby="patient-list-heading">
        <h2 id="patient-list-heading">{heading}</h2>
        <div className="patientTableWrap">
          <table className="patientTable">
            <thead>
              <tr>
                <SortableHeader label="File number" column="file_number" query={query} sort={sort} dir={dir} />
                <SortableHeader label="Patient" column="name" query={query} sort={sort} dir={dir} />
                <SortableHeader label="Date of birth" column="date_of_birth" query={query} sort={sort} dir={dir} />
                <th>Identity</th>
                <th>Phone</th>
                <th>Status</th>
                <th><span className="srOnly">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {patients.map((patient) => (
                <tr key={patient.id} className={patient.duplicate_tier ? "duplicateRow" : undefined}>
                  <td data-label="File number" className="mono">
                    <Link className="rowLink" href={`/patients/${patient.id}`}>{patient.file_number}</Link>
                  </td>
                  <td data-label="Patient">{patient.first_names} {patient.surname}</td>
                  <td data-label="Date of birth">{patient.date_of_birth}</td>
                  <td data-label="Identity">{identityLabel(patient)}</td>
                  <td data-label="Phone">{patient.phone}</td>
                  <td data-label="Status" className="statusCell">
                    {/* Payment classification and data-quality warning are
                        separate dimensions: the payment badge always shows. */}
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
                  </td>
                  <td data-label="Actions" className="rowActions">
                    <Link className="button buttonSecondary buttonSmall" href={`/patients/${patient.id}`}>Open</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {patients.length === 0 && <p className="emptyState">No patients match your search.</p>}
        </div>
        <p className="tableCount">Showing {first} to {last} of {total} patients</p>
      </section>
  );
}
