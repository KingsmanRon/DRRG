import { notFound } from "next/navigation";
import { PatientEditForm, type PatientRecord } from "@/components/patient-edit-form";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function PatientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("patients")
    .select(
      "id, file_number, first_names, surname, date_of_birth, identity_type, identity_number, identity_country, no_identity_reason, phone, email, residential_address, status",
    )
    .eq("id", id)
    .maybeSingle();

  if (error || !data) notFound();

  return <PatientEditForm patient={data as PatientRecord} />;
}
