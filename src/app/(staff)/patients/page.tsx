import { cookies } from "next/headers";
import Link from "next/link";
import { PlusIcon } from "@/components/icons";
import { PatientSearch, type PatientListScope } from "@/components/patient-search";
import { PatientTable, type PatientListItem, type SortColumn, type SortDir } from "@/components/patient-table";
import { ResponsivePageSize } from "@/components/responsive-page-size";
import { requireStaffPage } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

// Rows per page depends on the device (set client-side via a cookie): touch
// tablets get fewer rows, desktop gets more. Default to desktop for first paint.
const TABLET_PAGE_SIZE = 10;
const DESKTOP_PAGE_SIZE = 15;
const SCOPES: PatientListScope[] = ["active", "include_archived", "archived_only"];

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
  sort: SortColumn | undefined,
  dir: SortDir | undefined,
  scope: PatientListScope,
  pageSize: number,
): Promise<PatientSearchResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("search_patients", {
    p_query: query,
    p_limit: pageSize,
    p_offset: (page - 1) * pageSize,
    p_sort: sort ?? "recent",
    p_dir: dir ?? "desc",
    p_scope: scope,
  });

  if (error) throw new Error(`Unable to load patients: ${error.message}`);
  return parseSearchResult(data);
}

function pageHref(
  query: string,
  page: number,
  sort?: SortColumn,
  dir?: SortDir,
  scope: PatientListScope = "active",
): string {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (sort) params.set("sort", sort);
  if (dir) params.set("dir", dir);
  if (scope !== "active") params.set("scope", scope);
  if (page > 1) params.set("page", String(page));
  const search = params.toString();
  return search ? `/patients?${search}` : "/patients";
}

function listHeading(query: string, sort: SortColumn | undefined, scope: PatientListScope): string {
  if (query) {
    if (scope === "archived_only") return "Archived search results";
    if (scope === "include_archived") return "Search results (including archived)";
    return "Search results";
  }
  if (scope === "archived_only") return "Archived files";
  if (scope === "include_archived") return sort ? "All files (including archived)" : "Recent files (including archived)";
  if (sort) return "All patients";
  return "Recently registered";
}

function emptyCopy(query: string, scope: PatientListScope): {
  message: string;
  actionHref?: string;
  actionLabel?: string;
} {
  if (query) {
    if (scope === "archived_only") {
      return {
        message: "No archived files match that search. Try another name or file number.",
        actionHref: pageHref("", 1, undefined, undefined, "archived_only"),
        actionLabel: "Clear search",
      };
    }
    return {
      message: "No patients match that search. Check the spelling or try a file number or phone.",
      actionHref: "/patients",
      actionLabel: "Clear search",
    };
  }
  if (scope === "archived_only") {
    return {
      message: "There are no archived patient files yet.",
      actionHref: "/patients",
      actionLabel: "Back to active patients",
    };
  }
  return {
    message: "No patients registered yet. Register the first cash patient to start the list.",
    actionHref: "/patients/new",
    actionLabel: "New patient",
  };
}

const SORT_COLUMNS: SortColumn[] = ["file_number", "name", "date_of_birth"];

export default async function PatientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; sort?: string; dir?: string; scope?: string }>;
}) {
  const staff = await requireStaffPage();
  const params = await searchParams;
  const query = params.q?.trim().slice(0, 120) ?? "";
  const requestedPage = Number.parseInt(params.page ?? "1", 10);
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const sort = SORT_COLUMNS.includes(params.sort as SortColumn) ? (params.sort as SortColumn) : undefined;
  const dir: SortDir | undefined = sort ? (params.dir === "desc" ? "desc" : "asc") : undefined;

  const requestedScope = SCOPES.includes(params.scope as PatientListScope)
    ? (params.scope as PatientListScope)
    : "active";
  // Archive filters are doctor-only in the UI; the RPC also enforces this.
  const scope: PatientListScope = staff.role === "doctor" ? requestedScope : "active";

  const cookieStore = await cookies();
  const pageSize =
    cookieStore.get("patientsPageSize")?.value === String(TABLET_PAGE_SIZE)
      ? TABLET_PAGE_SIZE
      : DESKTOP_PAGE_SIZE;

  const result = await getPatients(query, page, sort, dir, scope, pageSize);
  const pageCount = Math.max(1, Math.ceil(result.total_count / pageSize));
  const empty = emptyCopy(query, scope);

  return (
    <main className="pageShell">
      <ResponsivePageSize />
      <div className="pageTitleRow">
        <div>
          <h1>Patients</h1>
          <p className="pageSubtitle">Cash patient register for the practice.</p>
        </div>
        <Link className="button buttonPrimary" href="/patients/new">
          <PlusIcon />
          New patient
        </Link>
      </div>

      <PatientSearch
        initialQuery={query}
        sort={sort}
        dir={dir}
        scope={scope}
        showArchiveFilters={staff.role === "doctor"}
      />

      <PatientTable
        patients={result.patients}
        total={result.total_count}
        page={page}
        pageSize={pageSize}
        heading={listHeading(query, sort, scope)}
        query={query}
        sort={sort}
        dir={dir}
        scope={scope}
        emptyMessage={empty.message}
        emptyActionHref={empty.actionHref}
        emptyActionLabel={empty.actionLabel}
      />

      {pageCount > 1 && (
        <nav className="pagination" aria-label="Patient pages">
          {page > 1 ? (
            <Link className="button buttonSecondary" href={pageHref(query, page - 1, sort, dir, scope)}>
              Previous
            </Link>
          ) : (
            <span />
          )}
          <span>
            Page {page} of {pageCount}
          </span>
          {page < pageCount ? (
            <Link className="button buttonSecondary" href={pageHref(query, page + 1, sort, dir, scope)}>
              Next
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </main>
  );
}
