import { describe, expect, it } from "vitest";
import { normalisePhone } from "./phone";
import {
  ContactDetailsStep,
  HouseholdMemberStep,
  PersonalDetailsStep,
  PatientInput,
  PatientUpdate,
  defaultAskAgain,
  fieldErrorsFromZod,
  normalizePatientInput,
  normalizePatientUpdate,
} from "./schema";

const base = {
  first_names: "Nomsa Thandi",
  surname: "Dlamini",
  date_of_birth: "1980-01-01",
  identity_type: "sa_id" as const,
  identity_number: "8001015009087",
  identity_country: "",
  phone: "+27 82 123 4567",
  email: "nomsa@example.com",
  residential_address: "1 Main Road, Johannesburg",
  consent_version: "1.0",
  consent_text_hash: "a".repeat(64),
  signature_type: "typed_name" as const,
  signature_value: "Nomsa Dlamini",
  patient_present_attestation: true as const,
  duplicate_reviewed: false,
  duplicate_candidate_ids: [],
  duplicate_review_reason: "",
};

describe("PatientInput", () => {
  it("accepts a valid South African ID", () => {
    expect(PatientInput.safeParse(base).success).toBe(true);
  });

  it("accepts a patient with no identity document and a coded reason", () => {
    const result = PatientInput.safeParse({
      ...base,
      identity_type: "none",
      identity_number: "",
      no_identity_reason_code: "home_affairs_pending",
    });
    expect(result.success).toBe(true);
  });

  it("does not require a note for a coded reason", () => {
    // The old free-text field was always required, which is what produced
    // values like "Nog applicable".
    const result = PatientInput.safeParse({
      ...base,
      identity_type: "none",
      identity_number: "",
      no_identity_reason_code: "not_brought",
      no_identity_note: "",
    });
    expect(result.success).toBe(true);
  });

  it("requires a note only when the reason is 'other'", () => {
    const result = PatientInput.safeParse({
      ...base,
      identity_type: "none",
      identity_number: "",
      no_identity_reason_code: "other",
      no_identity_note: "",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(fieldErrorsFromZod(result.error).no_identity_note).toBeTruthy();
  });

  it("rejects no-document patients with no reason selected", () => {
    const result = PatientInput.safeParse({
      ...base,
      identity_type: "none",
      identity_number: "",
      no_identity_reason_code: "",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(fieldErrorsFromZod(result.error).no_identity_reason_code).toBeTruthy();
  });

  it("accepts a patient with no contact details when a reason is recorded", () => {
    const result = PatientInput.safeParse({
      ...base,
      phone: "",
      residential_address: "",
      no_contact_details: true,
      no_contact_reason: "Treated on the day, no phone or fixed address",
    });
    expect(result.success).toBe(true);
  });

  it("requires a reason when contact details are omitted", () => {
    const result = PatientInput.safeParse({
      ...base,
      phone: "",
      residential_address: "",
      no_contact_details: true,
      no_contact_reason: "",
    });
    expect(result.success).toBe(false);
  });

  it("still requires phone and address when no reason is given", () => {
    const result = PatientInput.safeParse({ ...base, phone: "", residential_address: "" });
    expect(result.success).toBe(false);
  });

  it("drops a stray no-contact reason when contact details are present", () => {
    const parsed = PatientInput.parse({ ...base, no_contact_details: false, no_contact_reason: "ignored" });
    expect(normalizePatientInput(parsed).no_contact_reason).toBe("");
  });

  it("accepts a patient with no postal code", () => {
    expect(PatientInput.safeParse({ ...base, postal_code: "" }).success).toBe(true);
    expect(PatientInput.parse(base).postal_code).toBe("");
  });

  it("accepts a four digit postal code", () => {
    const result = PatientInput.safeParse({ ...base, postal_code: "1983" });
    expect(result.success).toBe(true);
  });

  it("rejects a postal code that is not four digits", () => {
    for (const postal_code of ["198", "19834", "ABCD"]) {
      const result = PatientInput.safeParse({ ...base, postal_code });
      expect(result.success).toBe(false);
      if (result.success) continue;
      expect(fieldErrorsFromZod(result.error).postal_code).toBe("Enter a four-digit postal code.");
    }
  });

  it("does not let a postal code stand in for the address", () => {
    // Postal code is not contact detail: it does not satisfy the phone +
    // address requirement, and it never has to be filled in.
    const result = PatientInput.safeParse({ ...base, residential_address: "", postal_code: "1983" });
    expect(result.success).toBe(false);
  });

  it("trims a postal code before it is stored", () => {
    const parsed = PatientInput.parse({ ...base, postal_code: " 1983 " });
    expect(normalizePatientInput(parsed).postal_code).toBe("1983");
  });

  it("requires an issuing country for passports", () => {
    const result = PatientInput.safeParse({
      ...base,
      identity_type: "passport",
      identity_number: "A1234567",
      identity_country: "",
    });
    expect(result.success).toBe(false);
  });

  it("requires review evidence when soft duplicate candidates exist", () => {
    const result = PatientInput.safeParse({
      ...base,
      duplicate_candidate_ids: ["27ae6b18-76fe-4a49-a3d3-5f22913f7fb4"],
    });
    expect(result.success).toBe(false);
  });

  it("normalises identity and contact fields", () => {
    const parsed = PatientInput.parse({ ...base, email: "NOMSA@EXAMPLE.COM" });
    const normalized = normalizePatientInput(parsed);
    expect(normalized.identity_number).toBe("8001015009087");
    expect(normalized.email).toBe("nomsa@example.com");
  });

  it("treats South African local and international mobile formats as the same number", () => {
    expect(normalisePhone("082 123 4567")).toBe(normalisePhone("+27 82 123 4567"));
  });

  it("rejects a phone number with more digits than the database allows", () => {
    const result = PatientInput.safeParse({ ...base, phone: "0821234567890123" });
    expect(result.success).toBe(false);
  });

  it("defaults to registering a new file rather than joining one", () => {
    expect(PatientInput.parse(base).join_file).toBe(false);
  });

  it("accepts a person being added to an existing household file", () => {
    const result = PatientInput.safeParse({
      ...base,
      file_number: "DRRG00000123",
      join_file: true,
    });
    expect(result.success).toBe(true);
  });

  it("requires a file number when joining an existing file", () => {
    const result = PatientInput.safeParse({ ...base, file_number: "", join_file: true });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(fieldErrorsFromZod(result.error).file_number).toBeTruthy();
  });
});

describe("defaultAskAgain", () => {
  it("flags follow-up for reasons that resolve themselves later", () => {
    for (const code of ["not_brought", "newborn_no_certificate", "home_affairs_pending", "asylum_permit_pending"] as const) {
      expect(defaultAskAgain(code)).toBe(true);
    }
  });

  it("does not flag follow-up when the patient declined", () => {
    expect(defaultAskAgain("declined")).toBe(false);
  });

  it("does not flag follow-up for lost documents or 'other'", () => {
    expect(defaultAskAgain("lost_or_stolen")).toBe(false);
    expect(defaultAskAgain("other")).toBe(false);
  });
});

describe("onboarding step schemas", () => {
  it("accepts personal details that match the full PatientInput rules", () => {
    const result = PersonalDetailsStep.safeParse({
      file_number: "",
      first_names: base.first_names,
      surname: base.surname,
      date_of_birth: base.date_of_birth,
    });
    expect(result.success).toBe(true);
  });

  it("surfaces field errors for contact validation", () => {
    const result = ContactDetailsStep.safeParse({
      phone: "bad",
      email: "not-an-email",
      residential_address: "x",
      postal_code: "198",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const fields = fieldErrorsFromZod(result.error);
    expect(fields.phone).toBeTruthy();
    expect(fields.email).toBeTruthy();
    expect(fields.residential_address).toBeTruthy();
    expect(fields.postal_code).toBe("Enter a four-digit postal code.");
  });

  it("lets the contact step through with the postal code left blank", () => {
    const result = ContactDetailsStep.safeParse({
      phone: base.phone,
      email: base.email,
      residential_address: base.residential_address,
      postal_code: "",
    });
    expect(result.success).toBe(true);
  });
});

describe("adding a person to a file that already exists", () => {
  const member = {
    first_names: "Thabo",
    surname: "Dlamini",
    date_of_birth: "2019-07-07",
    identity_type: "none" as const,
    identity_number: "",
    identity_country: "",
    no_identity_reason_code: "newborn_no_certificate" as const,
    no_identity_note: "",
    ask_identity_again: true,
    phone: "083 400 0001",
    email: "",
    residential_address: "12 Zone 3, Sebokeng",
    postal_code: "",
    no_contact_details: false,
    no_contact_reason: "",
  };

  it("validates identity and contact in one step", () => {
    expect(HouseholdMemberStep.safeParse(member).success).toBe(true);
  });

  it("still applies the identity rules of the four-step form", () => {
    const result = HouseholdMemberStep.safeParse({
      ...member,
      identity_type: "sa_id",
      identity_number: "1234567890123",
      no_identity_reason_code: "",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(fieldErrorsFromZod(result.error).identity_number).toBe(
      "Enter a valid South African ID number.",
    );
  });

  it("still demands a written reason once a match is on screen", () => {
    const result = HouseholdMemberStep.safeParse({
      ...member,
      duplicate_candidate_count: 1,
      duplicate_reviewed: true,
      duplicate_review_reason: "",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(fieldErrorsFromZod(result.error).duplicate_review_reason).toBeTruthy();
  });

  it("saves without a consent payload, because the file's consent covers them", () => {
    const { consent_version, consent_text_hash, signature_value, patient_present_attestation, signature_type, ...withoutConsent } = base;
    void consent_version;
    void consent_text_hash;
    void signature_value;
    void patient_present_attestation;
    void signature_type;

    const result = PatientInput.safeParse({
      ...withoutConsent,
      file_number: "DRRG00000042",
      join_file: true,
    });
    expect(result.success).toBe(true);
  });

  it("but a brand new file still cannot be opened without one", () => {
    const { consent_version, consent_text_hash, signature_value, patient_present_attestation, signature_type, ...withoutConsent } = base;
    void consent_version;
    void consent_text_hash;
    void signature_value;
    void patient_present_attestation;
    void signature_type;

    const result = PatientInput.safeParse({ ...withoutConsent, join_file: false });
    expect(result.success).toBe(false);
    if (result.success) return;
    const fields = fieldErrorsFromZod(result.error);
    expect(fields.signature_value).toBe("A signature is required.");
    expect(fields.patient_present_attestation).toBe("Confirm that the patient is present.");
    expect(fields.consent_version).toBeTruthy();
  });

  it("names the file a joining person is being added to", () => {
    const result = PatientInput.safeParse({ ...base, join_file: true, file_number: "" });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(fieldErrorsFromZod(result.error).file_number).toBe(
      "Name the file this person is being added to.",
    );
  });
});

describe("PatientUpdate", () => {
  const editable = {
    ...base,
    file_number: "2014",
  };

  it("loads and keeps an existing postal code", () => {
    const result = PatientUpdate.safeParse({ ...editable, postal_code: "1983" });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(normalizePatientUpdate(result.data).postal_code).toBe("1983");
  });

  it("lets a postal code be removed", () => {
    // Blank leaves the form; the RPC stores NULL rather than an empty string.
    const result = PatientUpdate.safeParse({ ...editable, postal_code: "" });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(normalizePatientUpdate(result.data).postal_code).toBe("");
  });

  it("keeps the address independent of the postal code", () => {
    const result = PatientUpdate.safeParse({ ...editable, postal_code: "", residential_address: "" });
    expect(result.success).toBe(false);
  });
});
