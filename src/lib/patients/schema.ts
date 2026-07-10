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
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ()]{7,20}$/, "Enter a valid mobile number.")
    .refine(
      (value) => {
        const digits = value.replace(/\D/g, "").length;
        return digits >= 7 && digits <= 15;
      },
      "Enter a valid mobile number.",
    ),
  email: optionalEmail,
  residential_address: z
    .string()
    .trim()
    .min(3, "Residential address is required.")
    .max(500),
} as const;

type PatientCore = {
  date_of_birth: string;
  identity_type: z.infer<typeof IdentityType>;
  identity_number: string;
  identity_country: string;
  no_identity_reason: string;
};

/** Identity/date validation shared by onboarding and editing. */
function refinePatientCore(value: PatientCore, context: z.RefinementCtx) {
  const birthDate = new Date(`${value.date_of_birth}T00:00:00Z`);
  if (birthDate > new Date()) {
    context.addIssue({
      code: "custom",
      path: ["date_of_birth"],
      message: "Date of birth cannot be in the future.",
    });
  }

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

export const PatientInput = z
  .object({
    ...patientCoreShape,
    // Clinic-supplied file number. Blank means auto-generate (DRRG########).
    file_number: z.string().trim().max(40).default(""),
    consent_version: z.string().trim().min(1),
    consent_text_hash: z.string().regex(/^[a-f0-9]{64}$/),
    signature_type: z.enum(["typed_name", "drawn_signature"]),
    signature_value: z.string().trim().min(2, "A signature is required.").max(500),
    patient_present_attestation: z.literal(true),
    duplicate_reviewed: z.boolean().default(false),
    duplicate_candidate_ids: z.array(z.uuid()).max(10).default([]),
    duplicate_review_reason: z.string().trim().max(500).default(""),
  })
  .superRefine((value, context) => {
    refinePatientCore(value, context);

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
  .superRefine(refinePatientCore);

export type PatientUpdate = z.infer<typeof PatientUpdate>;

function normalizeCore<T extends PatientCore & {
  first_names: string;
  surname: string;
  phone: string;
  email: string;
  residential_address: string;
}>(input: T): T {
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
  };
}

export function normalizePatientInput(input: PatientInput): PatientInput {
  return { ...normalizeCore(input), file_number: input.file_number.trim() };
}

export function normalizePatientUpdate(input: PatientUpdate): PatientUpdate {
  return { ...normalizeCore(input), file_number: input.file_number.trim() };
}
