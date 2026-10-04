const ALLOWED_HOSTS = new Set(["lbpb.competition.ffpb.net"]);

const headers = {
  "user-agent": "PeloteManager/1.0 (+https://pelote-manager.vercel.app)",
  accept: "text/html,application/xhtml+xml,*/*",
};

const cookieFrom = (response) => {
  const values =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie")].filter(Boolean);
  return values.map((value) => String(value).split(";", 1)[0]).join("; ");
};

const decodeHtml = (value) =>
  String(value ?? "")
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">");

const stripTags = (value) =>
  decodeHtml(String(value ?? "").replace(/<[^>]+>/gu, " "))
    .replace(/\s+/gu, " ")
    .trim();

export default async function handler(request, response) {
  try {
    const raw = String(request.query?.url ?? "").trim();
    if (!raw) return response.status(400).json({ error: "missing url" });
    const source = new URL(raw);
    if (!ALLOWED_HOSTS.has(source.hostname)) {
      return response.status(400).json({ error: "unsupported host" });
    }

    const first = await fetch(source, { redirect: "follow", headers });
    const firstHtml = await first.text();
    const cookie = cookieFrom(first);
    const root = new URL("/FFPB_COMPETITION/", source.origin);
    const second = await fetch(root, {
      redirect: "follow",
      headers: { ...headers, ...(cookie ? { cookie } : {}) },
    });
    const secondHtml = await second.text();

    const competitionLinks = Array.from(
      secondHtml.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/giu),
      (match) => {
        const attrs = match[1];
        const href = decodeHtml(
          attrs.match(/\bhref=["']([^"']+)["']/iu)?.[1] ?? "",
        );
        return { href, label: stripTags(match[2]) };
      },
    )
      .filter((item) => /PAGE_ACCUEIL_INVITE|COMPETITION/iu.test(item.href))
      .slice(0, 50);

    const selects = Array.from(
      secondHtml.matchAll(/<select\b([^>]*)>/giu),
      (match) => ({
        id: match[1].match(/\bid=["']([^"']+)["']/iu)?.[1] ?? null,
        name: match[1].match(/\bname=["']([^"']+)["']/iu)?.[1] ?? null,
      }),
    ).slice(0, 30);

    const accueilSnippets = Array.from(
      secondHtml.matchAll(/.{0,120}(?:Championnat|Hiver|2027).{0,180}/giu),
      (match) => stripTags(match[0]),
    ).slice(0, 30);

    return response.status(200).json({
      first: {
        status: first.status,
        finalUrl: first.url,
        cookieNames: cookie
          .split(/;\s*/u)
          .filter(Boolean)
          .map((item) => item.split("=", 1)[0]),
        hasI7: /id=["']I7["']/iu.test(firstHtml),
        hasForm: /<form\b/iu.test(firstHtml),
        title: firstHtml.match(/<title[^>]*>([^<]*)<\/title>/iu)?.[1] ?? null,
        length: firstHtml.length,
      },
      root: {
        status: second.status,
        finalUrl: second.url,
        hasI7: /id=["']I7["']/iu.test(secondHtml),
        hasForm: /<form\b/iu.test(secondHtml),
        title: secondHtml.match(/<title[^>]*>([^<]*)<\/title>/iu)?.[1] ?? null,
        length: secondHtml.length,
        selects,
        competitionLinks,
        accueilSnippets,
      },
    });
  } catch (error) {
    return response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}
