/**
 * Continuous ECG rhythm strip for the login image panel letterbox.
 * Each spike is a simplified QRS complex; the strip scrolls indefinitely.
 */
export function LoginEcgTrace() {
  // One segment: baseline + P-ish bump + QRS + T-ish recovery (viewBox units).
  // Two copies side-by-side enable a seamless translateX loop.
  const segment =
    "M0 28 " +
    "h18 " +
    "c2 0 3-1 4-3 1 3 2 4 4 4 " + // soft P
    "h6 " +
    "l3 -1 2 14 3 -28 3 22 2 -5 4 1 " + // QRS (sharp peak)
    "h5 " +
    "c3 0 5-4 8-4 3 0 4 3 6 4 " + // T
    "h22";

  // Tile the segment across a long path (two identical halves for looping).
  const half =
    segment +
    " " +
    segment.replace(/M0 28/, "M100 28") +
    " " +
    segment.replace(/M0 28/, "M200 28") +
    " " +
    segment.replace(/M0 28/, "M300 28");

  const pathD = half + " " + half.replace(/M(\d+)/g, (_, n) => `M${Number(n) + 400}`);

  return (
    <div className="loginEcg" aria-hidden="true">
      <div className="loginEcgBand loginEcgBandTop">
        <EcgSvg pathD={pathD} />
      </div>
      <div className="loginEcgBand loginEcgBandBottom">
        <EcgSvg pathD={pathD} />
      </div>
    </div>
  );
}

function EcgSvg({ pathD }: { pathD: string }) {
  return (
    <svg
      className="loginEcgSvg"
      viewBox="0 0 800 56"
      preserveAspectRatio="none"
      focusable="false"
    >
      {/* faint grid like a paper rhythm strip */}
      <defs>
        <pattern id="ecgGrid" width="20" height="14" patternUnits="userSpaceOnUse">
          <path d="M20 0H0V14" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" />
        </pattern>
      </defs>
      <rect width="800" height="56" fill="url(#ecgGrid)" />
      <g className="loginEcgScroll">
        <path
          d={pathD}
          fill="none"
          stroke="rgba(180, 255, 220, 0.55)"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        {/* soft glow pass */}
        <path
          d={pathD}
          fill="none"
          stroke="rgba(120, 255, 200, 0.22)"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}
