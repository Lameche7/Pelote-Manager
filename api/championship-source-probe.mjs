const ALLOWED_HOSTS = new Set([
  "lbpb.competition.ffpb.net",
]);

const normalizeSourceUrl = (value) => {
  const raw = String(value ?? "").trim();
  if (!raw) throw new Error("Source URL manquante");
  const url = new URL(/^https?:\/\//iu.test(raw) ? raw : `https://${raw}`);
  if (!ALLOWED_HOSTS.has(url.hostname)) {
    throw new Error("Source non autorisée");
  }
  return url;
};

const federationHeaders = {
  "user-agent": "PeloteManager/1.0 (+https://pelote-manager.vercel.app)",
  accept: "text/html,application/xhtml+xml",
};

const fetchFederationPage = async (sourceUrl) => {
  let upstream = await fetch(sourceUrl, {
    redirect: "follow",
    headers: federationHeaders,
  });
  let html = await upstream.text();

  if (/FFPB_COMPETITION/iu.test(html) && !sourceUrl.pathname.includes("FFPB_COMPETITION")) {
    const redirectedUrl = new URL("/FFPB_COMPETITION/", sourceUrl.origin);
    redirectedUrl.search = sourceUrl.search;
    upstream = await fetch(redirectedUrl, {
      redirect: "follow",
      headers: federationHeaders,
    });
    html = await upstream.text();
  }

  return { upstream, html };
};

const contextAround = (html, marker, radius = 1800) => {
  const index = html.indexOf(marker);
  if (index < 0) return null;
  return html.slice(Math.max(0, index - radius), Math.min(html.length, index + radius));
};

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "Method not allowed" });
  }

  try {
    const sourceUrl = normalizeSourceUrl(request.query?.url);
    sourceUrl.searchParams.set("I7", "12");
    const { upstream, html } = await fetchFederationPage(sourceUrl);
    const compact = html.replace(/\s+/gu, " ");
    const markers = [
      "Poule 1",
      "LESCAR PELOTARI CLUB",
      "BILLERE PELOTARI CLUB",
      "Senior 2ème Série",
      "Classement",
      "Vict.",
    ];

    return response.status(200).json({
      ok: upstream.ok,
      status: upstream.status,
      finalUrl: upstream.url,
      contentType: upstream.headers.get("content-type"),
      length: html.length,
      markers: Object.fromEntries(
        markers.map((marker) => [marker, compact.includes(marker)]),
      ),
      contexts: Object.fromEntries(
        markers.map((marker) => [marker, contextAround(html, marker)]),
      ),
    });
  } catch (error) {
    return response.status(400).json({
      error: error instanceof Error ? error.message : "Probe impossible",
    });
  }
}
