const ALLOWED_HOSTS = new Set(["lbpb.competition.ffpb.net"]);

const normalizeSourceUrl = (value) => {
  const raw = String(value ?? "").trim();
  if (!raw) throw new Error("Source URL manquante");
  const url = new URL(/^https?:\/\//iu.test(raw) ? raw : `https://${raw}`);
  if (!ALLOWED_HOSTS.has(url.hostname)) throw new Error("Source non autorisée");
  return url;
};

const federationHeaders = {
  "user-agent": "PeloteManager/1.0 (+https://pelote-manager.vercel.app)",
  accept: "text/html,application/xhtml+xml,*/*",
};

const fetchFederationPage = async (sourceUrl) => {
  let upstream = await fetch(sourceUrl, { redirect: "follow", headers: federationHeaders });
  let html = await upstream.text();
  if (/FFPB_COMPETITION/iu.test(html) && !sourceUrl.pathname.includes("FFPB_COMPETITION")) {
    const redirectedUrl = new URL("/FFPB_COMPETITION/", sourceUrl.origin);
    redirectedUrl.search = sourceUrl.search;
    upstream = await fetch(redirectedUrl, { redirect: "follow", headers: federationHeaders });
    html = await upstream.text();
  }
  return { upstream, html };
};

const snippet = (text, needle, radius = 2500) => {
  const index = text.indexOf(needle);
  if (index < 0) return null;
  return text.slice(Math.max(0, index - radius), Math.min(text.length, index + radius));
};

export default async function handler(request, response) {
  if (request.method !== "GET") return response.status(405).json({ error: "Method not allowed" });
  try {
    const sourceUrl = normalizeSourceUrl(request.query?.url);
    const { html } = await fetchFederationPage(sourceUrl);
    const scriptPaths = Array.from(html.matchAll(/<script[^>]*src=["']([^"']+)["']/giu), (m) => m[1]);
    const wanted = scriptPaths.filter((path) => /(?:WDUtil|WDAJAX|WD\.js)/iu.test(path));
    const scripts = {};
    for (const path of wanted) {
      const url = new URL(path, sourceUrl.origin);
      const result = await fetch(url, { headers: federationHeaders });
      const body = await result.text();
      scripts[path] = {
        length: body.length,
        pfGetTraitement: snippet(body, "pfGetTraitement"),
        WD_ACTION: snippet(body, "WD_ACTION_"),
        AJAXPAGE: snippet(body, "AJAXPAGE"),
        AJAXEXECUTE: snippet(body, "AJAXEXECUTE"),
        WD_CONTEXTE: snippet(body, "WD_CONTEXTE_"),
      };
    }
    return response.status(200).json({ scripts });
  } catch (error) {
    return response.status(400).json({ error: error instanceof Error ? error.message : "Probe impossible" });
  }
}
