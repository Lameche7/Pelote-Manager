import { useEffect, useId, useMemo, useState } from "react";
import { useClubBranding } from "@/features/branding/context/ClubBrandingContext";

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
  const { branding } = useClubBranding();
  const [officialLogoAvailable, setOfficialLogoAvailable] = useState(true);
  const gradientId = useId().replace(/:/g, "");
  const initials = useMemo(
    () => getInitials(branding.shortName || branding.name) || "PM",
    [branding.name, branding.shortName],
  );

  useEffect(() => {
    setOfficialLogoAvailable(Boolean(branding.logoUrl));
  }, [branding.logoUrl]);

  return (
    <span
      className={`club-logo ${compact ? "club-logo--compact" : ""} ${className}`.trim()}
    >
      {officialLogoAvailable ? (
        <img
          src={branding.logoUrl}
          alt={branding.logoAlt}
          onError={() => setOfficialLogoAvailable(false)}
        />
      ) : (
        <svg viewBox="0 0 120 138" role="img" aria-label={branding.logoAlt}>
          <defs>
            <linearGradient id={gradientId} x1="0" x2="1">
              <stop offset="0" stopColor={branding.secondaryColor} />
              <stop offset="1" stopColor={branding.accentColor} />
            </linearGradient>
          </defs>
          <path
            d="M60 4C43 15 25 19 8 19v54c0 31 18 49 52 61 34-12 52-30 52-61V19C95 19 77 15 60 4Z"
            fill="#fff"
            stroke={`url(#${gradientId})`}
            strokeWidth="7"
          />
          <circle
            cx="60"
            cy="58"
            r="29"
            fill="#f8fafc"
            stroke={branding.secondaryColor}
            strokeWidth="3"
          />
          <text
            x="60"
            y="67"
            textAnchor="middle"
            fontSize="25"
            fontWeight="900"
            fill={branding.secondaryColor}
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
              fill={branding.accentColor}
            >
              {branding.shortName.slice(0, 20).toUpperCase()}
            </text>
          )}
        </svg>
      )}
    </span>
  );
}
