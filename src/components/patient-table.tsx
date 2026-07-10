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
  possible_duplicate?: boolean;
};

function identityLabel(patient: PatientListItem): string {
  if (patient.identity_type === "none" || !patient.identity_last4) return "No identity document";
  return `${patient.identity_type === "sa_id" ? "SA ID" : "Document"} •••• ${patient.identity_last4}`;
}

export function PatientTable({
  patients,
  total,
  page,
  pageSize,
  heading,
}: {
  patients: PatientListItem[];
  total: number;
  page: number;
  pageSize: number;
  heading: string;
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
                <th>File number</th>
                <th>Patient</th>
                <th>Date of birth</th>
                <th>Identity</th>
                <th>Phone</th>
                <th>Status</th>
                <th><span className="srOnly">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {patients.map((patient) => (
                <tr key={patient.id} className={patient.possible_duplicate ? "duplicateRow" : undefined}>
                  <td data-label="File number" className="mono">
                    <Link className="rowLink" href={`/patients/${patient.id}`}>{patient.file_number}</Link>
                  </td>
                  <td data-label="Patient">{patient.first_names} {patient.surname}</td>
                  <td data-label="Date of birth">{patient.date_of_birth}</td>
                  <td data-label="Identity">{identityLabel(patient)}</td>
                  <td data-label="Phone">{patient.phone}</td>
                  <td data-label="Status">
                    {patient.possible_duplicate ? (
                      <span className="warningStatus"><WarningIcon size={18} />Possible duplicate</span>
                    ) : (
                      <span className="cashStatus">Cash patient</span>
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
