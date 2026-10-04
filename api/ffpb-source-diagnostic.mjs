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

    return response.status(200).json({
      first: {
        status: first.status,
        finalUrl: first.url,
        contentType: first.headers.get("content-type"),
        cookieNames: cookie
          .split(/;\s*/u)
          .filter(Boolean)
          .map((item) => item.split("=", 1)[0]),
        hasI7: /id=["']I7["']/iu.test(firstHtml),
        hasForm: /<form\b/iu.test(firstHtml),
        hasCompetition: /FFPB_COMPETITION/iu.test(firstHtml),
        title: firstHtml.match(/<title[^>]*>([^<]*)<\/title>/iu)?.[1] ?? null,
        length: firstHtml.length,
      },
      root: {
        status: second.status,
        finalUrl: second.url,
        contentType: second.headers.get("content-type"),
        hasI7: /id=["']I7["']/iu.test(secondHtml),
        hasForm: /<form\b/iu.test(secondHtml),
        title: secondHtml.match(/<title[^>]*>([^<]*)<\/title>/iu)?.[1] ?? null,
        length: secondHtml.length,
      },
    });
  } catch (error) {
    return response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}
