"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { PatientUpdate, fieldErrorsFromZod } from "@/lib/patients/schema";
import { WarningIcon } from "./icons";

type IdentityType = "sa_id" | "passport" | "foreign_document" | "none";

export type PatientRecord = {
  id: string;
  file_number: string;
  first_names: string;
  surname: string;
  date_of_birth: string;
  identity_type: IdentityType;
  identity_number: string | null;
  identity_country: string | null;
  no_identity_reason: string | null;
  phone: string;
  email: string | null;
  residential_address: string;
  status: string;
};

export type DuplicateNotice = {
  fileNumbers: string[];
  reviewHref: string;
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
};

function toDraft(patient: PatientRecord): Draft {
  return {
    file_number: patient.file_number,
    first_names: patient.first_names,
    surname: patient.surname,
    date_of_birth: patient.date_of_birth,
    identity_type: patient.identity_type,
    identity_number: patient.identity_number ?? "",
    identity_country: patient.identity_country ?? "",
    no_identity_reason: patient.no_identity_reason ?? "",
    phone: patient.phone,
    email: patient.email ?? "",
    residential_address: patient.residential_address,
  };
}

function FieldError({ message }: { message?: string }) {
  return message ? <p className="fieldError">{message}</p> : null;
}

export function PatientEditForm({
  patient,
  duplicateNotice,
}: {
  patient: PatientRecord;
  duplicateNotice?: DuplicateNotice | null;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => toDraft(patient));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [archiveReason, setArchiveReason] = useState("");
  const [archiveError, setArchiveError] = useState("");
  const [archiving, setArchiving] = useState(false);

  function update<K extends keyof Draft>(field: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => {
      const next = { ...current };
      delete next[field];
      return next;
    });
    setSaved(false);
  }

  function payload() {
    return {
      file_number: draft.file_number.trim(),
      first_names: draft.first_names,
      surname: draft.surname,
      date_of_birth: draft.date_of_birth,
      identity_type: draft.identity_type,
      identity_number: draft.identity_type === "none" ? "" : draft.identity_number,
      identity_country: ["passport", "foreign_document"].includes(draft.identity_type)
        ? draft.identity_country.toUpperCase()
        : "",
      no_identity_reason: draft.identity_type === "none" ? draft.no_identity_reason : "",
      phone: draft.phone,
      email: draft.email,
      residential_address: draft.residential_address,
    };
  }

  function validate(): boolean {
    const result = PatientUpdate.safeParse(payload());
    if (!result.success) {
      setErrors(fieldErrorsFromZod(result.error));
      return false;
    }
    setErrors({});
    return true;
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validate()) return;
    setSaving(true);
    setFormError("");
    setSaved(false);

    const response = await fetch(`/api/patients/${patient.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload()),
    });
    const body = await response.json().catch(() => ({}));
    setSaving(false);

    if (!response.ok) {
      if (body.fields) setErrors(body.fields);
      setFormError(body.error ?? "The patient could not be updated.");
      return;
    }
    setSaved(true);
    router.refresh();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function archivePatient() {
    const reason = archiveReason.trim();
    if (reason.length < 5) {
      setArchiveError("Record why this file is being archived (at least 5 characters).");
      return;
    }
    setArchiving(true);
    setArchiveError("");
    const response = await fetch(`/api/patients/${patient.id}/archive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    const body = await response.json().catch(() => ({}));
    setArchiving(false);
    if (!response.ok) {
      setArchiveError(body.error ?? "The patient could not be archived.");
      return;
    }
    router.replace(`/patients/${patient.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={save} noValidate>
      <main className="formShell">
        <div className="formTitleRow">
          <div>
            <h1>{patient.first_names} {patient.surname}</h1>
            <p className="mono muted">{patient.file_number}</p>
          </div>
          <Link className="button buttonSecondary" href="/patients">Back to patients</Link>
        </div>

        {duplicateNotice && (
          <div className="duplicateNotice" role="status">
            <WarningIcon size={18} />
            <span>
              This file may match {duplicateNotice.fileNumbers.join(", ")}.{" "}
              <Link className="rowLink" href={duplicateNotice.reviewHref}>Review on Possible duplicates</Link>
            </span>
          </div>
        )}
        {formError && <div className="formErrorBanner" role="alert">{formError}</div>}
        {saved && <div className="formSuccessBanner" role="status">Changes saved.</div>}

        <div className="formPrimary">
        <section className="formPanel">
          <h2 className="formPanelHeader">Patient details</h2>
          <div className="formPanelBody formGrid">
            <div className="formField fullWidth">
              <label htmlFor="file_number">File number <span className="required">*</span></label>
              <input id="file_number" value={draft.file_number} onChange={(event) => update("file_number", event.target.value)} autoComplete="off" />
              <p className="fieldHelp">Clinic file number — must be unique.</p>
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

        <section className="formPanel">
          <h2 className="formPanelHeader">Identity</h2>
          <div className="formPanelBody formGrid">
            <div className="formField">
              <label htmlFor="identity_type">Identity document <span className="required">*</span></label>
              <select id="identity_type" value={draft.identity_type} onChange={(event) => update("identity_type", event.target.value as IdentityType)}>
                <option value="sa_id">South African ID</option>
                <option value="passport">Passport</option>
                <option value="foreign_document">Other foreign document</option>
                <option value="none">No identity document</option>
              </select>
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
                <FieldError message={errors.identity_country} />
              </div>
            )}
            {draft.identity_type === "none" && (
              <div className="formField fullWidth">
                <label htmlFor="no_identity_reason">Reason no document is available <span className="required">*</span></label>
                <textarea id="no_identity_reason" value={draft.no_identity_reason} onChange={(event) => update("no_identity_reason", event.target.value)} />
                <FieldError message={errors.no_identity_reason} />
              </div>
            )}
          </div>
        </section>

        <section className="formPanel">
          <h2 className="formPanelHeader">Contact details</h2>
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
              <FieldError message={errors.residential_address} />
            </div>
          </div>
        </section>

        </div>

        {/* Soft archive only — never hard delete. Same person twice → merge instead. */}
        <section className="dangerZone" aria-labelledby="archive-heading">
          <div className="dangerZoneInner">
            <div>
              <h2 className="dangerZoneTitle" id="archive-heading">Remove from active list</h2>
              <p className="dangerZoneHelp">
                For files opened by mistake or no longer needed on the register.
                Nothing is deleted. If two files are the same person, merge them under Possible duplicates.
              </p>
            </div>
            {!showArchive ? (
              <button
                type="button"
                className="button buttonSecondary buttonSmall"
                onClick={() => {
                  setShowArchive(true);
                  setArchiveError("");
                }}
              >
                Archive this file
              </button>
            ) : (
              <div className="archiveConfirmPanel">
                <div className="formField">
                  <label htmlFor="archive_reason">
                    Why is this file being archived? <span className="required">*</span>
                  </label>
                  <textarea
                    id="archive_reason"
                    value={archiveReason}
                    onChange={(event) => {
                      setArchiveReason(event.target.value);
                      setArchiveError("");
                    }}
                    placeholder="e.g. Opened in error, test patient, wrong person"
                  />
                  <FieldError message={archiveError} />
                </div>
                <div className="dangerActions">
                  <button
                    type="button"
                    className="button buttonSecondary"
                    disabled={archiving}
                    onClick={() => {
                      setShowArchive(false);
                      setArchiveReason("");
                      setArchiveError("");
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="button buttonDanger"
                    disabled={archiving}
                    onClick={archivePatient}
                  >
                    {archiving ? "Archiving" : "Confirm archive"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      </main>

      <div className="formActions">
        <Link className="button buttonSecondary" href="/patients">Cancel</Link>
        <button className="button buttonPrimary" type="submit" disabled={saving || archiving}>
          {saving ? "Saving" : "Save changes"}
        </button>
      </div>
    </form>
  );
}
