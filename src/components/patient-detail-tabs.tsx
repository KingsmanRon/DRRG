"use client";

import { useState, type ReactNode } from "react";

export function PatientDetailTabs({
  details,
  history,
  showHistory,
}: {
  details: ReactNode;
  history: ReactNode;
  showHistory: boolean;
}) {
  const [tab, setTab] = useState<"details" | "history">("details");

  if (!showHistory) {
    return <>{details}</>;
  }

  return (
    <div className="patientTabs">
      <div className="patientTabList" role="tablist" aria-label="Patient sections">
        <button
          type="button"
          role="tab"
          id="tab-details"
          aria-selected={tab === "details"}
          aria-controls="panel-details"
          className={`patientTab${tab === "details" ? " patientTabActive" : ""}`}
          onClick={() => setTab("details")}
        >
          Details
        </button>
        <button
          type="button"
          role="tab"
          id="tab-history"
          aria-selected={tab === "history"}
          aria-controls="panel-history"
          className={`patientTab${tab === "history" ? " patientTabActive" : ""}`}
          onClick={() => setTab("history")}
        >
          History
        </button>
      </div>
      <div
        id="panel-details"
        role="tabpanel"
        aria-labelledby="tab-details"
        hidden={tab !== "details"}
      >
        {details}
      </div>
      <div
        id="panel-history"
        role="tabpanel"
        aria-labelledby="tab-history"
        hidden={tab !== "history"}
        className="patientHistoryPanel"
      >
        {history}
      </div>
    </div>
  );
}
