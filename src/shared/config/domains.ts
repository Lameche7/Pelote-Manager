export const MARKETING_HOST = "www.pelotemanager.fr";
export const APP_HOST = "app.pelotemanager.fr";
export const APEX_HOST = "pelotemanager.fr";
export const MARKETING_PREVIEW_PATH = "/presentation";

const ADMIN_TV_SETTINGS_PATH = "/admin/parametres";

export function isMarketingHostname(hostname: string) {
  return hostname.toLowerCase() === MARKETING_HOST;
}

export function isLocalOrPreviewHostname(hostname: string) {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized.endsWith(".vercel.app")
  );
}

export function applicationOrigin(hostname: string, currentOrigin: string) {
  if (isLocalOrPreviewHostname(hostname)) return currentOrigin;
  return `https://${APP_HOST}`;
}

function isAdminTvSettingsPath(pathname: string) {
  return pathname.replace(/\/+$/, "") === ADMIN_TV_SETTINGS_PATH;
}

export function currentApplicationOrigin() {
  if (typeof window === "undefined") return `https://${APP_HOST}`;

  // Le lien public du Mode TV est copié sur des Fire TV et autres écrans durables.
  // Il ne doit donc jamais exposer une URL de déploiement Vercel éphémère.
  if (isAdminTvSettingsPath(window.location.pathname)) {
    return `https://${APP_HOST}`;
  }

  return applicationOrigin(window.location.hostname, window.location.origin);
}

/**
 * Resolve a public entry club only from an explicit, previously validated
 * domain catalogue. Hostnames and URL parameters never grant permissions.
 * No club subdomains are activated by this helper.
 */
export function resolveEntryClubSlug(
  hostname: string,
  verifiedDomains: ReadonlyArray<{ hostname: string; clubSlug: string }>,
): string | null {
  const normalized = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (
    !normalized ||
    normalized.includes(":") ||
    normalized.includes("/") ||
    isLocalOrPreviewHostname(normalized) ||
    normalized === APP_HOST ||
    normalized === MARKETING_HOST ||
    normalized === APEX_HOST
  ) {
    return null;
  }

  const matches = verifiedDomains.filter(
    (entry) =>
      entry.hostname.trim().toLowerCase().replace(/\.$/, "") === normalized &&
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.clubSlug),
  );
  return matches.length === 1 ? matches[0].clubSlug : null;
}

/** A preferred home is presentation state, not club membership or access. */
export function resolvePlayerHomeClub(
  entryClubSlug: string | null,
  verifiedAffiliationSlug: string | null,
  preferredClubSlug: string | null,
): string | null {
  return preferredClubSlug || verifiedAffiliationSlug || entryClubSlug;
}

/** Keep only a syntactically safe public club hint in auth return links.
 * The hint is not verified membership or an authorization.
 */
export function publicClubQuery(clubSlug: string | null | undefined): string {
  return clubSlug && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(clubSlug)
    ? `?club=${encodeURIComponent(clubSlug)}`
    : "";
}

export function publicClubConfirmationRedirect(
  origin: string,
  clubSlug: string | null | undefined,
): string {
  return `${origin.replace(/\\/$/, "")}/${publicClubQuery(clubSlug)}`;
}
