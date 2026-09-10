export const MARKETING_HOST = "www.pelotemanager.fr";
export const APP_HOST = "app.pelotemanager.fr";
export const MARKETING_PREVIEW_PATH = "/presentation";

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
