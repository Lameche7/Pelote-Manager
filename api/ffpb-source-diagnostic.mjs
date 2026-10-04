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

const parseSelects = (html) =>
  Array.from(
    html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/giu),
    (match) => {
      const attrs = match[1];
      const body = match[2];
      return {
        id: attrs.match(/\bid=["']([^"']+)["']/iu)?.[1] ?? null,
        name: attrs.match(/\bname=["']([^"']+)["']/iu)?.[1] ?? null,
        options: Array.from(
          body.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/giu),
          (optionMatch) => {
            const optionAttrs = optionMatch[1];
            return {
              value:
                decodeHtml(
                  optionAttrs.match(/\bvalue=["']([^"']*)["']/iu)?.[1] ?? "",
                ),
              memory:
                decodeHtml(
                  optionAttrs.match(/\bdata-wb-valmem=["']([^"']*)["']/iu)?.[1] ?? "",
                ),
              label: stripTags(optionMatch[2]),
              selected: /\bselected\b/iu.test(optionAttrs),
            };
          },
        ).slice(0, 80),
      };
    },
  ).slice(0, 30);

const parseButtons = (html) =>
  Array.from(
    html.matchAll(/<(button|input)\b([^>]*)>([\s\S]*?)(?:<\/button>|$)/giu),
    (match) => {
      const tag = match[1].toLowerCase();
      const attrs = match[2];
      const value = decodeHtml(
        attrs.match(/\bvalue=["']([^"']*)["']/iu)?.[1] ?? "",
      );
      return {
        tag,
        id: attrs.match(/\bid=["']([^"']+)["']/iu)?.[1] ?? null,
        name: attrs.match(/\bname=["']([^"']+)["']/iu)?.[1] ?? null,
        type: attrs.match(/\btype=["']([^"']+)["']/iu)?.[1] ?? null,
        value,
        text: tag === "button" ? stripTags(match[3]) : value,
      };
    },
  )
    .filter((item) => item.id || item.text)
    .slice(0, 120);

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

    const action = decodeHtml(
      secondHtml.match(/<form[^>]*action=["']([^"']+)["']/iu)?.[1] ?? "",
    );

    const competitionControls = Array.from(
      secondHtml.matchAll(/.{0,180}(?:CHAMPIONNAT HIVER|Championnat Hiver|2027).{0,260}/giu),
      (match) => stripTags(match[0]),
    ).slice(0, 50);

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
        action,
        hasI7: /id=["']I7["']/iu.test(secondHtml),
        hasForm: /<form\b/iu.test(secondHtml),
        title: secondHtml.match(/<title[^>]*>([^<]*)<\/title>/iu)?.[1] ?? null,
        length: secondHtml.length,
        selects: parseSelects(secondHtml),
        buttons: parseButtons(secondHtml),
        competitionControls,
      },
    });
  } catch (error) {
    return response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}
