import { PatientOnboardingForm, type FileContext } from "@/components/patient-onboarding-form";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Load the household behind ?file=DRRG… so the form can lock onto it, prefill
 * the shared contact details and show who is already on the file. Returns null
 * for a file number with no active people on it, in which case the page falls
 * back to registering a brand new file rather than failing outright.
 */
async function loadFile(fileNumber: string): Promise<FileContext | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("patients")
    .select("id, first_names, surname, date_of_birth, phone, residential_address, no_contact_reason")
    .eq("file_number", fileNumber)
    .eq("status", "active")
    .order("created_at", { ascending: true });

  if (error || !data || data.length === 0) return null;

  const [firstOnFile] = data;
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
    no_contact_reason: firstOnFile.no_contact_reason ?? "",
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

  return <PatientOnboardingForm fileContext={fileContext} />;
}
