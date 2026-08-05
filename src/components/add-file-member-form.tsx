"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import {
  MATCHED_FIELDS,
  type Candidate,
  checkForDuplicates,
} from "@/lib/patients/duplicate-check";
import {
  HouseholdMemberStep,
  NO_IDENTITY_REASONS,
  type NoIdentityReasonCode,
  defaultAskAgain,
  fieldErrorsFromZod,
} from "@/lib/patients/schema";
import { dateOfBirthFromSouthAfricanId, isValidSouthAfricanId } from "@/lib/patients/sa-id";
import { DuplicatePanel, DuplicateReviewFields } from "./duplicate-candidates";

type IdentityType = "sa_id" | "passport" | "foreign_document" | "none";

/** The household file this person is being added to (?file=DRRG…). */
export type FileContext = {
  file_number: string;
  members: { id: string; first_names: string; surname: string; date_of_birth: string }[];
  phone: string;
  residential_address: string;
  postal_code: string;
  no_contact_reason: string;
  /** Who signed the consent this file carries. Blank if it cannot be read. */
  consent_signed_by: string;
};

type Draft = {
  first_names: string;
  surname: string;
  /** The common case, so it is the default. */
  has_sa_id: boolean;
  identity_number: string;
  /** Only consulted when has_sa_id is false. */
  identity_type: Exclude<IdentityType, "sa_id">;
  identity_country: string;
  no_identity_reason_code: NoIdentityReasonCode | "";
  no_identity_note: string;
  ask_identity_again: boolean;
  date_of_birth: string;
  /** Set when staff reject the date the ID derived and type their own. */
  date_of_birth_manual: boolean;
  /** Set when this person's contact details are not the file's. */
  own_contact: boolean;
  phone: string;
  email: string;
  residential_address: string;
  postal_code: string;
  no_contact_details: boolean;
  no_contact_reason: string;
  duplicate_review_reason: string;
};

function initialDraft(fileContext: FileContext): Draft {
  return {
    first_names: "",
    surname: "",
    has_sa_id: true,
    identity_number: "",
    identity_type: "none",
    identity_country: "",
    no_identity_reason_code: "",
    no_identity_note: "",
    ask_identity_again: false,
    date_of_birth: "",
    date_of_birth_manual: false,
    own_contact: false,
    // Seeded from the file so opening the panel means editing, not retyping.
    phone: fileContext.phone,
    email: "",
    residential_address: fileContext.residential_address,
    postal_code: fileContext.postal_code,
    no_contact_details: Boolean(fileContext.no_contact_reason),
    no_contact_reason: fileContext.no_contact_reason,
    duplicate_review_reason: "",
  };
}

/**
 * One select covers both questions the ID checkbox leaves open when it is
 * unticked: which other document there is, or why there is none. Splitting them
 * asks staff to answer "what kind of document?" with "there isn't one".
 */
const DOCUMENT_OPTIONS: { value: string; label: string }[] = [
  { value: "passport", label: "Passport" },
  { value: "foreign_document", label: "Other foreign document" },
  ...NO_IDENTITY_REASONS.map((reason) => ({ value: `none:${reason.value}`, label: reason.label })),
];

function documentSelectValue(draft: Draft): string {
  if (draft.identity_type !== "none") return draft.identity_type;
  return draft.no_identity_reason_code ? `none:${draft.no_identity_reason_code}` : "";
}

function memberNames(members: FileContext["members"]): string {
  return members.map((member) => `${member.first_names} ${member.surname}`).join(", ");
}

function formatDate(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function FieldError({ message }: { message?: string }) {
  return message ? <p className="fieldError">{message}</p> : null;
}

export function AddFileMemberForm({ fileContext }: { fileContext: FileContext }) {
  const [draft, setDraft] = useState<Draft>(() => initialDraft(fileContext));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [duplicatesReviewed, setDuplicatesReviewed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [saved, setSaved] = useState<{ first_names: string; surname: string } | null>(null);

  const identityType: IdentityType = draft.has_sa_id ? "sa_id" : draft.identity_type;
  const idIsValid = draft.has_sa_id && isValidSouthAfricanId(draft.identity_number);
  const derivedDateOfBirth = idIsValid ? dateOfBirthFromSouthAfricanId(draft.identity_number) : null;
  // The ID answers the question unless it cannot (a date that never existed) or
  // staff say it got the century wrong.
  const dateOfBirthIsTyped = !draft.has_sa_id || draft.date_of_birth_manual || (idIsValid && !derivedDateOfBirth);
  const dateOfBirth = dateOfBirthIsTyped ? draft.date_of_birth : (derivedDateOfBirth ?? "");

  function update<K extends keyof Draft>(field: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => {
      const next = { ...current };
      delete next[field];
      return next;
    });
    // A review describes what is on screen, so changing anything the matcher
    // reads throws the review away. identity_number is here because the date of
    // birth is derived from it.
    if ((MATCHED_FIELDS as readonly string[]).includes(field) || field === "has_sa_id") {
      setCandidates([]);
      setDuplicatesReviewed(false);
    }
  }

  /** What is actually saved: the file's contact details unless overridden. */
  function contactPayload() {
    if (draft.own_contact) {
      return {
        phone: draft.phone,
        email: draft.email,
        residential_address: draft.residential_address,
        postal_code: draft.postal_code,
        no_contact_details: draft.no_contact_details,
        no_contact_reason: draft.no_contact_reason,
      };
    }
    return {
      phone: fileContext.phone,
      email: "",
      residential_address: fileContext.residential_address,
      postal_code: fileContext.postal_code,
      no_contact_details: Boolean(fileContext.no_contact_reason),
      no_contact_reason: fileContext.no_contact_reason,
    };
  }

  function identityPayload() {
    return {
      identity_type: identityType,
      identity_number: identityType === "none" ? "" : draft.identity_number,
      identity_country: ["passport", "foreign_document"].includes(identityType)
        ? draft.identity_country.toUpperCase()
        : "",
      no_identity_reason_code: identityType === "none" ? draft.no_identity_reason_code : "",
      no_identity_note: identityType === "none" ? draft.no_identity_note : "",
      ask_identity_again: identityType === "none" ? draft.ask_identity_again : false,
    };
  }

  function personPayload() {
    return {
      first_names: draft.first_names,
      surname: draft.surname,
      date_of_birth: dateOfBirth,
      ...identityPayload(),
      ...contactPayload(),
    };
  }

  function validate(): boolean {
    const result = HouseholdMemberStep.safeParse({
      ...personPayload(),
      duplicate_candidate_count: candidates.length,
      duplicate_reviewed: duplicatesReviewed,
      duplicate_review_reason: draft.duplicate_review_reason,
    });
    if (!result.success) {
      setErrors(fieldErrorsFromZod(result.error));
      return false;
    }
    setErrors({});
    return true;
  }

  async function runDuplicateCheck(): Promise<Candidate[] | null> {
    const identity = identityPayload();
    const contact = contactPayload();
    const outcome = await checkForDuplicates({
      first_names: draft.first_names,
      surname: draft.surname,
      date_of_birth: dateOfBirth,
      identity_type: identity.identity_type,
      identity_number: identity.identity_number,
      identity_country: identity.identity_country,
      phone: contact.phone,
      email: contact.email,
      residential_address: contact.residential_address,
      // People already on this file are not candidates for one another.
      file_number: fileContext.file_number,
      join_file: true,
    });
    if (outcome.status !== "ok") {
      setFormError(outcome.message);
      return null;
    }
    setCandidates(outcome.candidates);
    return outcome.candidates;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    setFormError("");

    const found = await runDuplicateCheck();
    if (found === null) {
      setSubmitting(false);
      return;
    }
    // Matches outside this file are rare — everyone on it is excluded — so the
    // review only interrupts when there is something real to look at.
    if (found.length > 0 && !duplicatesReviewed) {
      setSubmitting(false);
      setFormError("Someone already on the register looks like this person. Review the matches below before saving.");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    const response = await fetch("/api/patients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...personPayload(),
        file_number: fileContext.file_number,
        join_file: true,
        duplicate_reviewed: duplicatesReviewed,
        duplicate_candidate_ids: found.map((candidate) => candidate.id),
        duplicate_review_reason: draft.duplicate_review_reason,
      }),
    });
    const body = await response.json();
    setSubmitting(false);

    if (!response.ok) {
      if (body.fields) setErrors(body.fields);
      if (response.status === 409 && body.code === "duplicate_review_required") {
        setDuplicatesReviewed(false);
        await runDuplicateCheck();
        setFormError(body.error ?? "Review the updated possible matches before saving.");
      } else if (response.status === 409 && body.existing?.file_number) {
        setFormError(`This identity already belongs to patient file ${body.existing.file_number}.`);
      } else {
        setFormError(body.error ?? "This person could not be saved. Review the form and try again.");
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    setSaved({ first_names: draft.first_names, surname: draft.surname });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (saved) {
    // A full page load, not a client-side link: the form has to come back empty
    // for the next person, and a soft navigation can carry this one's answers.
    const nextPersonHref = `/patients/new?file=${encodeURIComponent(fileContext.file_number)}`;
    const everyone = [...fileContext.members.map((m) => `${m.first_names} ${m.surname}`), `${saved.first_names} ${saved.surname}`];

    return (
      <main className="formShell">
        <section className="successPanel">
          <h1>{saved.first_names} added to the file</h1>
          <p>
            File <strong>{fileContext.file_number}</strong> now covers {everyone.length} people:{" "}
            {everyone.join(", ")}.
          </p>
          <div className="successActions">
            <a className="button buttonPrimary" href={nextPersonHref}>Add another person</a>
            <Link className="button buttonSecondary" href="/patients">Done</Link>
          </div>
        </section>
      </main>
    );
  }

  const contactSummary = fileContext.no_contact_reason
    ? `No contact details on file — ${fileContext.no_contact_reason}`
    : [fileContext.phone, fileContext.residential_address.replace(/\n+/g, ", "), fileContext.postal_code]
        .filter(Boolean)
        .join(" · ");

  return (
    <form onSubmit={submit} noValidate>
      <main className="formShell">
        <div className="formTitleRow">
          <h1>Add a person to file {fileContext.file_number}</h1>
          <Link className="button buttonSecondary" href="/patients">Cancel</Link>
        </div>

        {formError && <div className="formErrorBanner" role="alert">{formError}</div>}

        <section className="formPanel" aria-labelledby="member-heading">
          <h2 className="formPanelHeader" id="member-heading">The next person on this file</h2>
          <div className="formPanelBody formGrid memberGrid">
            <p className="fieldHelp fullWidth">
              Already on <span className="mono">{fileContext.file_number}</span>:{" "}
              {memberNames(fileContext.members)}. This person gets their own record, their own
              identity document and their own history — only the file number is shared.
            </p>
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

            <label className="checkboxField fullWidth">
              <input
                type="checkbox"
                checked={draft.has_sa_id}
                onChange={(event) => {
                  // The number belongs to the document that was ticked, so it
                  // does not follow the checkbox to the other branch.
                  update("identity_number", "");
                  update("has_sa_id", event.target.checked);
                }}
              />
              <span>This person has a South African ID.</span>
            </label>

            {draft.has_sa_id ? (
              <>
                <div className="formField">
                  <label htmlFor="identity_number">ID number <span className="required">*</span></label>
                  <input
                    id="identity_number"
                    value={draft.identity_number}
                    onChange={(event) => update("identity_number", event.target.value)}
                    inputMode="numeric"
                    autoComplete="off"
                  />
                  <FieldError message={errors.identity_number} />
                </div>
                <div className="formField">
                  <span className="fieldLabel">Date of birth</span>
                  {dateOfBirthIsTyped ? (
                    <>
                      <input
                        id="date_of_birth"
                        type="date"
                        value={draft.date_of_birth}
                        onChange={(event) => update("date_of_birth", event.target.value)}
                      />
                      <p className="fieldHelp">
                        {idIsValid && !derivedDateOfBirth
                          ? "This ID number does not carry a date that can be read. Enter it from the document."
                          : "Typed in, not taken from the ID number."}
                      </p>
                      <FieldError message={errors.date_of_birth} />
                    </>
                  ) : (
                    <>
                      <p className="lockedField">
                        {derivedDateOfBirth ? formatDate(derivedDateOfBirth) : "From the ID number"}
                      </p>
                      <p className="fieldHelp">
                        {derivedDateOfBirth ? (
                          <>
                            Read from the ID number.{" "}
                            <button
                              type="button"
                              className="linkButton"
                              onClick={() => {
                                update("date_of_birth", derivedDateOfBirth);
                                update("date_of_birth_manual", true);
                              }}
                            >
                              Not right? Enter it manually
                            </button>
                          </>
                        ) : (
                          "Filled in as soon as the ID number is complete."
                        )}
                      </p>
                    </>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="formField">
                  <label htmlFor="date_of_birth">Date of birth <span className="required">*</span></label>
                  <input
                    id="date_of_birth"
                    type="date"
                    value={draft.date_of_birth}
                    onChange={(event) => update("date_of_birth", event.target.value)}
                  />
                  <FieldError message={errors.date_of_birth} />
                </div>
                <div className="formField">
                  <label htmlFor="document_choice">Document, or why there is none <span className="required">*</span></label>
                  <select
                    id="document_choice"
                    value={documentSelectValue(draft)}
                    onChange={(event) => {
                      const [type, code] = event.target.value.split(":");
                      if (type === "none") {
                        update("identity_type", "none");
                        update("no_identity_reason_code", (code ?? "") as NoIdentityReasonCode | "");
                        update("ask_identity_again", defaultAskAgain((code ?? "") as NoIdentityReasonCode | ""));
                      } else {
                        update("identity_type", (type || "none") as Exclude<IdentityType, "sa_id">);
                        update("no_identity_reason_code", "");
                      }
                    }}
                  >
                    <option value="">Select</option>
                    {DOCUMENT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                  <FieldError message={errors.no_identity_reason_code} />
                </div>

                {identityType !== "none" && (
                  <>
                    <div className="formField">
                      <label htmlFor="identity_number">Document number <span className="required">*</span></label>
                      <input id="identity_number" value={draft.identity_number} onChange={(event) => update("identity_number", event.target.value)} autoComplete="off" />
                      <FieldError message={errors.identity_number} />
                    </div>
                    <div className="formField">
                      <label htmlFor="identity_country">Issuing country code <span className="required">*</span></label>
                      <input id="identity_country" value={draft.identity_country} onChange={(event) => update("identity_country", event.target.value.toUpperCase())} maxLength={2} placeholder="ZW" />
                      <FieldError message={errors.identity_country} />
                    </div>
                  </>
                )}

                {identityType === "none" && draft.no_identity_reason_code === "other" && (
                  <div className="formField fullWidth">
                    <label htmlFor="no_identity_note">Note <span className="required">*</span></label>
                    <textarea id="no_identity_note" value={draft.no_identity_note} onChange={(event) => update("no_identity_note", event.target.value)} placeholder="Describe the reason" />
                    <FieldError message={errors.no_identity_note} />
                  </div>
                )}

                {identityType === "none" && draft.no_identity_reason_code && (
                  <label className="checkboxField fullWidth">
                    <input type="checkbox" checked={draft.ask_identity_again} onChange={(event) => update("ask_identity_again", event.target.checked)} />
                    <span>Ask for the document again at the next visit.</span>
                  </label>
                )}
              </>
            )}

            {/* Contact details and consent both come from the file. They are
                stated rather than asked, because asking again is what made this
                feel like a second registration. */}
            <div className="inheritedSummary fullWidth">
              <p className="inheritedLine">
                <span className="inheritedLabel">Contact</span>
                <span>{contactSummary || "Nothing on file"}</span>
              </p>
              <p className="inheritedLine">
                <span className="inheritedLabel">Consent</span>
                <span>
                  {fileContext.consent_signed_by
                    ? `Covered by the consent ${fileContext.consent_signed_by} signed for this file.`
                    : "Covered by the consent already signed for this file."}
                </span>
              </p>
              {!draft.own_contact && (
                <button
                  type="button"
                  className="linkButton"
                  onClick={() => update("own_contact", true)}
                >
                  This person&rsquo;s contact details are different
                </button>
              )}
            </div>

            {draft.own_contact && (
              <>
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
                  <FieldError message={errors.postal_code} />
                </div>
                <label className="checkboxField fullWidth">
                  <input type="checkbox" checked={draft.no_contact_details} onChange={(event) => update("no_contact_details", event.target.checked)} />
                  <span>This person has no contact details on file.</span>
                </label>
                {draft.no_contact_details && (
                  <div className="formField fullWidth">
                    <label htmlFor="no_contact_reason">Reason there are no contact details <span className="required">*</span></label>
                    <textarea id="no_contact_reason" value={draft.no_contact_reason} onChange={(event) => update("no_contact_reason", event.target.value)} placeholder="For example, treated on the day with no phone or fixed address" />
                    <FieldError message={errors.no_contact_reason} />
                  </div>
                )}
                <button
                  type="button"
                  className="linkButton fullWidth"
                  onClick={() => {
                    update("own_contact", false);
                    setErrors({});
                  }}
                >
                  Use the file&rsquo;s contact details after all
                </button>
              </>
            )}
          </div>
        </section>

        {candidates.length > 0 && (
          <DuplicatePanel candidates={candidates} heading="Possible existing patients · Review before saving">
            <DuplicateReviewFields
              reviewed={duplicatesReviewed}
              onReviewedChange={(value) => {
                setDuplicatesReviewed(value);
                setErrors((current) => {
                  const next = { ...current };
                  delete next.duplicate_reviewed;
                  return next;
                });
              }}
              reason={draft.duplicate_review_reason}
              onReasonChange={(value) => update("duplicate_review_reason", value)}
              errors={errors}
            />
          </DuplicatePanel>
        )}
      </main>

      <div className="formActions">
        <Link className="button buttonSecondary" href="/patients">Cancel</Link>
        <button className="button buttonPrimary" type="submit" disabled={submitting}>
          {submitting ? "Saving" : "Save person"}
        </button>
      </div>
    </form>
  );
}
