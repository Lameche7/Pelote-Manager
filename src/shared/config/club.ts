import { env } from "./env";

const fallbackName = "Pelotaris Club Lourdais";

export const CLUB_CONFIG = {
  name: env.VITE_CLUB_NAME || fallbackName,
  shortName: env.VITE_CLUB_SHORT_NAME || fallbackName,
  location: env.VITE_CLUB_LOCATION || "Lourdes",
  venueName: env.VITE_CLUB_VENUE_NAME || "Trinquet Robert Cathala",
  tagline:
    env.VITE_CLUB_TAGLINE || "Plus qu’un Club, une Histoire.",
  foundedYear: env.VITE_CLUB_FOUNDED_YEAR || "1957",
  description:
    env.VITE_CLUB_DESCRIPTION ||
    "Le Pelotaris Club Lourdais fait vivre la pelote basque au cœur de Lourdes. Pelote Manager accompagne la vie quotidienne du club et de ses pratiquants.",
  logoUrl: env.VITE_CLUB_LOGO_URL || "/branding/pcl-logo.png",
  logoAlt: env.VITE_CLUB_LOGO_ALT || fallbackName,
} as const;
