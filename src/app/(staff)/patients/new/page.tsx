import { AddFileMemberForm, type FileContext } from "@/components/add-file-member-form";
import { PatientOnboardingForm } from "@/components/patient-onboarding-form";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Load the household behind ?file=DRRG… so the short form can state what this
 * person inherits: the file's contact details and the consent already signed
 * for it. Returns null for a file number with no active people on it, in which
 * case the page falls back to registering a brand new file rather than failing
 * outright.
 */
async function loadFile(fileNumber: string): Promise<FileContext | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("patients")
    .select("id, first_names, surname, date_of_birth, phone, residential_address, postal_code, no_contact_reason")
    .eq("file_number", fileNumber)
    .eq("status", "active")
    .order("created_at", { ascending: true });

  if (error || !data || data.length === 0) return null;

  const [firstOnFile] = data;
  const memberIds = data.map((member) => member.id);

  // Whose signature covers this file. Rows with granted_by_patient_id set are
  // inherited consents, so they are not the signature — the earliest member
  // holding one of their own is.
  const { data: consents } = await supabase
    .from("patient_consents")
    .select("patient_id")
    .in("patient_id", memberIds)
    .is("granted_by_patient_id", null);

  const signatory = data.find((member) =>
    consents?.some((consent) => consent.patient_id === member.id),
  );

  return {
    file_number: fileNumber,
    members: data.map((member) => ({
      id: member.id,
      first_names: member.first_names,
      surname: member.surname,
      date_of_birth: member.date_of_birth,
    })),
    // Phone and address come from the person the file was opened for. Email is
    // deliberately not copied: it identifies an individual, not a household.
    phone: firstOnFile.phone ?? "",
    residential_address: firstOnFile.residential_address ?? "",
    postal_code: firstOnFile.postal_code ?? "",
    no_contact_reason: firstOnFile.no_contact_reason ?? "",
    consent_signed_by: signatory ? `${signatory.first_names} ${signatory.surname}` : "",
  };
}

export default async function NewPatientPage({
  searchParams,
}: {
  searchParams: Promise<{ file?: string }>;
}) {
  const { file } = await searchParams;
  const fileNumber = file?.trim().slice(0, 40) ?? "";
  const fileContext = fileNumber ? await loadFile(fileNumber) : null;

  // Two different jobs: opening a file is a full registration, adding someone
  // to one that exists is a much shorter form.
  return fileContext ? <AddFileMemberForm fileContext={fileContext} /> : <PatientOnboardingForm />;
}
