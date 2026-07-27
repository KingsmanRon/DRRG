"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronRightIcon } from "./icons";

/**
 * A file rendered as a container with its patients nested inside.
 *
 * Shared by the register (§3.5) and the patient page's file-membership block
 * (§4.3) so the two screens cannot drift apart. The header is a real <button>,
 * not a clickable div: that is what gives keyboard Enter/Space and the
 * expanded state announcement for free.
 */
export function FileCard({
  header,
  children,
  defaultExpanded = false,
  expanded: controlledExpanded,
  onToggle,
}: {
  header: ReactNode;
  children: ReactNode;
  defaultExpanded?: boolean;
  /** Supply with onToggle to drive expansion from the parent (Expand all). */
  expanded?: boolean;
  onToggle?: (next: boolean) => void;
}) {
  const panelId = useId();
  const [uncontrolled, setUncontrolled] = useState(defaultExpanded);
  const isExpanded = controlledExpanded ?? uncontrolled;

  function toggle() {
    const next = !isExpanded;
    if (onToggle) onToggle(next);
    else setUncontrolled(next);
  }

  return (
    <section className="fileCard">
      <button
        type="button"
        className="fileCardHeader"
        aria-expanded={isExpanded}
        aria-controls={panelId}
        onClick={toggle}
      >
        <ChevronRightIcon
          className={`fileChevron${isExpanded ? " fileChevronOpen" : ""}`}
        />
        {header}
      </button>
      <div id={panelId} className="fileCardBody" hidden={!isExpanded}>
        {children}
      </div>
    </section>
  );
}

/** A file with a single matching patient: same shell, no header, no chevron. */
export function FlatFileCard({ children }: { children: ReactNode }) {
  return <section className="fileCard">{children}</section>;
}
