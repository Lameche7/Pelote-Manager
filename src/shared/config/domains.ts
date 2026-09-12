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
