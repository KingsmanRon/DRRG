"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function MainNav() {
  const pathname = usePathname() ?? "";
  const onDuplicates = pathname.startsWith("/patients/duplicates");
  const onPatients = pathname.startsWith("/patients") && !onDuplicates;

  return (
    <nav className="appNav" aria-label="Main">
      <Link href="/patients" className={onPatients ? "active" : ""} aria-current={onPatients ? "page" : undefined}>
        Patients
      </Link>
      <Link href="/patients/duplicates" className={onDuplicates ? "active" : ""} aria-current={onDuplicates ? "page" : undefined}>
        Possible duplicates
      </Link>
    </nav>
  );
}
