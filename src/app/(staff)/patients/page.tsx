import Link from "next/link";
import { PlusIcon, SearchIcon } from "@/components/icons";
import { PatientTable, type PatientListItem } from "@/components/patient-table";
import { isDemoMode } from "@/lib/env";
import { demoPatients } from "@/lib/patients/demo";
import { normalisePhone } from "@/lib/patients/phone";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

type PatientSearchResult = {
  patients: PatientListItem[];
  total_count: number;
};

async function getPatients(query: string, page: number): Promise<PatientSearchResult> {
  if (isDemoMode()) {
    const term = query.toLowerCase();
    const phoneTerm = normalisePhone(query);
    const matches = demoPatients
      .map((patient) => ({ ...patient }))
      .filter((patient) => !term
        || [patient.file_number, patient.first_names, patient.surname, patient.identity_number ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(term)
        || (phoneTerm.length > 0 && normalisePhone(patient.phone).includes(phoneTerm)));
    return {
      patients: matches.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((patient) => ({
        id: patient.id,
        file_number: patient.file_number,
        first_names: patient.first_names,
        surname: patient.surname,
        date_of_birth: patient.date_of_birth,
        identity_type: patient.identity_type,
        identity_last4: patient.identity_number ? patient.identity_number.slice(-4) : null,
        phone: patient.phone,
        status: patient.status,
        possible_duplicate: "possible_duplicate" in patient ? patient.possible_duplicate : false,
      })),
      total_count: matches.length,
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("search_patients", {
    p_query: query,
    p_limit: PAGE_SIZE,
    p_offset: (page - 1) * PAGE_SIZE,
  });

  if (error) throw new Error(`Unable to load patients: ${error.message}`);
  const result = data as PatientSearchResult | null;
  return {
    patients: result?.patients ?? [],
    total_count: Number(result?.total_count ?? 0),
  };
}

function pageHref(query: string, page: number): string {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (page > 1) params.set("page", String(page));
  const search = params.toString();
  return search ? `/patients?${search}` : "/patients";
}

export default async function PatientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const params = await searchParams;
  const query = params.q?.trim().slice(0, 120) ?? "";
  const requestedPage = Number.parseInt(params.page ?? "1", 10);
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const result = await getPatients(query, page);
  const pageCount = Math.max(1, Math.ceil(result.total_count / PAGE_SIZE));

  return (
    <main className="pageShell">
      <div className="pageTitleRow">
        <div>
          <h1>Patients</h1>
          <p>Cash patients only</p>
        </div>
        <Link className="button buttonPrimary" href="/patients/new">
          <PlusIcon />
          New patient
        </Link>
      </div>

      <form className="searchField" method="get" action="/patients">
        <label className="srOnly" htmlFor="patient-search">Search patients</label>
        <SearchIcon />
        <input
          id="patient-search"
          name="q"
          defaultValue={query}
          placeholder="Search by name, file number, phone or identity number"
        />
        <button className="button buttonSecondary searchButton" type="submit">Search</button>
        {query && <Link className="clearSearch" href="/patients">Clear</Link>}
      </form>

      <PatientTable
        patients={result.patients}
        total={result.total_count}
        page={page}
        pageSize={PAGE_SIZE}
        heading={query ? "Search results" : "Recent patients"}
      />

      {pageCount > 1 && (
        <nav className="pagination" aria-label="Patient pages">
          {page > 1 ? <Link className="button buttonSecondary" href={pageHref(query, page - 1)}>Previous</Link> : <span />}
          <span>Page {page} of {pageCount}</span>
          {page < pageCount ? <Link className="button buttonSecondary" href={pageHref(query, page + 1)}>Next</Link> : <span />}
        </nav>
      )}
    </main>
  );
}
