type BrandLogoProps = { size?: number; className?: string; title?: string };

// Interpretation of the Dr RG Makoane practice mark: a green medical clover
// with the RG monogram at its centre. Swap this component's SVG for the
// supplied artwork (or an <img> to /brand/dr-makoane-logo.png) for a
// pixel-exact mark; every brand surface renders through this one component.
export function BrandLogo({ size = 40, className, title = "Dr RG Makoane" }: BrandLogoProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      <g fill="#4e9d2d">
        <circle cx="32" cy="18" r="15" />
        <circle cx="46" cy="32" r="15" />
        <circle cx="32" cy="46" r="15" />
        <circle cx="18" cy="32" r="15" />
      </g>
      <circle cx="32" cy="32" r="12.5" fill="#ffffff" />
      <text
        x="32"
        y="37.5"
        textAnchor="middle"
        fontFamily="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
        fontSize="13"
        fontWeight="700"
        fill="#153f9e"
      >
        RG
      </text>
    </svg>
  );
}
