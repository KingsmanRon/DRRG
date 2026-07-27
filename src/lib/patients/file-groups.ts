/**
 * Grouping the flat search result into files.
 *
 * The register renders the file as the container and its patients nested
 * inside, so a file number is shown once rather than repeated on every row.
 * A repeated identifier reads as a duplicate record.
 */

export type GroupablePatient = {
  id: string;
  file_number: string;
  first_names: string;
  surname: string;
  date_of_birth: string;
  identity_type: string;
  identity_last4?: string | null;
  phone?: string | null;
  status?: string;
};

export type FileGroup<T extends GroupablePatient = GroupablePatient> = {
  file_number: string;
  patients: T[];
  /** The number shared by the file. Taken from the first member that has one. */
  phone: string | null;
};

/**
 * Group by file number, preserving the order the search returned rows in so
 * the caller's sort still drives the page.
 */
export function groupByFile<T extends GroupablePatient>(patients: T[]): FileGroup<T>[] {
  const groups = new Map<string, FileGroup<T>>();

  for (const patient of patients) {
    const existing = groups.get(patient.file_number);
    if (existing) {
      existing.patients.push(patient);
      if (!existing.phone && patient.phone) existing.phone = patient.phone;
    } else {
      groups.set(patient.file_number, {
        file_number: patient.file_number,
        patients: [patient],
        phone: patient.phone ?? null,
      });
    }
  }

  return [...groups.values()];
}

/**
 * Which files start expanded (§3.6).
 *
 * A file the query names by number is what the user asked for, so it opens.
 * Beyond that, only files holding more than one match are worth opening — an
 * expander that reveals a single row is a tease.
 */
export function defaultExpandedFiles<T extends GroupablePatient>(
  groups: FileGroup<T>[],
  query: string,
): Set<string> {
  const expanded = new Set<string>();
  const trimmed = query.trim().toLowerCase();

  for (const group of groups) {
    const matchedByNumber =
      trimmed.length > 0 && group.file_number.toLowerCase().includes(trimmed);

    if (
      groups.length === 1 ||
      matchedByNumber ||
      (trimmed.length > 0 && group.patients.length > 1)
    ) {
      expanded.add(group.file_number);
    }
  }

  return expanded;
}

/** Files above this count get Expand all / Collapse all; below it that is chrome. */
export const EXPAND_ALL_THRESHOLD = 10;
