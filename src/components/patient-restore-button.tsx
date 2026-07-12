"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function PatientRestoreButton({
  patientId,
  fileNumber,
}: {
  patientId: string;
  fileNumber: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function restore() {
    setBusy(true);
    setError("");
    const response = await fetch(`/api/patients/${patientId}/restore`, { method: "POST" });
    const body = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) {
      setError(body.error ?? "The patient could not be restored.");
      return;
    }
    router.replace(`/patients/${patientId}`);
    router.refresh();
  }

  if (!confirming) {
    return (
      <button type="button" className="button buttonPrimary" onClick={() => setConfirming(true)}>
        Restore to active register
      </button>
    );
  }

  return (
    <div className="archiveConfirmPanel">
      <p>
        Put <strong className="mono">{fileNumber}</strong> back on the active patient list?
        Reception will be able to find and edit this file again.
      </p>
      {error && <div className="formErrorBanner" role="alert">{error}</div>}
      <div className="dangerActions">
        <button type="button" className="button buttonSecondary" disabled={busy} onClick={() => setConfirming(false)}>
          Cancel
        </button>
        <button type="button" className="button buttonPrimary" disabled={busy} onClick={restore}>
          {busy ? "Restoring" : "Confirm restore"}
        </button>
      </div>
    </div>
  );
}
