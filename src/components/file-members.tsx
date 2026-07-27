import Link from "next/link";
import { PlusIcon } from "./icons";

/** Another active patient sharing this file number. */
export type FileMember = {
  id: string;
  first_names: string;
  surname: string;
  date_of_birth: string;
};

/**
 * The household behind a file number. One file can cover a whole family, so
 * this lists everyone else on it and is the entry point for adding the next
 * person — the only route that is allowed to reuse an existing file number.
 */
export function FileMembersPanel({
  fileNumber,
  members,
}: {
  fileNumber: string;
  members: FileMember[];
}) {
  const addHref = `/patients/new?file=${encodeURIComponent(fileNumber)}`;

  return (
    <section className="formPanel filePanel" aria-labelledby="file-members-heading">
      <h2 className="formPanelHeader" id="file-members-heading">
        People on this file
        {members.length > 0 && (
          <span className="filePanelCount">{members.length + 1} people</span>
        )}
      </h2>
      <div className="formPanelBody">
        {members.length === 0 ? (
          <p className="fieldHelp">
            This patient is the only person on <span className="mono">{fileNumber}</span>. Add a
            family member to put them on the same file number.
          </p>
        ) : (
          <ul className="fileMembers">
            {members.map((member) => (
              <li key={member.id}>
                <Link className="rowLink" href={`/patients/${member.id}`}>
                  {member.first_names} {member.surname}
                </Link>
                <span className="candidateMeta">Born {member.date_of_birth}</span>
              </li>
            ))}
          </ul>
        )}
        <Link className="button buttonSecondary" href={addHref}>
          <PlusIcon size={18} />
          Add a person to this file
        </Link>
      </div>
    </section>
  );
}
