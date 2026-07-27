"use client";

import Link from "next/link";
import { formatDate } from "@/lib/format";
import { FileCard } from "./file-card";
import { ChevronRightIcon, UsersIcon } from "./icons";

/** An active patient on this file, including the one being viewed. */
export type FileMember = {
  id: string;
  first_names: string;
  surname: string;
  date_of_birth: string;
};

/**
 * The household behind a file number (§4.3).
 *
 * Sits below the patient's own details: the record you opened outranks the
 * other people who happen to share its file number. Collapsed by default for
 * the same reason. Copy says "member" rather than "person" — and deliberately
 * not "main member", which is medical-scheme language and wrong for a cash
 * register.
 */
export function FileMembersPanel({
  fileNumber,
  members,
  currentPatientId,
}: {
  fileNumber: string;
  /** Everyone on the file, including the current patient. */
  members: FileMember[];
  currentPatientId: string;
}) {
  const count = members.length;

  return (
    <FileCard
      header={
        <>
          <UsersIcon className="fileCardIcon" />
          <span className="fileCardNumber">File {fileNumber}</span>
          <span className="fileCardCount">
            {count > 1 ? `Family file · ${count} members` : "1 member"}
          </span>
        </>
      }
    >
      {members.map((member) =>
        member.id === currentPatientId ? (
          <div key={member.id} className="patientRow patientRowIndented patientRowCurrent">
            <span className="patientRowMain">
              <span className="patientRowName">
                {member.first_names} {member.surname}
              </span>
              <span className="patientRowMeta tabularFigures">
                {formatDate(member.date_of_birth)}
              </span>
            </span>
            <span className="patientRowViewing">viewing now</span>
          </div>
        ) : (
          <Link
            key={member.id}
            className="patientRow patientRowIndented"
            href={`/patients/${member.id}`}
          >
            <span className="patientRowMain">
              <span className="patientRowName">
                {member.first_names} {member.surname}
              </span>
              <span className="patientRowMeta tabularFigures">
                {formatDate(member.date_of_birth)}
              </span>
            </span>
            <ChevronRightIcon className="patientRowChevron" />
          </Link>
        ),
      )}

      <div className="fileCardFooter">
        <Link
          className="rowLink"
          href={`/patients/new?file=${encodeURIComponent(fileNumber)}`}
        >
          Add a member to this file
        </Link>
        <span className="fileCardNote">Phone and address are shared by the file</span>
      </div>
    </FileCard>
  );
}
