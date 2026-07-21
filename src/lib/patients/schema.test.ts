import { describe, expect, it } from "vitest";
import { normalisePhone } from "./phone";
import {
  ContactDetailsStep,
  PersonalDetailsStep,
  PatientInput,
  fieldErrorsFromZod,
  normalizePatientInput,
} from "./schema";

const base = {
  first_names: "Nomsa Thandi",
  surname: "Dlamini",
  date_of_birth: "1980-01-01",
  identity_type: "sa_id" as const,
  identity_number: "8001015009087",
  identity_country: "",
  no_identity_reason: "",
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

  it("accepts a foreign patient with no identity document", () => {
    const result = PatientInput.safeParse({
      ...base,
      identity_type: "none",
      identity_number: "",
      no_identity_reason: "Passport application pending",
    });
    expect(result.success).toBe(true);
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
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const fields = fieldErrorsFromZod(result.error);
    expect(fields.phone).toBeTruthy();
    expect(fields.email).toBeTruthy();
    expect(fields.residential_address).toBeTruthy();
  });
});
