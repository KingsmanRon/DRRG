"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { SearchIcon } from "./icons";

export type PatientListScope = "active" | "include_archived" | "archived_only";

// Live patient search: filters as you type (debounced). Query and list scope
// live in the URL so results stay shareable and server-rendered.
export function PatientSearch({
  initialQuery,
  sort,
  dir,
  scope = "active",
  showArchiveFilters = false,
}: {
  initialQuery: string;
  sort?: string;
  dir?: string;
  scope?: PatientListScope;
  showArchiveFilters?: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initialQuery);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipDebounceRef = useRef(true);

  function targetHref(query: string, nextScope: PatientListScope = scope): string {
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim().slice(0, 120));
    if (sort) params.set("sort", sort);
    if (dir) params.set("dir", dir);
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

  function setScope(next: PatientListScope) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    router.replace(targetHref(value, next));
  }

  const clearHref = scope === "active" ? "/patients" : `/patients?scope=${scope}`;

  return (
    <div className="searchBlock">
      <form className="searchField" onSubmit={submit} role="search">
        <label className="srOnly" htmlFor="patient-search">Search patients</label>
        <SearchIcon />
        <input
          id="patient-search"
          name="q"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Name, address, file number, phone or ID"
          autoComplete="off"
        />
        <button className="button buttonSecondary searchButton" type="submit">Search</button>
        {initialQuery && (
          <Link className="clearSearch" href={clearHref} onClick={() => setValue("")}>
            Clear
          </Link>
        )}
      </form>

      {showArchiveFilters && (
        <div className="scopeFilters" role="group" aria-label="Which patient files to show">
          <button
            type="button"
            className={`scopeChip${scope === "active" ? " scopeChipActive" : ""}`}
            aria-pressed={scope === "active"}
            onClick={() => setScope("active")}
          >
            Active only
          </button>
          <button
            type="button"
            className={`scopeChip${scope === "include_archived" ? " scopeChipActive" : ""}`}
            aria-pressed={scope === "include_archived"}
            onClick={() => setScope("include_archived")}
          >
            Include archived
          </button>
          <button
            type="button"
            className={`scopeChip${scope === "archived_only" ? " scopeChipActive" : ""}`}
            aria-pressed={scope === "archived_only"}
            onClick={() => setScope("archived_only")}
          >
            Archived only
          </button>
        </div>
      )}
    </div>
  );
}
