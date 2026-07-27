"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronRightIcon, WarningIcon } from "./icons";
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
  /** How many active patients share this row's file number (1 = just them). */
  file_member_count?: number | null;
};

export type SortColumn = "file_number" | "name" | "date_of_birth";
export type SortDir = "asc" | "desc";

/** Rows sharing a file number, kept in the order the search returned them. */
type FileGroup = {
  file_number: string;
  patients: PatientListItem[];
  /** Active people on the file overall — may exceed what this page shows. */
  totalOnFile: number;
};

function groupByFile(patients: PatientListItem[]): FileGroup[] {
  const groups = new Map<string, FileGroup>();
  for (const patient of patients) {
    const existing = groups.get(patient.file_number);
    if (existing) {
      existing.patients.push(patient);
    } else {
      groups.set(patient.file_number, {
        file_number: patient.file_number,
        patients: [patient],
        totalOnFile: patient.file_member_count ?? 1,
      });
    }
  }
  return [...groups.values()];
}

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

/** One patient's row — identical whether or not it sits inside a file group. */
function PatientRow({ patient, nested }: { patient: PatientListItem; nested?: boolean }) {
  return (
    <tr
      className={[
        patient.duplicate_tier ? "duplicateRow" : "",
        patient.status === "archived" ? "archivedRow" : "",
        nested ? "fileMemberRow" : "",
      ]
        .filter(Boolean)
        .join(" ") || undefined}
    >
      <td data-label="File number" className="mono">
        {nested ? null : (
          <Link className="rowLink" href={`/patients/${patient.id}`}>
            {patient.file_number}
          </Link>
        )}
      </td>
      <td data-label="Patient">
        {nested ? (
          <Link className="rowLink" href={`/patients/${patient.id}`}>
            {patient.first_names} {patient.surname}
          </Link>
        ) : (
          <>
            {patient.first_names} {patient.surname}
          </>
        )}
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
  );
}

/**
 * A file shared by several patients: one header row that expands.
 *
 * Without this the file number, its "N people" badge and the shared phone
 * repeat identically on every row, which reads as a duplicated record when it
 * is really one household file.
 */
function FileGroupRows({ group, defaultOpen }: { group: FileGroup; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = `file-group-${group.file_number.replace(/[^A-Za-z0-9_-]/g, "")}`;
  const shown = group.patients.length;
  const names = group.patients.map((p) => `${p.first_names} ${p.surname}`).join(" · ");
  // Everyone on the file usually shares one number; only claim it when they do.
  const phones = new Set(group.patients.map((p) => p.phone ?? ""));
  const sharedPhone = phones.size === 1 ? group.patients[0].phone : null;

  return (
    <tbody className="fileGroup" id={bodyId}>
      <tr className="fileGroupRow">
        <td colSpan={7}>
          <button
            type="button"
            className="fileGroupToggle"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setOpen((current) => !current)}
          >
            <ChevronRightIcon
              size={16}
              className={`fileGroupChevron${open ? " fileGroupChevronOpen" : ""}`}
            />
            <span className="mono fileGroupNumber">{group.file_number}</span>
            <span className="familyBadge">
              {group.totalOnFile} people
              {shown < group.totalOnFile ? ` · ${shown} on this page` : ""}
            </span>
            <span className="fileGroupNames">{names}</span>
            {sharedPhone && <span className="fileGroupPhone">{sharedPhone}</span>}
          </button>
        </td>
      </tr>
      {open && group.patients.map((patient) => (
        <PatientRow key={patient.id} patient={patient} nested />
      ))}
    </tbody>
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
  const groups = groupByFile(patients);
  // A search is someone looking for a person, so open the files it matched.
  // Browsing the register keeps them shut so the list stays short.
  const openByDefault = query.trim().length > 0;

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
          {groups.map((group) =>
            group.patients.length > 1 ? (
              <FileGroupRows key={group.file_number} group={group} defaultOpen={openByDefault} />
            ) : (
              <tbody key={group.file_number}>
                <PatientRow patient={group.patients[0]} />
              </tbody>
            ),
          )}
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
