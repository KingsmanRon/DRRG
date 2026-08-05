"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { CONSENT_TEXT, CONSENT_TEXT_HASH, CONSENT_VERSION } from "@/lib/consent";
import {
  MATCHED_FIELDS,
  type Candidate,
  checkForDuplicates,
} from "@/lib/patients/duplicate-check";
import {
  ConsentStep,
  ContactDetailsStep,
  IdentityStep,
  NO_IDENTITY_REASONS,
  type NoIdentityReasonCode,
  PersonalDetailsStep,
  defaultAskAgain,
  fieldErrorsFromZod,
} from "@/lib/patients/schema";
import { DuplicatePanel, DuplicateReviewFields } from "./duplicate-candidates";

type IdentityType = "sa_id" | "passport" | "foreign_document" | "none";

type Draft = {
  file_number: string;
  // Staff intent only: it does not change what is saved for this person, it
  // decides whether the form offers to carry straight on to the next member.
  family_file: boolean;
  first_names: string;
  surname: string;
  date_of_birth: string;
  identity_type: IdentityType;
  identity_number: string;
  identity_country: string;
  no_identity_reason_code: NoIdentityReasonCode | "";
  no_identity_note: string;
  ask_identity_again: boolean;
  phone: string;
  email: string;
  residential_address: string;
  postal_code: string;
  no_contact_details: boolean;
  no_contact_reason: string;
  signature_value: string;
  patient_present_attestation: boolean;
  duplicate_review_reason: string;
};

function initialDraft(): Draft {
  return {
    file_number: "",
    family_file: false,
    first_names: "",
    surname: "",
    date_of_birth: "",
    identity_type: "sa_id",
    identity_number: "",
    identity_country: "ZA",
    no_identity_reason_code: "",
    no_identity_note: "",
    ask_identity_again: false,
    phone: "",
    email: "",
    residential_address: "",
    postal_code: "",
    no_contact_details: false,
    no_contact_reason: "",
    signature_value: "",
    patient_present_attestation: false,
    duplicate_review_reason: "",
  };
}

const steps = ["Personal details", "Identity", "Contact details", "Consent"];

function FieldError({ message }: { message?: string }) {
  return message ? <p className="fieldError">{message}</p> : null;
}

/**
 * Registering a patient onto a new file: four steps, ending in the consent
 * that will cover this file. Adding someone to a file that already exists is a
 * different job and a much shorter form — see `AddFileMemberForm`.
 */
export function PatientOnboardingForm() {
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<Draft>(() => initialDraft());
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
    // Postal code is absent on purpose: it is not part of the duplicate search,
    // so changing it cannot change the matches already on screen.
    if ((MATCHED_FIELDS as readonly string[]).includes(field)) {
      setCandidates([]);
      setDuplicatesReviewed(false);
    }
  }

  function identityPayload() {
    return {
      identity_type: draft.identity_type,
      identity_number: draft.identity_type === "none" ? "" : draft.identity_number,
      identity_country: ["passport", "foreign_document"].includes(draft.identity_type)
        ? draft.identity_country.toUpperCase()
        : "",
      no_identity_reason_code: draft.identity_type === "none" ? draft.no_identity_reason_code : "",
      no_identity_note: draft.identity_type === "none" ? draft.no_identity_note : "",
      ask_identity_again: draft.identity_type === "none" ? draft.ask_identity_again : false,
      date_of_birth: draft.date_of_birth || "1900-01-01",
    };
  }

  function validateCurrentStep(): boolean {
    if (step === 1) {
      const result = PersonalDetailsStep.safeParse({
        file_number: draft.file_number,
        first_names: draft.first_names,
        surname: draft.surname,
        date_of_birth: draft.date_of_birth,
      });
      if (!result.success) {
        setErrors(fieldErrorsFromZod(result.error));
        return false;
      }
    }
    if (step === 2) {
      const result = IdentityStep.safeParse(identityPayload());
      if (!result.success) {
        setErrors(fieldErrorsFromZod(result.error));
        return false;
      }
    }
    if (step === 3) {
      const result = ContactDetailsStep.safeParse({
        phone: draft.phone,
        email: draft.email,
        residential_address: draft.residential_address,
        postal_code: draft.postal_code,
        no_contact_details: draft.no_contact_details,
        no_contact_reason: draft.no_contact_reason,
      });
      if (!result.success) {
        setErrors(fieldErrorsFromZod(result.error));
        return false;
      }
    }
    if (step === 4) {
      const result = ConsentStep.safeParse({
        signature_value: draft.signature_value,
        patient_present_attestation: draft.patient_present_attestation ? true : false,
        duplicate_candidate_count: candidates.length,
        duplicate_reviewed: duplicatesReviewed,
        duplicate_review_reason: draft.duplicate_review_reason,
      });
      if (!result.success) {
        setErrors(fieldErrorsFromZod(result.error));
        return false;
      }
    }
    setErrors({});
    return true;
  }

  async function checkDuplicates(): Promise<boolean> {
    setCheckingDuplicates(true);
    setFormError("");
    try {
      const identity = identityPayload();
      const outcome = await checkForDuplicates({
        first_names: draft.first_names,
        surname: draft.surname,
        date_of_birth: draft.date_of_birth,
        identity_type: identity.identity_type,
        identity_number: identity.identity_number,
        identity_country: identity.identity_country,
        phone: draft.phone,
        email: draft.email,
        residential_address: draft.residential_address,
        file_number: "",
        join_file: false,
      });
      if (outcome.status !== "ok") {
        setFormError(outcome.message);
        return false;
      }
      setCandidates(outcome.candidates);
      return true;
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
    // Re-check after contact details: phone, email and address all contribute
    // to the weighted match score.
    if (step === 3) await checkDuplicates();
    setStep((current) => Math.min(4, current + 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validateCurrentStep()) return;
    setSubmitting(true);
    setFormError("");

    const identity = identityPayload();
    const response = await fetch("/api/patients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...draft,
        file_number: draft.file_number.trim(),
        join_file: false,
        identity_country: identity.identity_country,
        identity_number: identity.identity_number,
        no_identity_reason_code: identity.no_identity_reason_code,
        no_identity_note: identity.no_identity_note,
        ask_identity_again: identity.ask_identity_again,
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
      if (body.fields) setErrors(body.fields);
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
    // Adding the next person is a full page load, not a client-side link: the
    // wizard has to come back empty, and a soft navigation can carry the
    // previous person's answers (signature included) into the new form.
    const nextPersonHref = `/patients/new?file=${encodeURIComponent(createdFileNumber)}`;

    return (
      <main className="formShell">
        <section className="successPanel">
          <h1>Patient saved</h1>
          <p>
            {draft.first_names} {draft.surname} is on file <strong>{createdFileNumber}</strong>.
          </p>
          {draft.family_file ? (
            <>
              <p>
                Add the next person on this file, or finish here. They will not be asked for
                consent or contact details again — this file&rsquo;s already cover them.
              </p>
              <div className="successActions">
                <a className="button buttonPrimary" href={nextPersonHref}>Add another person to this file</a>
                <Link className="button buttonSecondary" href="/patients">Done</Link>
              </div>
            </>
          ) : (
            <div className="successActions">
              <Link className="button buttonPrimary" href="/patients">Return to patients</Link>
              <a className="button buttonSecondary" href={nextPersonHref}>Add another person to this file</a>
            </div>
          )}
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
                <p className="fieldHelp">If the patient already has a clinic file number, enter it here. Otherwise leave blank and one will be assigned. To put someone on a file that already exists, open that file and use &ldquo;Add a person to this file&rdquo;.</p>
                <FieldError message={errors.file_number} />
              </div>
              <label className="checkboxField fullWidth">
                <input type="checkbox" checked={draft.family_file} onChange={(event) => update("family_file", event.target.checked)} />
                <span>This file covers more than one person (a family or household file).</span>
              </label>
              {draft.family_file && (
                <p className="fieldHelp fullWidth">
                  Register this person first — their consent covers the file. Once they are saved
                  the form reopens on the same file number for the next person, asking only who
                  they are.
                </p>
              )}
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
                  <>
                    <div className="formField fullWidth">
                      <label htmlFor="no_identity_reason_code">Why is there no document? <span className="required">*</span></label>
                      <select
                        id="no_identity_reason_code"
                        value={draft.no_identity_reason_code}
                        onChange={(event) => {
                          const code = event.target.value as NoIdentityReasonCode | "";
                          update("no_identity_reason_code", code);
                          update("ask_identity_again", defaultAskAgain(code));
                        }}
                      >
                        <option value="">Select a reason</option>
                        {NO_IDENTITY_REASONS.map((reason) => (
                          <option key={reason.value} value={reason.value}>{reason.label}</option>
                        ))}
                      </select>
                      <p className="fieldHelp">Pick the closest reason. A note is only required for &ldquo;Other&rdquo;.</p>
                      <FieldError message={errors.no_identity_reason_code} />
                    </div>
                    <div className="formField fullWidth">
                      <label htmlFor="no_identity_note">
                        Note {draft.no_identity_reason_code === "other" && <span className="required">*</span>}
                      </label>
                      <textarea
                        id="no_identity_note"
                        value={draft.no_identity_note}
                        onChange={(event) => update("no_identity_note", event.target.value)}
                        placeholder={draft.no_identity_reason_code === "other" ? "Describe the reason" : "Anything else worth recording"}
                      />
                      <FieldError message={errors.no_identity_note} />
                    </div>
                    <label className="checkboxField fullWidth">
                      <input
                        type="checkbox"
                        checked={draft.ask_identity_again}
                        onChange={(event) => update("ask_identity_again", event.target.checked)}
                      />
                      <span>Ask for the document again at the next visit.</span>
                    </label>
                  </>
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
                <label htmlFor="phone">Mobile number {draft.no_contact_details ? null : <span className="required">*</span>}</label>
                <input id="phone" type="tel" value={draft.phone} onChange={(event) => update("phone", event.target.value)} autoComplete="tel" />
                <FieldError message={errors.phone} />
              </div>
              <div className="formField">
                <label htmlFor="email">Email address</label>
                <input id="email" type="email" value={draft.email} onChange={(event) => update("email", event.target.value)} autoComplete="email" />
                <FieldError message={errors.email} />
              </div>
              <div className="formField fullWidth">
                <label htmlFor="residential_address">Residential address {draft.no_contact_details ? null : <span className="required">*</span>}</label>
                <textarea id="residential_address" value={draft.residential_address} onChange={(event) => update("residential_address", event.target.value)} autoComplete="street-address" />
                <p className="fieldHelp">Searchable — patients who give different names at the same address surface together. Address is not a unique identity, so genuinely different people at one address stay as separate files.</p>
                <FieldError message={errors.residential_address} />
              </div>
              <div className="formField">
                <label htmlFor="postal_code">Postal code <span className="muted">(optional)</span></label>
                <input
                  id="postal_code"
                  value={draft.postal_code}
                  onChange={(event) => update("postal_code", event.target.value.replace(/[^0-9]/g, "").slice(0, 4))}
                  inputMode="numeric"
                  autoComplete="postal-code"
                  maxLength={4}
                  placeholder="1983"
                />
                <p className="fieldHelp">Keep it out of the address box above. Matching compares the address itself, so a file with the code and one without still find each other.</p>
                <FieldError message={errors.postal_code} />
              </div>

              <label className="checkboxField fullWidth">
                <input type="checkbox" checked={draft.no_contact_details} onChange={(event) => update("no_contact_details", event.target.checked)} />
                <span>This patient has no contact details on file.</span>
              </label>
              {draft.no_contact_details && (
                <div className="formField fullWidth">
                  <label htmlFor="no_contact_reason">Reason there are no contact details <span className="required">*</span></label>
                  <textarea id="no_contact_reason" value={draft.no_contact_reason} onChange={(event) => update("no_contact_reason", event.target.value)} placeholder="For example, treated on the day with no phone or fixed address" />
                  <FieldError message={errors.no_contact_reason} />
                </div>
              )}
            </div>
          </section>
        )}

        {step === 4 && (
          <>
            {candidates.length > 0 && (
              <DuplicatePanel candidates={candidates} heading="Possible existing patients">
                <DuplicateReviewFields
                  reviewed={duplicatesReviewed}
                  onReviewedChange={setDuplicatesReviewed}
                  reason={draft.duplicate_review_reason}
                  onReasonChange={(value) => update("duplicate_review_reason", value)}
                  errors={errors}
                />
              </DuplicatePanel>
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
