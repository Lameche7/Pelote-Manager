import { useMemo, useState } from "react";
import { CLUB_CONFIG } from "@/shared/config";

type ClubLogoProps = {
  compact?: boolean;
  className?: string;
};

function getInitials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((word) => word[0]?.toUpperCase())
    .join("");
}

export function ClubLogo({ compact = false, className = "" }: ClubLogoProps) {
  const [officialLogoAvailable, setOfficialLogoAvailable] = useState(true);
  const initials = useMemo(
    () => getInitials(CLUB_CONFIG.shortName || CLUB_CONFIG.name) || "PM",
    [],
  );

  return (
    <span
      className={`club-logo ${compact ? "club-logo--compact" : ""} ${className}`.trim()}
    >
      {officialLogoAvailable ? (
        <img
          src={CLUB_CONFIG.logoUrl}
          alt={CLUB_CONFIG.logoAlt}
          onError={() => setOfficialLogoAvailable(false)}
        />
      ) : (
        <svg viewBox="0 0 120 138" role="img" aria-label={CLUB_CONFIG.logoAlt}>
          <defs>
            <linearGradient id="generic-club-border" x1="0" x2="1">
              <stop offset="0" stopColor="#0d2b6c" />
              <stop offset="1" stopColor="#d62828" />
            </linearGradient>
          </defs>
          <path
            d="M60 4C43 15 25 19 8 19v54c0 31 18 49 52 61 34-12 52-30 52-61V19C95 19 77 15 60 4Z"
            fill="#fff"
            stroke="url(#generic-club-border)"
            strokeWidth="7"
          />
          <circle cx="60" cy="58" r="29" fill="#f8fafc" stroke="#0d2b6c" strokeWidth="3" />
          <text
            x="60"
            y="67"
            textAnchor="middle"
            fontSize="25"
            fontWeight="900"
            fill="#0d2b6c"
          >
            {initials}
          </text>
          {!compact && (
            <text
              x="60"
              y="111"
              textAnchor="middle"
              fontSize="8"
              fontWeight="800"
              fill="#d62828"
            >
              {CLUB_CONFIG.shortName.slice(0, 20).toUpperCase()}
            </text>
          )}
        </svg>
      )}
    </span>
  );
}
