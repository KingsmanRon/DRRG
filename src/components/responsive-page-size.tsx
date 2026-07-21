"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// The patient list is paginated server-side (SQL LIMIT/OFFSET), so the page
// size has to be known on the server before the query runs. This tiny client
// component detects the device and stores the choice in a cookie the server
// reads: touch tablets show 10 rows, desktop (mouse) shows 15. It refreshes the
// route only when the value actually changes, so there is no render loop.
const COOKIE = "patientsPageSize";
// A tablet's primary input is a coarse pointer (finger); a PC's is a mouse.
const TABLET_QUERY = "(pointer: coarse)";

function desiredSize(): "10" | "15" {
  return window.matchMedia(TABLET_QUERY).matches ? "10" : "15";
}

function currentCookie(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)patientsPageSize=(\d+)/);
  return match ? match[1] : null;
}

export function ResponsivePageSize() {
  const router = useRouter();

  useEffect(() => {
    const media = window.matchMedia(TABLET_QUERY);
    function sync() {
      const size = desiredSize();
      if (currentCookie() !== size) {
        document.cookie = `${COOKIE}=${size};path=/;max-age=31536000;samesite=lax`;
        router.refresh();
      }
    }
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [router]);

  return null;
}
