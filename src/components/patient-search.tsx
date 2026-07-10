"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { SearchIcon } from "./icons";

// Live patient search: filters as you type (debounced), Enter and the Search
// button apply immediately. The query lives in the URL so results stay
// shareable and server-rendered; sort order is preserved while typing.
export function PatientSearch({
  initialQuery,
  sort,
  dir,
}: {
  initialQuery: string;
  sort?: string;
  dir?: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initialQuery);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipDebounceRef = useRef(true);

  function targetHref(query: string): string {
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim().slice(0, 120));
    if (sort) params.set("sort", sort);
    if (dir) params.set("dir", dir);
    const search = params.toString();
    return search ? `/patients?${search}` : "/patients";
  }

  useEffect(() => {
    // Don't navigate on mount or when the URL itself changed the value.
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

  return (
    <form className="searchField" onSubmit={submit} role="search">
      <label className="srOnly" htmlFor="patient-search">Search patients</label>
      <SearchIcon />
      <input
        id="patient-search"
        name="q"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Search by name, file number, phone or identity number"
        autoComplete="off"
      />
      <button className="button buttonSecondary searchButton" type="submit">Search</button>
      {initialQuery && (
        <Link className="clearSearch" href="/patients" onClick={() => setValue("")}>Clear</Link>
      )}
    </form>
  );
}
