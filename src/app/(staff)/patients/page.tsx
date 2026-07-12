import Link from "next/link";
import { PlusIcon } from "@/components/icons";
import { PatientSearch } from "@/components/patient-search";
import { PatientTable, type PatientListItem, type SortColumn, type SortDir } from "@/components/patient-table";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

type PatientSearchResult = {
  patients: PatientListItem[];
  total_count: number;
};

function parseSearchResult(data: Json | null): PatientSearchResult {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { patients: [], total_count: 0 };
  }
  const record = data as { patients?: PatientListItem[]; total_count?: number };
  return {
    patients: Array.isArray(record.patients) ? record.patients : [],
    total_count: Number(record.total_count ?? 0),
  };
}

async function getPatients(
  query: string,
  page: number,
  sort?: SortColumn,
  dir?: SortDir,
): Promise<PatientSearchResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("search_patients", {
    p_query: query,
    p_limit: PAGE_SIZE,
    p_offset: (page - 1) * PAGE_SIZE,
    p_sort: sort ?? "recent",
    p_dir: dir ?? "desc",
  });

  if (error) throw new Error(`Unable to load patients: ${error.message}`);
  return parseSearchResult(data);
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
