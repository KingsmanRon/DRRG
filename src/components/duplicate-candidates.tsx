import type { Candidate } from "@/lib/patients/duplicate-check";
import { WarningIcon } from "./icons";

/** Possible existing patients, shown before the form can be saved. */
export function DuplicatePanel({
  candidates,
  heading = "Possible existing patients · Review before continuing",
  children,
}: {
  candidates: Candidate[];
  heading?: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="duplicatePanel" aria-labelledby="possible-patients-heading">
      <div className="duplicatePanelHeader" id="possible-patients-heading">
        <WarningIcon />
        {heading}
      </div>
      <DuplicateCandidateList candidates={candidates} />
      {children}
    </section>
  );
}

export function DuplicateCandidateList({ candidates }: { candidates: Candidate[] }) {
  return (
    <ul className="duplicateCandidates">
      {candidates.map((candidate) => (
        <li className="duplicateCandidate" key={candidate.id}>
          <div>
            <div className="candidateName">{candidate.first_names} {candidate.surname}</div>
            <div className="candidateMeta">{candidate.file_number}</div>
            {/* The address is often why the match was found, and it cannot be
                judged without reading it. The postal code follows on its own
                line — shown for context, never as a matching signal. */}
            <div className="candidateMeta addressBlock">
              {candidate.residential_address || "No address on file"}
              {candidate.postal_code ? `\n${candidate.postal_code}` : ""}
            </div>
          </div>
          <div className="candidateMeta">Born {candidate.date_of_birth}</div>
          <div className="candidateMeta">{candidate.phone ?? "No phone on file"}</div>
          <div>
            <strong>{candidate.match_tier === "likely" ? "Likely duplicate" : "Possible duplicate"}</strong>
            <div className="candidateMeta">{formatMatchReasons(candidate.match_reasons)}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** The confirmation and written reason a match demands before a save. */
export function DuplicateReviewFields({
  reviewed,
  onReviewedChange,
  reason,
  onReasonChange,
  errors,
}: {
  reviewed: boolean;
  onReviewedChange: (value: boolean) => void;
  reason: string;
  onReasonChange: (value: string) => void;
  errors: Record<string, string>;
}) {
  return (
    <div className="formPanelBody formGrid">
      <label className="checkboxField fullWidth">
        <input
          type="checkbox"
          checked={reviewed}
          onChange={(event) => onReviewedChange(event.target.checked)}
        />
        <span>I reviewed these records and confirmed this is a different patient.</span>
      </label>
      {errors.duplicate_reviewed && <p className="fieldError">{errors.duplicate_reviewed}</p>}
      <div className="formField fullWidth">
        <label htmlFor="duplicate_review_reason">
          Reason for creating a separate patient <span className="required">*</span>
        </label>
        <textarea
          id="duplicate_review_reason"
          value={reason}
          onChange={(event) => onReasonChange(event.target.value)}
        />
        {errors.duplicate_review_reason && (
          <p className="fieldError">{errors.duplicate_review_reason}</p>
        )}
      </div>
    </div>
  );
}

export function formatMatchReasons(reasons: string[]): string {
  return reasons.map((reason) => `same ${reason}`).join(", ");
}
