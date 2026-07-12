import { describe, expect, it } from "vitest";
import { mapAuditRows } from "./audit";

describe("mapAuditRows", () => {
  it("formats merge and actor names", () => {
    const events = mapAuditRows(
      [
        {
          id: 1,
          action: "patient_merged",
          metadata: { source_file_number: "DRRG00000002", fields_copied: ["email"] },
          created_at: "2026-07-12T10:00:00Z",
          actor_user_id: "user-1",
        },
      ],
      new Map([["user-1", "Dr Refiloe G"]]),
    );

    expect(events).toHaveLength(1);
    expect(events[0].actor_name).toBe("Dr Refiloe G");
    expect(events[0].summary).toContain("DRRG00000002");
    expect(events[0].summary).toContain("email");
  });

  it("falls back when the actor profile is unknown", () => {
    const events = mapAuditRows(
      [
        {
          id: 2,
          action: "patient_created",
          metadata: {},
          created_at: "2026-07-12T10:00:00Z",
          actor_user_id: "missing",
        },
      ],
      new Map(),
    );
    expect(events[0].actor_name).toBe("Staff member");
    expect(events[0].summary).toBe("Patient registered");
  });
});
