"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useRef, useState } from "react";
import { matchBanner, type DuplicateTier } from "@/lib/patients/duplicate-score";
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
  match_score: number;
  match_tier: DuplicateTier;
  match_reasons: string[];
  identity_match: boolean;
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

type RowState = "match" | "differ" | "missing";

function rowState(a: string, b: string): RowState {
  if (a.trim() === "" || b.trim() === "") return "missing";
  return eq(a, b) ? "match" : "differ";
}

// Match/differ state is announced in text as well as colour (screen readers,
// colour-blind users).
function RowStateTag({ state }: { state: RowState }) {
  if (state === "match") return <span className="dupRowState dupStateMatch">✓ Match</span>;
  if (state === "differ") return <span className="dupRowState dupStateDiffer">≠ Differs</span>;
  return <span className="dupRowState dupStateMissing">— Missing</span>;
}

function cellClass(state: RowState, side: "a" | "b", aEmpty: boolean, bEmpty: boolean): string {
  if (state === "match") return "dupMatch";
  if (state === "differ") return "dupConflict";
  return (side === "a" ? aEmpty : bEmpty) ? "dupMissing" : "";
}

type MergePlan = {
  survivor: Side;
  source: Side;
  copies: string[];
  conflicts: { field: string; kept: string; discarded: string }[];
};

// Preview of what the server-side merge will do, for the confirmation step.
// The survivor keeps its values; empty survivor fields are filled from the
// source. Mirrors merge_patients in the database.
function planMerge(survivor: Side, source: Side, identityMatch: boolean): MergePlan {
  const copies: string[] = [];
  const conflicts: MergePlan["conflicts"] = [];

  if (!survivor.email && source.email) copies.push(`email (${source.email})`);
  else if (survivor.email && source.email && !eq(survivor.email, source.email)) {
    conflicts.push({ field: "Email", kept: survivor.email, discarded: source.email });
  }

  const survivorHasDoc = survivor.identity_type !== "none";
  const sourceHasDoc = source.identity_type !== "none";
  if (!survivorHasDoc && sourceHasDoc) copies.push(`identity document (${identityLabel(source)})`);
  else if (survivorHasDoc && sourceHasDoc && !identityMatch) {
    conflicts.push({ field: "Identity", kept: identityLabel(survivor), discarded: identityLabel(source) });
  }

  const fullName = (side: Side) => `${side.first_names} ${side.surname}`;
  if (!eq(fullName(survivor), fullName(source))) {
    conflicts.push({ field: "Name", kept: fullName(survivor), discarded: fullName(source) });
  }
  if (survivor.date_of_birth !== source.date_of_birth) {
    conflicts.push({ field: "Date of birth", kept: survivor.date_of_birth, discarded: source.date_of_birth });
  }
  if (!eq(survivor.phone, source.phone)) {
    conflicts.push({ field: "Phone", kept: survivor.phone, discarded: source.phone });
  }
  if (!eq(survivor.residential_address, source.residential_address)) {
    conflicts.push({ field: "Address", kept: survivor.residential_address, discarded: source.residential_address });
  }

  return { survivor, source, copies, conflicts };
}

export function DuplicateResolver({
  reviews: initialReviews,
  focusPatientId,
}: {
  reviews: DuplicateReview[];
  focusPatientId?: string;
}) {
  const router = useRouter();
  const [reviews, setReviews] = useState<DuplicateReview[]>(initialReviews);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<Record<string, string>>({});
  const [keepBothId, setKeepBothId] = useState<string | null>(null);
  const [reason, setReason] = useState<Record<string, string>>({});
  const [mergePlan, setMergePlan] = useState<{ reviewId: string; plan: MergePlan } | null>(null);
  const [resolvedMessage, setResolvedMessage] = useState("");
  const focusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    focusRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, []);

  const likelyCount = reviews.filter((review) => review.match_tier === "likely").length;
  const possibleCount = reviews.length - likelyCount;

  function setRowError(reviewId: string, message: string) {
    setError((current) => ({ ...current, [reviewId]: message }));
  }

  function removeReview(reviewId: string, message: string) {
    setReviews((current) => current.filter((item) => item.review_id !== reviewId));
    setMergePlan(null);
    setKeepBothId(null);
    setResolvedMessage(message);
    router.refresh();
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
    removeReview(
      review.review_id,
      `${review.patient.file_number} and ${review.candidate.file_number} kept as different patients.`,
    );
  }

  async function confirmMerge(review: DuplicateReview, plan: MergePlan) {
    setBusyId(review.review_id);
    setRowError(review.review_id, "");
    const response = await fetch("/api/patients/duplicates/merge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ survivor_id: plan.survivor.id, source_id: plan.source.id }),
    });
    setBusyId(null);
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setRowError(review.review_id, body.error ?? "The records could not be merged.");
      if (response.status === 409) setMergePlan(null);
      return;
    }
    // The merged (archived) record may appear in other pairs; drop those too —
    // the server has repointed or resolved them.
    const sourceId = plan.source.id;
    setReviews((current) =>
      current.filter(
        (item) =>
          item.review_id !== review.review_id &&
          item.patient.id !== sourceId &&
          item.candidate.id !== sourceId,
      ),
    );
    setMergePlan(null);
    setResolvedMessage(
      `${plan.source.file_number} was merged into ${plan.survivor.file_number}. The old file number still finds this patient.`,
    );
    router.refresh();
  }

  if (reviews.length === 0) {
    return (
      <>
        <p className="dupCount" role="status">
          {resolvedMessage ? `${resolvedMessage} ` : ""}No pairs left to review.
        </p>
        <section className="patientListSection">
          <p className="emptyState">No possible duplicates need review right now.</p>
        </section>
      </>
    );
  }

  return (
    <div>
      <p className="dupCount" role="status">
        {reviews.length} {reviews.length === 1 ? "pair" : "pairs"} to review
        {" · "}
        {likelyCount} likely · {possibleCount} possible
        {resolvedMessage ? ` — ${resolvedMessage}` : ""}
      </p>

      <div className="duplicateReviewList">
        {reviews.map((review) => {
          const { patient: a, candidate: b } = review;
          const busy = busyId === review.review_id;
          const isKeepBoth = keepBothId === review.review_id;
          const activeMerge = mergePlan?.reviewId === review.review_id ? mergePlan.plan : null;
          const isFocused = focusPatientId === a.id || focusPatientId === b.id;
          const rows = [
            { label: "Date of birth", a: a.date_of_birth, b: b.date_of_birth, state: rowState(a.date_of_birth, b.date_of_birth) },
            {
              label: "Identity",
              a: identityLabel(a),
              b: identityLabel(b),
              // Masked values can collide, so identity match comes from the
              // server-side comparison of the full numbers.
              state: (a.identity_type === "none" || b.identity_type === "none"
                ? "missing"
                : review.identity_match
                  ? "match"
                  : "differ") as RowState,
            },
            { label: "Phone", a: a.phone, b: b.phone, state: rowState(a.phone, b.phone) },
            { label: "Email", a: a.email ?? "", b: b.email ?? "", state: rowState(a.email ?? "", b.email ?? "") },
            { label: "Address", a: a.residential_address, b: b.residential_address, state: rowState(a.residential_address, b.residential_address) },
          ];

          return (
            <section
              className={`dupCard${review.match_tier === "likely" ? " dupCardLikely" : ""}${isFocused ? " dupCardFocus" : ""}`}
              key={review.review_id}
              id={`pair-${review.review_id}`}
              ref={isFocused ? (node) => { if (!focusRef.current) focusRef.current = node; } : undefined}
            >
              <div className={`dupBanner${review.match_tier === "likely" ? " dupBannerLikely" : ""}`}>
                <WarningIcon size={18} />
                <strong>
                  {matchBanner({ score: review.match_score, tier: review.match_tier, reasons: review.match_reasons })}
                </strong>
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
                  const aEmpty = row.a.trim() === "";
                  const bEmpty = row.b.trim() === "";
                  return (
                    <Fragment key={row.label}>
                      <div className="dupRowLabel">
                        {row.label}
                        <RowStateTag state={row.state} />
                      </div>
                      <div className={`dupCell ${cellClass(row.state, "a", aEmpty, bEmpty)}`}>{row.a || "—"}</div>
                      <div className={`dupCell dupColB ${cellClass(row.state, "b", aEmpty, bEmpty)}`}>{row.b || "—"}</div>
                    </Fragment>
                  );
                })}

                <div className="dupCorner" />
                <div className="dupColActions">
                  <Link className="button buttonSecondary" href={`/patients/${a.id}`}>View record</Link>
                  <button
                    type="button"
                    className="button buttonSecondary buttonSmall"
                    disabled={busy}
                    onClick={() => {
                      setKeepBothId(null);
                      setRowError(review.review_id, "");
                      setMergePlan({ reviewId: review.review_id, plan: planMerge(a, b, review.identity_match) });
                    }}
                  >
                    Merge — keep this record
                  </button>
                </div>
                <div className="dupColActions dupColB">
                  <Link className="button buttonSecondary" href={`/patients/${b.id}`}>View record</Link>
                  <button
                    type="button"
                    className="button buttonSecondary buttonSmall"
                    disabled={busy}
                    onClick={() => {
                      setKeepBothId(null);
                      setRowError(review.review_id, "");
                      setMergePlan({ reviewId: review.review_id, plan: planMerge(b, a, review.identity_match) });
                    }}
                  >
                    Merge — keep this record
                  </button>
                </div>
              </div>

              <div className="dupFooter">
                {error[review.review_id] && <div className="formErrorBanner" role="alert">{error[review.review_id]}</div>}

                {activeMerge ? (
                  <div className="mergeConfirmPanel">
                    <h3>Confirm merge</h3>
                    <p>
                      Keep <strong>{activeMerge.survivor.file_number}</strong> ({activeMerge.survivor.first_names} {activeMerge.survivor.surname}).
                      Archive <strong>{activeMerge.source.file_number}</strong> ({activeMerge.source.first_names} {activeMerge.source.surname}) —
                      it is kept for the record and its file number will still find the kept patient.
                      Nothing is deleted.
                    </p>
                    {activeMerge.copies.length > 0 && (
                      <p>Copied onto the kept record: {activeMerge.copies.join(", ")}.</p>
                    )}
                    {activeMerge.conflicts.length > 0 && (
                      <div>
                        <p>Both records have these fields; the kept record&apos;s value wins:</p>
                        <ul className="mergeConflictList">
                          {activeMerge.conflicts.map((conflict) => (
                            <li key={conflict.field}>
                              <strong>{conflict.field}:</strong> keeps “{conflict.kept}”, archives “{conflict.discarded}”
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div className="dangerActions">
                      {/* Cancel is the default/safe action; the confirm is explicit. */}
                      <button type="button" className="button buttonPrimary" disabled={busy} onClick={() => setMergePlan(null)} autoFocus>
                        Cancel
                      </button>
                      <button type="button" className="button buttonSecondary" disabled={busy} onClick={() => confirmMerge(review, activeMerge)}>
                        {busy ? "Merging" : `Confirm — merge into ${activeMerge.survivor.file_number}`}
                      </button>
                    </div>
                  </div>
                ) : !isKeepBoth ? (
                  <button
                    type="button"
                    className="button buttonSecondary dupKeepBoth"
                    disabled={busy}
                    onClick={() => { setKeepBothId(review.review_id); setRowError(review.review_id, ""); }}
                  >
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
                      <button type="button" className="button buttonSecondary" disabled={busy} onClick={() => setKeepBothId(null)}>Cancel</button>
                      <button type="button" className="button buttonPrimary" disabled={busy} onClick={() => keepBoth(review)}>{busy ? "Saving" : "Confirm — keep both"}</button>
                    </div>
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
