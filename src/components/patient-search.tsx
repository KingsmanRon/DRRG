"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { SearchIcon } from "./icons";

export type PatientListScope = "active" | "include_archived" | "archived_only";

/** Three scopes, one grammar (§3.3). Stored values are unchanged. */
const SCOPES: { value: PatientListScope; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "include_archived", label: "All" },
  { value: "archived_only", label: "Archived" },
];

/**
 * Live patient search. Query and scope live in the URL so results stay
 * shareable and server-rendered.
 *
 * Search quality is the practice's main defence against duplicate files —
 * staff open a second file when they cannot find the first — so the query
 * matches file number, first names, surname and phone, partial and
 * case-insensitively.
 */
export function PatientSearch({
  initialQuery,
  scope = "active",
  showArchiveFilters = false,
}: {
  initialQuery: string;
  scope?: PatientListScope;
  showArchiveFilters?: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initialQuery);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipDebounceRef = useRef(true);
  const inputRef = useRef<HTMLInputElement>(null);

  function targetHref(query: string, nextScope: PatientListScope = scope): string {
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim().slice(0, 120));
    if (nextScope !== "active") params.set("scope", nextScope);
    const search = params.toString();
    return search ? `/patients?${search}` : "/patients";
  }

  useEffect(() => {
    if (skipDebounceRef.current) {
      skipDebounceRef.current = false;
      return;
    }
    debounceRef.current = setTimeout(() => router.replace(targetHref(value)), 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    router.replace(targetHref(value));
  }

  function clear() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setValue("");
    skipDebounceRef.current = true;
    router.replace(targetHref("", scope));
    inputRef.current?.focus();
  }

  function setScope(next: PatientListScope) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    router.replace(targetHref(value, next));
  }

  return (
    <div className="searchBlock">
      <form className="searchField" onSubmit={submit} role="search">
        <label className="srOnly" htmlFor="patient-search">
          Search patients
        </label>
        <SearchIcon size={18} />
        <input
          id="patient-search"
          name="q"
          ref={inputRef}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Search by name, file number, or phone"
          autoComplete="off"
        />
        {value && (
          <button type="button" className="searchClear" onClick={clear} aria-label="Clear search">
            ×
          </button>
        )}
      </form>

      {showArchiveFilters && (
        <div className="segmented" role="group" aria-label="Which patient files to show">
          {SCOPES.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`segment${scope === option.value ? " segmentActive" : ""}`}
              aria-pressed={scope === option.value}
              onClick={() => setScope(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
