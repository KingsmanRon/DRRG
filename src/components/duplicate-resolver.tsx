"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
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

function CompareRow({ label, a, b }: { label: string; a: string; b: string }) {
  const differs = a.trim().toLowerCase() !== b.trim().toLowerCase();
  return (
    <tr className={differs ? undefined : "compareMatch"}>
      <th scope="row">{label}</th>
      <td>{a || "—"}</td>
      <td>{b || "—"}</td>
    </tr>
  );
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
    const response = await fetch(`/api/patients/${side.id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: `Duplicate resolution: kept ${side.id === review.patient.id ? review.candidate.file_number : review.patient.file_number}` }),
    });
    setBusyId(null);
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setRowError(review.review_id, body.error ?? "Could not delete this file.");
      return;
    }
    // Drop every pending pair that referenced the deleted patient.
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
        return (
          <section className="duplicateReviewCard" key={review.review_id}>
            <div className="duplicatePanelHeader"><WarningIcon />Possible duplicate</div>
            <p className="candidateMeta reviewReason">Flagged at onboarding: {review.review_reason}</p>

            <div className="compareTableWrap">
              <table className="compareTable">
                <thead>
                  <tr>
                    <th scope="col"><span className="srOnly">Field</span></th>
                    <th scope="col"><Link className="rowLink mono" href={`/patients/${a.id}`}>{a.file_number}</Link></th>
                    <th scope="col"><Link className="rowLink mono" href={`/patients/${b.id}`}>{b.file_number}</Link></th>
                  </tr>
                </thead>
                <tbody>
                  <CompareRow label="Name" a={`${a.first_names} ${a.surname}`} b={`${b.first_names} ${b.surname}`} />
                  <CompareRow label="Date of birth" a={a.date_of_birth} b={b.date_of_birth} />
                  <CompareRow label="Identity" a={identityLabel(a)} b={identityLabel(b)} />
                  <CompareRow label="Phone" a={a.phone} b={b.phone} />
                  <CompareRow label="Email" a={a.email ?? ""} b={b.email ?? ""} />
                  <CompareRow label="Address" a={a.residential_address} b={b.residential_address} />
                </tbody>
              </table>
            </div>

            {error[review.review_id] && <div className="formErrorBanner" role="alert">{error[review.review_id]}</div>}

            <div className="duplicateReviewActions">
              <div className="sideActions">
                <Link className="button buttonSecondary buttonSmall" href={`/patients/${a.id}`}>Open {a.file_number}</Link>
                <button type="button" className="button buttonDanger buttonSmall" disabled={busy} onClick={() => deleteSide(review, a)}>Delete {a.file_number}</button>
              </div>
              <div className="sideActions">
                <Link className="button buttonSecondary buttonSmall" href={`/patients/${b.id}`}>Open {b.file_number}</Link>
                <button type="button" className="button buttonDanger buttonSmall" disabled={busy} onClick={() => deleteSide(review, b)}>Delete {b.file_number}</button>
              </div>
            </div>

            {!isResolving ? (
              <button type="button" className="button buttonPrimary" disabled={busy} onClick={() => { setResolvingId(review.review_id); setRowError(review.review_id, ""); }}>
                These are different people — keep both
              </button>
            ) : (
              <div className="formGrid keepBothPanel">
                <div className="formField fullWidth">
                  <label htmlFor={`reason-${review.review_id}`}>Reason these are different patients <span className="required">*</span></label>
                  <textarea
                    id={`reason-${review.review_id}`}
                    value={reason[review.review_id] ?? ""}
                    onChange={(event) => setReason((current) => ({ ...current, [review.review_id]: event.target.value }))}
                    placeholder="For example, siblings sharing a phone number, confirmed in person"
                  />
                </div>
                <div className="dangerActions fullWidth">
                  <button type="button" className="button buttonSecondary" disabled={busy} onClick={() => setResolvingId(null)}>Cancel</button>
                  <button type="button" className="button buttonPrimary" disabled={busy} onClick={() => keepBoth(review)}>{busy ? "Saving" : "Confirm — not a duplicate"}</button>
                </div>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
