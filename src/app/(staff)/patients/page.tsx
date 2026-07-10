import Link from "next/link";
import { PlusIcon } from "@/components/icons";
import { PatientSearch } from "@/components/patient-search";
import { PatientTable, type PatientListItem, type SortColumn, type SortDir } from "@/components/patient-table";
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

function demoSorted(items: PatientListItem[], sort?: SortColumn, dir?: SortDir): PatientListItem[] {
  if (!sort) return items;
  const factor = dir === "desc" ? -1 : 1;
  const key = (patient: PatientListItem) =>
    sort === "file_number"
      ? patient.file_number.toLowerCase()
      : sort === "name"
        ? `${patient.surname} ${patient.first_names}`.toLowerCase()
        : patient.date_of_birth;
  return [...items].sort((a, b) => key(a).localeCompare(key(b)) * factor);
}

async function getPatients(
  query: string,
  page: number,
  sort?: SortColumn,
  dir?: SortDir,
): Promise<PatientSearchResult> {
  if (isDemoMode()) {
    const term = query.toLowerCase();
    const phoneTerm = normalisePhone(query);
    const matches = demoPatients
      .map((patient) => ({
        id: patient.id,
        file_number: patient.file_number,
        first_names: patient.first_names,
        surname: patient.surname,
        date_of_birth: patient.date_of_birth,
        identity_type: patient.identity_type,
        identity_last4: patient.identity_number ? patient.identity_number.slice(-4) : null,
        phone: patient.phone,
        status: patient.status,
        duplicate_tier: "duplicate_tier" in patient ? patient.duplicate_tier : null,
      }) satisfies PatientListItem)
      .filter((patient) => !term
        || [patient.file_number, patient.first_names, patient.surname, patient.identity_last4 ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(term)
        || (phoneTerm.length > 0 && normalisePhone(patient.phone).includes(phoneTerm)));
    const sorted = demoSorted(matches, sort, dir);
    return {
      patients: sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
      total_count: sorted.length,
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("search_patients", {
    p_query: query,
    p_limit: PAGE_SIZE,
    p_offset: (page - 1) * PAGE_SIZE,
    p_sort: sort ?? "recent",
    p_dir: dir ?? "desc",
  });

  if (error) throw new Error(`Unable to load patients: ${error.message}`);
  const result = data as PatientSearchResult | null;
  return {
    patients: result?.patients ?? [],
    total_count: Number(result?.total_count ?? 0),
  };
}

function pageHref(query: string, page: number, sort?: SortColumn, dir?: SortDir): string {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (sort) params.set("sort", sort);
  if (dir) params.set("dir", dir);
  if (page > 1) params.set("page", String(page));
  const search = params.toString();
  return search ? `/patients?${search}` : "/patients";
}

const SORT_COLUMNS: SortColumn[] = ["file_number", "name", "date_of_birth"];

export default async function PatientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; sort?: string; dir?: string }>;
}) {
  const params = await searchParams;
  const query = params.q?.trim().slice(0, 120) ?? "";
  const requestedPage = Number.parseInt(params.page ?? "1", 10);
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const sort = SORT_COLUMNS.includes(params.sort as SortColumn) ? (params.sort as SortColumn) : undefined;
  const dir: SortDir | undefined = sort ? (params.dir === "desc" ? "desc" : "asc") : undefined;
  const result = await getPatients(query, page, sort, dir);
  const pageCount = Math.max(1, Math.ceil(result.total_count / PAGE_SIZE));

  // The practice only registers cash patients (no medical aid workflows), so
  // there is deliberately no payment-type filter here.
  return (
    <main className="pageShell">
      <div className="pageTitleRow">
        <h1>Patients</h1>
        <Link className="button buttonPrimary" href="/patients/new">
          <PlusIcon />
          New patient
        </Link>
      </div>

      <PatientSearch initialQuery={query} sort={sort} dir={dir} />

      <PatientTable
        patients={result.patients}
        total={result.total_count}
        page={page}
        pageSize={PAGE_SIZE}
        heading={query ? "Search results" : sort ? "All patients" : "Recently registered"}
        query={query}
        sort={sort}
        dir={dir}
      />

      {pageCount > 1 && (
        <nav className="pagination" aria-label="Patient pages">
          {page > 1 ? <Link className="button buttonSecondary" href={pageHref(query, page - 1, sort, dir)}>Previous</Link> : <span />}
          <span>Page {page} of {pageCount}</span>
          {page < pageCount ? <Link className="button buttonSecondary" href={pageHref(query, page + 1, sort, dir)}>Next</Link> : <span />}
        </nav>
      )}
    </main>
  );
}
