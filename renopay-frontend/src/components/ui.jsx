const VARIANT_CLASSES = {
  primary: "bg-accent text-white shadow-accentGlow",
  ghost: "bg-transparent text-accent border border-accent/40",
  danger: "bg-danger text-white shadow-[0_6px_18px_rgba(255,61,96,.35)]",
  teal: "bg-gradient-to-br from-teal to-[#16a34a] text-white",
  dark: "bg-surf text-textLight border border-line",
  gold: "bg-accent text-white shadow-accentGlow",
};

export function Btn({ children, onClick, variant = "primary", className = "", disabled, type = "button" }) {
  return (
    <button
      type={type}
      className={`btn rounded-full px-[22px] py-[13px] text-[15px] font-semibold w-full
        ${VARIANT_CLASSES[variant]} ${disabled ? "opacity-45" : ""} ${className}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

export function Badge({ children, color = "#FF6A1A", size = 11 }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full font-bold px-[9px] py-[3px]"
      style={{ background: color + "22", color, border: `1px solid ${color}44`, fontSize: size }}
    >
      {children}
    </span>
  );
}

export function TrustBadge({ score }) {
  const col = score >= 90 ? "#22C55E" : score >= 70 ? "#FFA000" : "#ff3d60";
  const label = score >= 90 ? "Secure" : score >= 70 ? "Moderate" : "Flagged";
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full font-bold px-2 py-0.5 text-[10px]"
      style={{ background: col + "1a", color: col, border: `1px solid ${col}44` }}
    >
      🛡 {score}% {label}
    </span>
  );
}

export function Card({ children, className = "", style, onClick, role, tabIndex }) {
  if (onClick) {
    return (
      <div
        role={role || "button"}
        tabIndex={tabIndex ?? 0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick(e);
          }
        }}
        className={`bg-card border border-line rounded-[20px] text-textLight cursor-pointer ${className}`}
        style={style}
        onClick={onClick}
      >
        {children}
      </div>
    );
  }
  return (
    <div className={`bg-card border border-line rounded-[20px] text-textLight ${className}`} style={style}>
      {children}
    </div>
  );
}
