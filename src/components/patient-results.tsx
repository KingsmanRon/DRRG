"use client";

import Link from "next/link";
import { useState } from "react";
import { formatDate, formatPhone, resultSummary } from "@/lib/format";
import {
  EXPAND_ALL_THRESHOLD,
  defaultExpandedFiles,
  type FileGroup,
} from "@/lib/patients/file-groups";
import { FileCard, FlatFileCard } from "./file-card";
import { ChevronRightIcon, PlusIcon } from "./icons";

export type RegisterPatient = {
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
};

/**
 * Identity document, or the amber gap where one should be (§3.8).
 * The meaning is carried by the text, so it does not rely on colour alone.
 */
function IdentityFlag({ identityType }: { identityType: string }) {
  if (identityType === "none") {
    return <span className="identityFlag identityFlagMissing">No ID</span>;
  }
  const label =
    identityType === "sa_id" ? "SA ID" : identityType === "passport" ? "Passport" : "Foreign doc.";
  return <span className="identityFlag">{label}</span>;
}

function StatusFlag({ patient }: { patient: RegisterPatient }) {
  if (patient.status !== "archived") return null;
  return <span className="identityFlag">{patient.is_merged ? "Merged" : "Archived"}</span>;
}

/** One patient inside a file. The whole row is the link — no per-row button. */
function PatientRow({
  patient,
  showFileNumber = false,
  indented = true,
}: {
  patient: RegisterPatient;
  showFileNumber?: boolean;
  indented?: boolean;
}) {
  return (
    <Link
      className={`patientRow${indented ? " patientRowIndented" : ""}`}
      href={`/patients/${patient.id}`}
    >
      <span className="patientRowMain">
        <span className="patientRowName">
          {patient.first_names} {patient.surname}
        </span>
        <span className="patientRowMeta tabularFigures">
          {formatDate(patient.date_of_birth)}
          {showFileNumber && ` · File ${patient.file_number}`}
        </span>
      </span>
      <span className="patientRowFlags">
        <StatusFlag patient={patient} />
        <IdentityFlag identityType={patient.identity_type} />
      </span>
      <ChevronRightIcon className="patientRowChevron" />
    </Link>
  );
}

export function PatientResults({
  groups,
  query,
  totalPatients,
}: {
  groups: FileGroup<RegisterPatient>[];
  query: string;
  totalPatients: number;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    defaultExpandedFiles(groups, query),
  );

  function toggle(fileNumber: string, next: boolean) {
    setExpanded((current) => {
      const updated = new Set(current);
      if (next) updated.add(fileNumber);
      else updated.delete(fileNumber);
      return updated;
    });
  }

  if (groups.length === 0) {
    return (
      <div className="emptyResults">
        <p className="emptyResultsHead">
          {query ? `No patients match “${query}”` : "No patients on the register yet"}
        </p>
        <p className="emptyResultsBody">
          {query
            ? "Check the spelling, or search by phone number."
            : "Register the first cash patient to start the register."}
        </p>
        {/* Secondary styling keeps brand green to a single element per page
            (§2 colour rules); the header's New patient is the green one. */}
        <Link className="button buttonSecondary" href="/patients/new">
          <PlusIcon size={18} />
          New patient
        </Link>
      </div>
    );
  }

  const showExpandAll = groups.length > EXPAND_ALL_THRESHOLD;

  return (
    <>
      <div className="resultsBar">
        {showExpandAll && (
          <div className="expandAllControls">
            <button
              type="button"
              className="linkButton"
              onClick={() => setExpanded(new Set(groups.map((g) => g.file_number)))}
            >
              Expand all
            </button>
            <button type="button" className="linkButton" onClick={() => setExpanded(new Set())}>
              Collapse all
            </button>
          </div>
        )}
        <p className="resultSummary tabularFigures" aria-live="polite">
          {resultSummary(totalPatients, groups.length)}
        </p>
      </div>

      <div className="fileCards">
        {groups.map((group) =>
          group.patients.length === 1 ? (
            <FlatFileCard key={group.file_number}>
              <PatientRow patient={group.patients[0]} showFileNumber indented={false} />
            </FlatFileCard>
          ) : (
            <FileCard
              key={group.file_number}
              expanded={expanded.has(group.file_number)}
              onToggle={(next) => toggle(group.file_number, next)}
              header={
                <>
                  <span className="fileCardNumber">File {group.file_number}</span>
                  <span className="fileCardCount">{group.patients.length} patients</span>
                  <span className="fileCardPhone tabularFigures">
                    {formatPhone(group.phone)}
                  </span>
                </>
              }
            >
              {group.patients.map((patient) => (
                <PatientRow key={patient.id} patient={patient} />
              ))}
            </FileCard>
          ),
        )}
      </div>
    </>
  );
}
