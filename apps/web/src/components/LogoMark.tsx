/** The latteart gem mark in an amber gradient tile. */
export function LogoMark({ size = 26 }: { size?: number }) {
  const icon = Math.round(size * 0.58);
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 7,
        background:
          "linear-gradient(150deg, var(--accent), color-mix(in srgb, var(--accent) 52%, #000))",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "0 2px 6px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.28)",
        flex: "none",
      }}
    >
      <svg
        width={icon}
        height={icon}
        viewBox="0 0 24 24"
        fill="none"
        stroke="#1a1205"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m12 3 8.5 4.7L12 12.4 3.5 7.7 12 3Z" />
        <path d="m4 12 8 4.5 8-4.5" />
      </svg>
    </div>
  );
}
