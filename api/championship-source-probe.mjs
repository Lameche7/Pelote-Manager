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

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "Method not allowed" });
  }

  try {
    const sourceUrl = normalizeSourceUrl(request.query?.url);
    const upstream = await fetch(sourceUrl, {
      redirect: "follow",
      headers: {
        "user-agent": "PeloteManager/1.0 (+https://pelote-manager.vercel.app)",
        accept: "text/html,application/xhtml+xml",
      },
    });
    const html = await upstream.text();
    const compact = html.replace(/\s+/gu, " ");
    const markers = [
      "Poule 1",
      "LESCAR PELOTARI CLUB",
      "BILLERE PELOTARI CLUB",
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
      sample: compact.slice(0, 1200),
    });
  } catch (error) {
    return response.status(400).json({
      error: error instanceof Error ? error.message : "Probe impossible",
    });
  }
}
