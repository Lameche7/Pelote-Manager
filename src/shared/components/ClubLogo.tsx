import { useState } from "react";

type ClubLogoProps = {
  compact?: boolean;
  className?: string;
};

export function ClubLogo({ compact = false, className = "" }: ClubLogoProps) {
  const [officialLogoAvailable, setOfficialLogoAvailable] = useState(true);

  return (
    <span className={`club-logo ${compact ? "club-logo--compact" : ""} ${className}`.trim()}>
      {officialLogoAvailable ? (
        <img
          src="/branding/pcl-logo.png"
          alt="Pelotaris Club Lourdais"
          onError={() => setOfficialLogoAvailable(false)}
        />
      ) : (
        <svg viewBox="0 0 120 138" role="img" aria-label="Pelotaris Club Lourdais">
          <defs>
            <linearGradient id="shield-border" x1="0" x2="1">
              <stop offset="0" stopColor="#0d2b6c" />
              <stop offset="0.5" stopColor="#0d2b6c" />
              <stop offset="0.5" stopColor="#d62828" />
              <stop offset="1" stopColor="#d62828" />
            </linearGradient>
          </defs>
          <path
            d="M60 4C43 15 25 19 8 19v54c0 31 18 49 52 61 34-12 52-30 52-61V19C95 19 77 15 60 4Z"
            fill="#fff"
            stroke="url(#shield-border)"
            strokeWidth="7"
          />
          <path d="M29 38c15 5 27 20 42 53" fill="none" stroke="#d62828" strokeWidth="10" strokeLinecap="round" />
          <path d="M91 38C76 43 66 58 50 91" fill="none" stroke="#0d2b6c" strokeWidth="10" strokeLinecap="round" />
          <circle cx="60" cy="57" r="7" fill="#fff" stroke="#0d2b6c" strokeWidth="2" />
          {!compact && (
            <>
              <text x="60" y="105" textAnchor="middle" fontSize="9" fontWeight="800" fill="#0d2b6c">PELOTARIS CLUB</text>
              <text x="60" y="116" textAnchor="middle" fontSize="10" fontWeight="900" fill="#d62828">LOURDAIS</text>
              <text x="60" y="127" textAnchor="middle" fontSize="8" fontWeight="800" fill="#0d2b6c">1957</text>
            </>
          )}
        </svg>
      )}
    </span>
  );
}
