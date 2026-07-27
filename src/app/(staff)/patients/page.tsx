import Link from "next/link";
import { PlusIcon } from "@/components/icons";
import { PatientResults, type RegisterPatient } from "@/components/patient-results";
import { PatientSearch, type PatientListScope } from "@/components/patient-search";
import { requireStaffPage } from "@/lib/auth/session";
import { groupByFile } from "@/lib/patients/file-groups";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

const SCOPES: PatientListScope[] = ["active", "include_archived", "archived_only"];

// The register is not paginated: a cash practice's result sets are small, and
// grouping by file only reads correctly when a whole file is on the page.
// 100 is the RPC's own ceiling.
const RESULT_LIMIT = 100;

type PatientSearchResult = {
  patients: RegisterPatient[];
  total_count: number;
};

function parseSearchResult(data: Json | null): PatientSearchResult {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { patients: [], total_count: 0 };
  }
  const record = data as { patients?: RegisterPatient[]; total_count?: number };
  return {
    patients: Array.isArray(record.patients) ? record.patients : [],
    total_count: Number(record.total_count ?? 0),
  };
}

async function getPatients(query: string, scope: PatientListScope): Promise<PatientSearchResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("search_patients", {
    p_query: query,
    p_limit: RESULT_LIMIT,
    p_offset: 0,
    // Sorting by file number keeps a household's members adjacent in the
    // result, which is what the grouping then renders as one card.
    p_sort: "file_number",
    p_dir: "asc",
    p_scope: scope,
  });

  if (error) throw new Error(`Unable to load patients: ${error.message}`);
  return parseSearchResult(data);
}

export default async function PatientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; scope?: string }>;
}) {
  const staff = await requireStaffPage();
  const params = await searchParams;
  const query = params.q?.trim().slice(0, 120) ?? "";

  const requestedScope = SCOPES.includes(params.scope as PatientListScope)
    ? (params.scope as PatientListScope)
    : "active";
  // Archive scopes are doctor-only in the UI; the RPC also enforces this.
  const scope: PatientListScope = staff.role === "doctor" ? requestedScope : "active";

  const result = await getPatients(query, scope);
  const groups = groupByFile(result.patients);

  return (
    <main className="pageShell">
      <div className="pageTitleRow">
        <div>
          <h1>Patients</h1>
          <p className="pageSubtitle">Cash patient register for the practice</p>
        </div>
        <Link className="button buttonPrimary" href="/patients/new">
          <PlusIcon />
          New patient
        </Link>
      </div>

      <PatientSearch
        initialQuery={query}
        scope={scope}
        showArchiveFilters={staff.role === "doctor"}
      />

      {/* Keyed on the result set so a new search recomputes which files open,
          while re-renders within one result set keep what the user opened. */}
      <PatientResults
        key={`${query}::${scope}`}
        groups={groups}
        query={query}
        totalPatients={result.patients.length}
      />
    </main>
  );
}
