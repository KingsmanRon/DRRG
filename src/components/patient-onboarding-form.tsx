"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { CONSENT_TEXT, CONSENT_TEXT_HASH, CONSENT_VERSION } from "@/lib/consent";
import { isValidSouthAfricanId } from "@/lib/patients/sa-id";
import { WarningIcon } from "./icons";

type IdentityType = "sa_id" | "passport" | "foreign_document" | "none";

type Candidate = {
  id: string;
  file_number: string;
  first_names: string;
  surname: string;
  date_of_birth: string;
  phone: string;
  identity_last4: string | null;
  match_score: number;
  match_reasons: string[];
};

type Draft = {
  file_number: string;
  first_names: string;
  surname: string;
  date_of_birth: string;
  identity_type: IdentityType;
  identity_number: string;
  identity_country: string;
  no_identity_reason: string;
  phone: string;
  email: string;
  residential_address: string;
  signature_value: string;
  patient_present_attestation: boolean;
  duplicate_review_reason: string;
};

const initialDraft: Draft = {
  file_number: "",
  first_names: "",
  surname: "",
  date_of_birth: "",
  identity_type: "sa_id",
  identity_number: "",
  identity_country: "ZA",
  no_identity_reason: "",
  phone: "",
  email: "",
  residential_address: "",
  signature_value: "",
  patient_present_attestation: false,
  duplicate_review_reason: "",
};

const steps = ["Personal details", "Identity", "Contact details", "Consent"];

function FieldError({ message }: { message?: string }) {
  return message ? <p className="fieldError">{message}</p> : null;
}

export function PatientOnboardingForm() {
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [duplicatesReviewed, setDuplicatesReviewed] = useState(false);
  const [checkingDuplicates, setCheckingDuplicates] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [createdFileNumber, setCreatedFileNumber] = useState("");

  function update<K extends keyof Draft>(field: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => {
      const next = { ...current };
      delete next[field];
      return next;
    });
    if (["first_names", "surname", "date_of_birth", "identity_type", "identity_number", "identity_country", "phone"].includes(field)) {
      setCandidates([]);
      setDuplicatesReviewed(false);
    }
  }

  function validateCurrentStep(): boolean {
    const next: Record<string, string> = {};
    if (step === 1) {
      if (!draft.first_names.trim()) next.first_names = "First names are required.";
      if (!draft.surname.trim()) next.surname = "Surname is required.";
      if (!draft.date_of_birth) next.date_of_birth = "Date of birth is required.";
      if (draft.date_of_birth && new Date(`${draft.date_of_birth}T00:00:00Z`) > new Date()) {
        next.date_of_birth = "Date of birth cannot be in the future.";
      }
    }
    if (step === 2) {
      if (draft.identity_type === "sa_id" && !isValidSouthAfricanId(draft.identity_number)) {
        next.identity_number = "Enter a valid South African ID number.";
      }
      if (["passport", "foreign_document"].includes(draft.identity_type)) {
        if (draft.identity_number.trim().length < 3) next.identity_number = "Document number is required.";
        if (!/^[A-Za-z]{2}$/.test(draft.identity_country)) next.identity_country = "Enter a two letter country code.";
      }
      if (draft.identity_type === "none" && draft.no_identity_reason.trim().length < 3) {
        next.no_identity_reason = "Explain why no identity document is available.";
      }
    }
    if (step === 3) {
      const phoneDigits = draft.phone.replace(/\D/g, "").length;
      if (!/^\+?[0-9 ()]{7,20}$/.test(draft.phone.trim()) || phoneDigits < 7 || phoneDigits > 15) {
        next.phone = "Enter a valid mobile number.";
      }
      if (draft.email && !/^\S+@\S+\.\S+$/.test(draft.email)) next.email = "Enter a valid email address.";
      if (draft.residential_address.trim().length < 3) next.residential_address = "Residential address is required.";
    }
    if (step === 4) {
      if (draft.signature_value.trim().length < 2) next.signature_value = "Enter the patient's full name as signature.";
      if (!draft.patient_present_attestation) next.patient_present_attestation = "Confirm that the patient is present.";
      if (candidates.length > 0 && !duplicatesReviewed) next.duplicate_reviewed = "Review the possible matches before saving.";
      if (candidates.length > 0 && draft.duplicate_review_reason.trim().length < 5) {
        next.duplicate_review_reason = "Record why this is a different patient.";
      }
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function checkDuplicates(): Promise<boolean> {
    setCheckingDuplicates(true);
    setFormError("");
    try {
      const response = await fetch("/api/patients/duplicates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          first_names: draft.first_names,
          surname: draft.surname,
          date_of_birth: draft.date_of_birth,
          identity_type: draft.identity_type,
          identity_number: draft.identity_number,
          identity_country: draft.identity_country,
          phone: draft.phone,
        }),
      });
      const body = await response.json();
      if (response.status === 409) {
        setFormError(`This identity already belongs to patient file ${body.existing.file_number}. Open the existing patient instead.`);
        return false;
      }
      if (!response.ok) {
        setFormError(body.error ?? "Duplicate checking is temporarily unavailable.");
        return false;
      }
      setCandidates(body.candidates ?? []);
      return true;
    } catch {
      setFormError("Duplicate checking is temporarily unavailable.");
      return false;
    } finally {
      setCheckingDuplicates(false);
    }
  }

  async function nextStep() {
    if (!validateCurrentStep()) return;
    if (step === 2) {
      const canContinue = await checkDuplicates();
      if (!canContinue) return;
    }
    if (step === 3 && candidates.length === 0) await checkDuplicates();
    setStep((current) => Math.min(4, current + 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validateCurrentStep()) return;
    setSubmitting(true);
    setFormError("");

    const response = await fetch("/api/patients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...draft,
        file_number: draft.file_number.trim(),
        identity_country: ["passport", "foreign_document"].includes(draft.identity_type)
          ? draft.identity_country.toUpperCase()
          : "",
        identity_number: draft.identity_type === "none" ? "" : draft.identity_number,
        no_identity_reason: draft.identity_type === "none" ? draft.no_identity_reason : "",
        consent_version: CONSENT_VERSION,
        consent_text_hash: CONSENT_TEXT_HASH,
        signature_type: "typed_name",
        duplicate_reviewed: duplicatesReviewed,
        duplicate_candidate_ids: candidates.map((candidate) => candidate.id),
      }),
    });
    const body = await response.json();
    setSubmitting(false);

    if (!response.ok) {
      if (response.status === 409 && body.code === "duplicate_review_required") {
        setDuplicatesReviewed(false);
        await checkDuplicates();
        setFormError(body.error ?? "Review the updated possible matches before saving.");
      } else if (response.status === 409 && body.existing?.file_number) {
        setFormError(`This identity already belongs to patient file ${body.existing.file_number}.`);
      } else {
        setFormError(body.error ?? "The patient could not be saved. Review the form and try again.");
      }
      return;
    }

    setCreatedFileNumber(body.file_number);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (createdFileNumber) {
    return (
      <main className="formShell">
        <section className="successPanel">
          <h1>Patient saved</h1>
          <p>The patient was created as file <strong>{createdFileNumber}</strong>.</p>
          <Link className="button buttonPrimary" href="/patients">Return to patients</Link>
        </section>
      </main>
    );
  }

  return (
    <form onSubmit={submit} noValidate>
      <main className="formShell">
        <div className="formTitleRow">
          <h1>New patient</h1>
          <Link className="button buttonSecondary" href="/patients">Cancel</Link>
        </div>

        <ol className="stepper" aria-label="Onboarding progress">
          {steps.map((label, index) => {
            const number = index + 1;
            const state = number === step ? "active" : number < step ? "complete" : "";
            return <li key={label} className={state} aria-current={number === step ? "step" : undefined}><span className="stepNumber">{number}</span><span>{label}</span></li>;
          })}
        </ol>

        {formError && <div className="formErrorBanner" role="alert">{formError}</div>}

        {step === 1 && (
          <section className="formPanel" aria-labelledby="personal-heading">
            <h2 className="formPanelHeader" id="personal-heading">Personal details</h2>
            <div className="formPanelBody formGrid">
              <div className="formField fullWidth">
                <label htmlFor="file_number">File number</label>
                <input id="file_number" value={draft.file_number} onChange={(event) => update("file_number", event.target.value)} autoComplete="off" placeholder="Leave blank to auto-generate" />
                <p className="fieldHelp">If the patient already has a clinic file number, enter it here. Otherwise leave blank and one will be assigned.</p>
                <FieldError message={errors.file_number} />
              </div>
              <div className="formField">
                <label htmlFor="first_names">First names <span className="required">*</span></label>
                <input id="first_names" value={draft.first_names} onChange={(event) => update("first_names", event.target.value)} autoComplete="given-name" />
                <FieldError message={errors.first_names} />
              </div>
              <div className="formField">
                <label htmlFor="surname">Surname <span className="required">*</span></label>
                <input id="surname" value={draft.surname} onChange={(event) => update("surname", event.target.value)} autoComplete="family-name" />
                <FieldError message={errors.surname} />
              </div>
              <div className="formField">
                <label htmlFor="date_of_birth">Date of birth <span className="required">*</span></label>
                <input id="date_of_birth" type="date" value={draft.date_of_birth} onChange={(event) => update("date_of_birth", event.target.value)} />
                <FieldError message={errors.date_of_birth} />
              </div>
            </div>
          </section>
        )}

        {step === 2 && (
          <>
            <section className="formPanel" aria-labelledby="identity-heading">
              <h2 className="formPanelHeader" id="identity-heading">Identity</h2>
              <div className="formPanelBody formGrid">
                <div className="formField">
                  <label htmlFor="identity_type">Identity document <span className="required">*</span></label>
                  <select id="identity_type" value={draft.identity_type} onChange={(event) => update("identity_type", event.target.value as IdentityType)}>
                    <option value="sa_id">South African ID</option>
                    <option value="passport">Passport</option>
                    <option value="foreign_document">Other foreign document</option>
                    <option value="none">No identity document</option>
                  </select>
                  <p className="fieldHelp">Patients without documents may still be registered. Select No identity document and record the reason.</p>
                </div>

                {draft.identity_type !== "none" && (
                  <div className="formField">
                    <label htmlFor="identity_number">Document number <span className="required">*</span></label>
                    <input id="identity_number" value={draft.identity_number} onChange={(event) => update("identity_number", event.target.value)} autoComplete="off" />
                    <FieldError message={errors.identity_number} />
                  </div>
                )}

                {["passport", "foreign_document"].includes(draft.identity_type) && (
                  <div className="formField">
                    <label htmlFor="identity_country">Issuing country code <span className="required">*</span></label>
                    <input id="identity_country" value={draft.identity_country} onChange={(event) => update("identity_country", event.target.value.toUpperCase())} maxLength={2} placeholder="ZW" />
                    <p className="fieldHelp">Use the two letter country code shown on the document.</p>
                    <FieldError message={errors.identity_country} />
                  </div>
                )}

                {draft.identity_type === "none" && (
                  <div className="formField fullWidth">
                    <label htmlFor="no_identity_reason">Reason no document is available <span className="required">*</span></label>
                    <textarea id="no_identity_reason" value={draft.no_identity_reason} onChange={(event) => update("no_identity_reason", event.target.value)} placeholder="For example, passport application pending" />
                    <FieldError message={errors.no_identity_reason} />
                  </div>
                )}
              </div>
            </section>

            {candidates.length > 0 && <DuplicatePanel candidates={candidates} />}
          </>
        )}

        {step === 3 && (
          <section className="formPanel" aria-labelledby="contact-heading">
            <h2 className="formPanelHeader" id="contact-heading">Contact details</h2>
            <div className="formPanelBody formGrid">
              <div className="formField">
                <label htmlFor="phone">Mobile number <span className="required">*</span></label>
                <input id="phone" type="tel" value={draft.phone} onChange={(event) => update("phone", event.target.value)} autoComplete="tel" />
                <FieldError message={errors.phone} />
              </div>
              <div className="formField">
                <label htmlFor="email">Email address</label>
                <input id="email" type="email" value={draft.email} onChange={(event) => update("email", event.target.value)} autoComplete="email" />
                <FieldError message={errors.email} />
              </div>
              <div className="formField fullWidth">
                <label htmlFor="residential_address">Residential address <span className="required">*</span></label>
                <textarea id="residential_address" value={draft.residential_address} onChange={(event) => update("residential_address", event.target.value)} autoComplete="street-address" />
                <p className="fieldHelp">Address is stored for administration but is not used as a unique identity.</p>
                <FieldError message={errors.residential_address} />
              </div>
            </div>
          </section>
        )}

        {step === 4 && (
          <>
            {candidates.length > 0 && (
              <section className="duplicatePanel" aria-labelledby="duplicate-review-heading">
                <div className="duplicatePanelHeader" id="duplicate-review-heading"><WarningIcon />Possible existing patients</div>
                <DuplicateCandidateList candidates={candidates} />
                <div className="formPanelBody formGrid">
                  <label className="checkboxField fullWidth">
                    <input type="checkbox" checked={duplicatesReviewed} onChange={(event) => setDuplicatesReviewed(event.target.checked)} />
                    <span>I reviewed these records and confirmed this is a different patient.</span>
                  </label>
                  <FieldError message={errors.duplicate_reviewed} />
                  <div className="formField fullWidth">
                    <label htmlFor="duplicate_review_reason">Reason for creating a separate patient <span className="required">*</span></label>
                    <textarea id="duplicate_review_reason" value={draft.duplicate_review_reason} onChange={(event) => update("duplicate_review_reason", event.target.value)} />
                    <FieldError message={errors.duplicate_review_reason} />
                  </div>
                </div>
              </section>
            )}

            <section className="formPanel" aria-labelledby="consent-heading">
              <h2 className="formPanelHeader" id="consent-heading">Consent</h2>
              <div className="formPanelBody formGrid">
                <p className="consentText fullWidth">{CONSENT_TEXT}</p>
                <div className="formField fullWidth">
                  <label htmlFor="signature_value">Patient full name as signature <span className="required">*</span></label>
                  <input id="signature_value" value={draft.signature_value} onChange={(event) => update("signature_value", event.target.value)} />
                  <FieldError message={errors.signature_value} />
                </div>
                <label className="checkboxField fullWidth">
                  <input type="checkbox" checked={draft.patient_present_attestation} onChange={(event) => update("patient_present_attestation", event.target.checked)} />
                  <span>I confirm that the patient is present and has reviewed this information.</span>
                </label>
                <FieldError message={errors.patient_present_attestation} />
              </div>
            </section>
          </>
        )}
      </main>

      <div className="formActions">
        {step === 1 ? (
          <Link className="button buttonSecondary" href="/patients">Cancel</Link>
        ) : (
          <button className="button buttonSecondary" type="button" onClick={() => setStep((current) => Math.max(1, current - 1))}>Back</button>
        )}
        {step < 4 ? (
          <button className="button buttonPrimary" type="button" onClick={nextStep} disabled={checkingDuplicates}>{checkingDuplicates ? "Checking" : "Continue"}</button>
        ) : (
          <button className="button buttonPrimary" type="submit" disabled={submitting}>{submitting ? "Saving patient" : "Save patient"}</button>
        )}
      </div>
    </form>
  );
}

function DuplicatePanel({ candidates }: { candidates: Candidate[] }) {
  return (
    <section className="duplicatePanel" aria-labelledby="possible-patients-heading">
      <div className="duplicatePanelHeader" id="possible-patients-heading"><WarningIcon />Possible existing patients · Review before continuing</div>
      <DuplicateCandidateList candidates={candidates} />
    </section>
  );
}

function DuplicateCandidateList({ candidates }: { candidates: Candidate[] }) {
  return (
    <ul className="duplicateCandidates">
      {candidates.map((candidate) => (
        <li className="duplicateCandidate" key={candidate.id}>
          <div><div className="candidateName">{candidate.first_names} {candidate.surname}</div><div className="candidateMeta">{candidate.file_number}</div></div>
          <div className="candidateMeta">Born {candidate.date_of_birth}</div>
          <div className="candidateMeta">{candidate.phone}</div>
          <div>
            <strong>{candidate.match_score >= 85 ? "High match" : "Possible match"}</strong>
            <div className="candidateMeta">{formatMatchReasons(candidate.match_reasons)}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function formatMatchReasons(reasons: string[]): string {
  const labels: Record<string, string> = {
    same_name: "same name",
    same_date_of_birth: "same date of birth",
    same_phone: "same mobile number",
  };
  return reasons.map((reason) => labels[reason] ?? reason).join(", ");
}
