import { z } from "zod";
import { isValidSouthAfricanId } from "./sa-id";

export const IdentityType = z.enum([
  "sa_id",
  "passport",
  "foreign_document",
  "none",
]);

const optionalEmail = z.union([
  z.literal(""),
  z.email("Enter a valid email address."),
]);

/** Fields that describe a patient, shared by onboarding and editing. */
const patientCoreShape = {
  first_names: z.string().trim().min(1, "First names are required.").max(120),
  surname: z.string().trim().min(1, "Surname is required.").max(120),
  date_of_birth: z.iso.date("Enter a valid date of birth."),
  identity_type: IdentityType,
  identity_number: z.string().trim().max(80).default(""),
  identity_country: z.string().trim().toUpperCase().max(2).default(""),
  no_identity_reason: z.string().trim().max(250).default(""),
  // Phone and address are validated conditionally in refineContact: both are
  // required unless "no contact details on file" is recorded with a reason.
  phone: z.string().trim().max(20).default(""),
  email: optionalEmail,
  residential_address: z.string().trim().max(500).default(""),
  no_contact_details: z.boolean().default(false),
  no_contact_reason: z.string().trim().max(250).default(""),
} as const;

type PatientCore = {
  date_of_birth: string;
  identity_type: z.infer<typeof IdentityType>;
  identity_number: string;
  identity_country: string;
  no_identity_reason: string;
};

function refineDateOfBirth(dateOfBirth: string, context: z.RefinementCtx) {
  const birthDate = new Date(`${dateOfBirth}T00:00:00Z`);
  if (Number.isNaN(birthDate.getTime()) || birthDate > new Date()) {
    context.addIssue({
      code: "custom",
      path: ["date_of_birth"],
      message: "Date of birth cannot be in the future.",
    });
  }
}

/** Identity/date validation shared by onboarding and editing. */
function refinePatientCore(value: PatientCore, context: z.RefinementCtx) {
  refineDateOfBirth(value.date_of_birth, context);

  if (value.identity_type === "none") {
    if (value.identity_number || value.identity_country) {
      context.addIssue({
        code: "custom",
        path: ["identity_number"],
        message: "Do not enter document details when no document is selected.",
      });
    }
    if (value.no_identity_reason.length < 3) {
      context.addIssue({
        code: "custom",
        path: ["no_identity_reason"],
        message: "Explain why no identity document is available.",
      });
    }
  }

  if (value.identity_type === "sa_id") {
    const normalized = value.identity_number.replace(/\s/g, "");
    if (!isValidSouthAfricanId(normalized)) {
      context.addIssue({
        code: "custom",
        path: ["identity_number"],
        message: "Enter a valid South African ID number.",
      });
    }
    if (value.identity_country) {
      context.addIssue({
        code: "custom",
        path: ["identity_country"],
        message: "Issuing country is not required for a South African ID.",
      });
    }
  }

  if (["passport", "foreign_document"].includes(value.identity_type)) {
    if (value.identity_number.length < 3) {
      context.addIssue({
        code: "custom",
        path: ["identity_number"],
        message: "Document number is required.",
      });
    }
    if (!/^[A-Z]{2}$/.test(value.identity_country)) {
      context.addIssue({
        code: "custom",
        path: ["identity_country"],
        message: "Select the two letter issuing country code.",
      });
    }
  }
}

const PHONE_PATTERN = /^\+?[0-9 ()]{7,20}$/;

/** A present phone number must look like a 7–15 digit mobile number. */
function isValidPhoneFormat(value: string): boolean {
  if (!PHONE_PATTERN.test(value)) return false;
  const digits = value.replace(/\D/g, "").length;
  return digits >= 7 && digits <= 15;
}

type ContactCore = {
  phone: string;
  residential_address: string;
  no_contact_details: boolean;
  no_contact_reason: string;
};

/**
 * Contact validation shared by onboarding, editing and the contact step.
 * Mirrors the "No identity document" pattern: phone and address are mandatory
 * unless the user records that there are no contact details on file, in which
 * case a short reason is required and any value that *is* supplied must be valid.
 */
function refineContact(value: ContactCore, context: z.RefinementCtx) {
  const phone = value.phone.trim();
  const address = value.residential_address.trim();

  if (value.no_contact_details) {
    if (value.no_contact_reason.trim().length < 3) {
      context.addIssue({
        code: "custom",
        path: ["no_contact_reason"],
        message: "Record why there are no contact details on file.",
      });
    }
    if (phone && !isValidPhoneFormat(phone)) {
      context.addIssue({ code: "custom", path: ["phone"], message: "Enter a valid mobile number." });
    }
    if (address && address.length < 3) {
      context.addIssue({
        code: "custom",
        path: ["residential_address"],
        message: "Enter a valid address or leave it blank.",
      });
    }
    return;
  }

  if (!isValidPhoneFormat(phone)) {
    context.addIssue({ code: "custom", path: ["phone"], message: "Enter a valid mobile number." });
  }
  if (address.length < 3) {
    context.addIssue({
      code: "custom",
      path: ["residential_address"],
      message: "Residential address is required.",
    });
  }
}

export const PatientInput = z
  .object({
    ...patientCoreShape,
    // Clinic-supplied file number. Blank means auto-generate (DRRG########).
    file_number: z.string().trim().max(40).default(""),
    consent_version: z.string().trim().min(1),
    consent_text_hash: z.string().regex(/^[a-f0-9]{64}$/),
    signature_type: z.enum(["typed_name", "drawn_signature"]),
    signature_value: z.string().trim().min(2, "A signature is required.").max(500),
    patient_present_attestation: z
      .boolean()
      .refine((value) => value === true, "Confirm that the patient is present."),
    duplicate_reviewed: z.boolean().default(false),
    duplicate_candidate_ids: z.array(z.uuid()).max(10).default([]),
    duplicate_review_reason: z.string().trim().max(500).default(""),
  })
  .superRefine((value, context) => {
    refinePatientCore(value, context);
    refineContact(value, context);

    if (value.duplicate_candidate_ids.length > 0) {
      if (!value.duplicate_reviewed) {
        context.addIssue({
          code: "custom",
          path: ["duplicate_reviewed"],
          message: "Review possible existing patients before continuing.",
        });
      }
      if (value.duplicate_review_reason.length < 5) {
        context.addIssue({
          code: "custom",
          path: ["duplicate_review_reason"],
          message: "Record why this is a different patient.",
        });
      }
    }
  });

export type PatientInput = z.infer<typeof PatientInput>;

/** Editing an existing patient: same core fields plus a required file number. */
export const PatientUpdate = z
  .object({
    ...patientCoreShape,
    file_number: z.string().trim().min(1, "File number is required.").max(40),
  })
  .superRefine((value, context) => {
    refinePatientCore(value, context);
    refineContact(value, context);
  });

export type PatientUpdate = z.infer<typeof PatientUpdate>;

// --- Step schemas for the multi-step onboarding wizard (same rules as PatientInput) ---

export const PersonalDetailsStep = z
  .object({
    file_number: z.string().trim().max(40).default(""),
    first_names: patientCoreShape.first_names,
    surname: patientCoreShape.surname,
    date_of_birth: patientCoreShape.date_of_birth,
  })
  .superRefine((value, context) => refineDateOfBirth(value.date_of_birth, context));

export const IdentityStep = z
  .object({
    identity_type: patientCoreShape.identity_type,
    identity_number: patientCoreShape.identity_number,
    identity_country: patientCoreShape.identity_country,
    no_identity_reason: patientCoreShape.no_identity_reason,
    // date_of_birth not needed for identity refine except DOB checks already done
    date_of_birth: z.iso.date().optional().default("1900-01-01"),
  })
  .superRefine((value, context) => {
    refinePatientCore(
      {
        date_of_birth: value.date_of_birth,
        identity_type: value.identity_type,
        identity_number: value.identity_number,
        identity_country: value.identity_country,
        no_identity_reason: value.no_identity_reason,
      },
      context,
    );
  });

export const ContactDetailsStep = z
  .object({
    phone: patientCoreShape.phone,
    email: patientCoreShape.email,
    residential_address: patientCoreShape.residential_address,
    no_contact_details: patientCoreShape.no_contact_details,
    no_contact_reason: patientCoreShape.no_contact_reason,
  })
  .superRefine(refineContact);

export const ConsentStep = z
  .object({
    signature_value: z.string().trim().min(2, "Enter the patient's full name as signature.").max(500),
    patient_present_attestation: z
      .boolean()
      .refine((value) => value === true, "Confirm that the patient is present."),
    duplicate_candidate_count: z.number().int().min(0).default(0),
    duplicate_reviewed: z.boolean().default(false),
    duplicate_review_reason: z.string().trim().max(500).default(""),
  })
  .superRefine((value, context) => {
    if (value.duplicate_candidate_count > 0) {
      if (!value.duplicate_reviewed) {
        context.addIssue({
          code: "custom",
          path: ["duplicate_reviewed"],
          message: "Review the possible matches before saving.",
        });
      }
      if (value.duplicate_review_reason.length < 5) {
        context.addIssue({
          code: "custom",
          path: ["duplicate_review_reason"],
          message: "Record why this is a different patient.",
        });
      }
    }
  });

/** Flatten Zod issues to a single message per field for form UIs (client + server). */
export function fieldErrorsFromZod(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? String(issue.path[0]) : "_form";
    if (!fields[key]) fields[key] = issue.message;
  }
  return fields;
}

function normalizeCore<
  T extends PatientCore & {
    first_names: string;
    surname: string;
    phone: string;
    email: string;
    residential_address: string;
    no_contact_details: boolean;
    no_contact_reason: string;
  },
>(input: T): T {
  return {
    ...input,
    first_names: input.first_names.trim(),
    surname: input.surname.trim(),
    identity_number:
      input.identity_type === "sa_id"
        ? input.identity_number.replace(/\s/g, "")
        : input.identity_number.trim().toUpperCase(),
    identity_country:
      input.identity_type === "passport" || input.identity_type === "foreign_document"
        ? input.identity_country.trim().toUpperCase()
        : "",
    no_identity_reason: input.identity_type === "none" ? input.no_identity_reason.trim() : "",
    phone: input.phone.trim(),
    email: input.email.trim().toLowerCase(),
    residential_address: input.residential_address.trim(),
    // The reason column is the DB's signal for "no contact details on file";
    // clear it unless the flag is set so full-contact records store null.
    no_contact_reason: input.no_contact_details ? input.no_contact_reason.trim() : "",
  };
}

export function normalizePatientInput(input: PatientInput): PatientInput {
  return { ...normalizeCore(input), file_number: input.file_number.trim() };
}

export function normalizePatientUpdate(input: PatientUpdate): PatientUpdate {
  return { ...normalizeCore(input), file_number: input.file_number.trim() };
}
