"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useState } from "react";
import { WarningIcon } from "./icons";

type Side = {
  id: string;
  file_number: string;
  first_names: string;
  surname: string;
  date_of_birth: string;
  identity_type: string;
  identity_last4: string | null;
  phone: string;
  email: string | null;
  residential_address: string;
  status: string;
};

export type DuplicateReview = {
  review_id: string;
  reviewed_at: string;
  review_reason: string;
  patient: Side;
  candidate: Side;
};

function identityLabel(side: Side): string {
  if (side.identity_type === "none" || !side.identity_last4) return "No document";
  return `${side.identity_type === "sa_id" ? "SA ID" : "Document"} •••• ${side.identity_last4}`;
}

function eq(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

// Per-cell highlight: matching (green), conflicting (amber), missing (grey).
function cellClasses(a: string, b: string): [string, string] {
  const am = a.trim() === "";
  const bm = b.trim() === "";
  if (am && bm) return ["dupMissing", "dupMissing"];
  if (am) return ["dupMissing", ""];
  if (bm) return ["", "dupMissing"];
  return eq(a, b) ? ["dupMatch", "dupMatch"] : ["dupConflict", "dupConflict"];
}

function humanJoin(items: string[]): string {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function matchSummary(a: Side, b: Side): string {
  const fields: string[] = [];
  if (eq(`${a.first_names} ${a.surname}`, `${b.first_names} ${b.surname}`)) fields.push("name");
  if (eq(a.date_of_birth, b.date_of_birth)) fields.push("date of birth");
  if (eq(identityLabel(a), identityLabel(b))) fields.push("identity");
  if (eq(a.phone, b.phone)) fields.push("phone");
  if (eq(a.residential_address, b.residential_address)) fields.push("address");
  return fields.length
    ? `Matching ${humanJoin(fields)}`
    : "Matching details were found during registration";
}

export function DuplicateResolver({ reviews: initialReviews }: { reviews: DuplicateReview[] }) {
  const router = useRouter();
  const [reviews, setReviews] = useState<DuplicateReview[]>(initialReviews);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<Record<string, string>>({});
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [reason, setReason] = useState<Record<string, string>>({});

  function setRowError(reviewId: string, message: string) {
    setError((current) => ({ ...current, [reviewId]: message }));
  }

  async function keepBoth(review: DuplicateReview) {
    const text = (reason[review.review_id] ?? "").trim();
    if (text.length < 5) {
      setRowError(review.review_id, "Record why these are different patients (at least 5 characters).");
      return;
    }
    setBusyId(review.review_id);
    setRowError(review.review_id, "");
    const response = await fetch("/api/patients/duplicates/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ patient_id: review.patient.id, candidate_id: review.candidate.id, reason: text }),
    });
    setBusyId(null);
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setRowError(review.review_id, body.error ?? "Could not resolve this pair.");
      return;
    }
    setReviews((current) => current.filter((item) => item.review_id !== review.review_id));
    router.refresh();
  }

  async function deleteSide(review: DuplicateReview, side: Side) {
    if (!window.confirm(`Permanently delete file ${side.file_number} (${side.first_names} ${side.surname})? This cannot be undone.`)) {
      return;
    }
    setBusyId(review.review_id);
    setRowError(review.review_id, "");
    const kept = side.id === review.patient.id ? review.candidate.file_number : review.patient.file_number;
    const response = await fetch(`/api/patients/${side.id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: `Duplicate resolution: kept ${kept}` }),
    });
    setBusyId(null);
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setRowError(review.review_id, body.error ?? "Could not delete this file.");
      return;
    }
    setReviews((current) => current.filter((item) => item.patient.id !== side.id && item.candidate.id !== side.id));
    router.refresh();
  }

  if (reviews.length === 0) {
    return (
      <section className="patientListSection">
        <p className="emptyState">No possible duplicates need review right now.</p>
      </section>
    );
  }

  return (
    <div className="duplicateReviewList">
      {reviews.map((review) => {
        const { patient: a, candidate: b } = review;
        const isResolving = resolvingId === review.review_id;
        const busy = busyId === review.review_id;
        const rows = [
          { label: "Date of birth", a: a.date_of_birth, b: b.date_of_birth },
          { label: "Identity", a: identityLabel(a), b: identityLabel(b) },
          { label: "Phone", a: a.phone, b: b.phone },
          { label: "Email", a: a.email ?? "", b: b.email ?? "" },
          { label: "Address", a: a.residential_address, b: b.residential_address },
        ];

        return (
          <section className="dupCard" key={review.review_id}>
            <div className="dupBanner">
              <WarningIcon size={18} />
              <strong>Possible duplicate</strong>
              <span className="dupBannerReason">· {matchSummary(a, b)}</span>
            </div>

            <div className="dupCompare">
              <div className="dupCorner dupCornerHead" />
              <div className="dupColHead">
                <span className="dupFileBadge mono">{a.file_number}</span>
                <span className="dupName">{a.first_names} {a.surname}</span>
              </div>
              <div className="dupColHead dupColB">
                <span className="dupFileBadge mono">{b.file_number}</span>
                <span className="dupName">{b.first_names} {b.surname}</span>
              </div>

              {rows.map((row) => {
                const [ca, cb] = cellClasses(row.a, row.b);
                return (
                  <Fragment key={row.label}>
                    <div className="dupRowLabel">{row.label}</div>
                    <div className={`dupCell ${ca}`}>{row.a || "—"}</div>
                    <div className={`dupCell dupColB ${cb}`}>{row.b || "—"}</div>
                  </Fragment>
                );
              })}

              <div className="dupCorner" />
              <div className="dupColActions">
                <Link className="button buttonSecondary" href={`/patients/${a.id}`}>View record</Link>
                <button type="button" className="button buttonDangerOutline buttonSmall" disabled={busy} onClick={() => deleteSide(review, a)}>Delete record</button>
              </div>
              <div className="dupColActions dupColB">
                <Link className="button buttonSecondary" href={`/patients/${b.id}`}>View record</Link>
                <button type="button" className="button buttonDangerOutline buttonSmall" disabled={busy} onClick={() => deleteSide(review, b)}>Delete record</button>
              </div>
            </div>

            <div className="dupFooter">
              {error[review.review_id] && <div className="formErrorBanner" role="alert">{error[review.review_id]}</div>}
              {!isResolving ? (
                <button type="button" className="button buttonSecondary dupKeepBoth" disabled={busy} onClick={() => { setResolvingId(review.review_id); setRowError(review.review_id, ""); }}>
                  Different patients — keep both
                </button>
              ) : (
                <div className="keepBothPanel">
                  <div className="formField">
                    <label htmlFor={`reason-${review.review_id}`}>Reason these are different patients <span className="required">*</span></label>
                    <textarea
                      id={`reason-${review.review_id}`}
                      value={reason[review.review_id] ?? ""}
                      onChange={(event) => setReason((current) => ({ ...current, [review.review_id]: event.target.value }))}
                      placeholder="For example, siblings sharing a phone number, confirmed in person"
                    />
                  </div>
                  <div className="dangerActions">
                    <button type="button" className="button buttonSecondary" disabled={busy} onClick={() => setResolvingId(null)}>Cancel</button>
                    <button type="button" className="button buttonPrimary" disabled={busy} onClick={() => keepBoth(review)}>{busy ? "Saving" : "Confirm — keep both"}</button>
                  </div>
                </div>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
