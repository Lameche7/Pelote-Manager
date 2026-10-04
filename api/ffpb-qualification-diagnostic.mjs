const ALLOWED_HOST = "lbpb.competition.ffpb.net";

const decodeHtml = (value) =>
  String(value ?? "")
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&#(\d+);/gu, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/giu, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    );

const stripHtml = (html) =>
  decodeHtml(
    String(html ?? "")
      .replace(/<script\b[\s\S]*?<\/script>/giu, " ")
      .replace(/<style\b[\s\S]*?<\/style>/giu, " ")
      .replace(/<(?:br|\/td|\/tr|\/div|\/p|\/li|\/table|\/h[1-6])>/giu, "\n")
      .replace(/<[^>]+>/gu, " "),
  )
    .split(/\r?\n/gu)
    .map((line) => line.replace(/\s+/gu, " ").trim())
    .filter(Boolean);

export default async function handler(request, response) {
  try {
    const raw = String(request.query.url ?? "").trim();
    const url = new URL(raw);
    if (url.hostname !== ALLOWED_HOST) {
      return response.status(400).json({ error: "Host refusé" });
    }
    const result = await fetch(url, {
      redirect: "follow",
      headers: {
        "user-agent": "PeloteManager/1.0 (+https://pelotemanager.fr)",
        accept: "text/html,application/xhtml+xml,*/*",
      },
    });
    const html = await result.text();
    return response.status(200).json({
      status: result.status,
      finalUrl: result.url,
      length: html.length,
      lines: stripHtml(html).slice(0, 500),
      buttons: Array.from(
        html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/giu),
        (match) => ({
          id: match[1].match(/\bid=["']([^"']+)["']/iu)?.[1] ?? null,
          text: stripHtml(match[2]).join(" "),
        }),
      ).filter((item) => item.text),
    });
  } catch (error) {
    return response.status(500).json({
      error: error instanceof Error ? error.message : "Erreur inconnue",
    });
  }
}
