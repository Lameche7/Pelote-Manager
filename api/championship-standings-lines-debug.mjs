const headersBase = {
  "user-agent": "PeloteManager/1.0 (+https://pelote-manager.vercel.app)",
  accept: "text/html,application/xhtml+xml,*/*",
};

const decodeHtml = (value = "") => String(value)
  .replace(/&nbsp;/giu, " ")
  .replace(/&amp;/giu, "&")
  .replace(/&quot;/giu, '"')
  .replace(/&#39;|&apos;/giu, "'")
  .replace(/&lt;/giu, "<")
  .replace(/&gt;/giu, ">");

const cookieFrom = (response) => {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);
  return values.map((value) => String(value).split(";", 1)[0]).join("; ");
};

const mergeCookies = (...cookies) => {
  const map = new Map();
  for (const cookie of cookies.filter(Boolean)) {
    for (const part of String(cookie).split(/;\s*/u)) {
      const index = part.indexOf("=");
      if (index > 0) map.set(part.slice(0, index), part.slice(index + 1));
    }
  }
  return Array.from(map, ([key, value]) => `${key}=${value}`).join("; ");
};

const formValues = (html) => {
  const values = new Map();
  for (const match of html.matchAll(/<select\b[^>]*name=["']([^"']+)["'][^>]*>([\s\S]*?)<\/select>/giu)) {
    const selected = match[2].match(/<option\b[^>]*selected[^>]*value=["']([^"']*)["']/iu)
      ?? match[2].match(/<option\b[^>]*value=["']([^"']*)["'][^>]*selected/iu)
      ?? match[2].match(/<option\b[^>]*value=["']([^"']*)["']/iu);
    if (selected) values.set(match[1], decodeHtml(selected[1]));
  }
  for (const match of html.matchAll(/<input\b([^>]*)>/giu)) {
    const attrs = match[1];
    const name = attrs.match(/\bname=["']([^"']+)["']/iu)?.[1];
    if (!name) continue;
    const type = (attrs.match(/\btype=["']([^"']+)["']/iu)?.[1] ?? "text").toLowerCase();
    if ((type === "checkbox" || type === "radio") && !/\bchecked\b/iu.test(attrs)) continue;
    const value = attrs.match(/\bvalue=["']([^"']*)["']/iu)?.[1] ?? "";
    values.set(name, decodeHtml(value));
  }
  return values;
};

const htmlToLines = (html) => decodeHtml(
  html
    .replace(/<script\b[\s\S]*?<\/script>/giu, " ")
    .replace(/<style\b[\s\S]*?<\/style>/giu, " ")
    .replace(/<(?:br|\/td|\/tr|\/div|\/p|\/li|\/table)>/giu, "\n")
    .replace(/<[^>]+>/gu, " "),
)
  .split(/\r?\n/gu)
  .map((line) => line.replace(/\s+/gu, " ").trim())
  .filter(Boolean);

export default async function handler(request, response) {
  if (request.method !== "GET") return response.status(405).json({ error: "GET only" });
  try {
    const source = new URL("https://lbpb.competition.ffpb.net/?id_competition=7");
    const bootstrap = await fetch(source, { redirect: "follow", headers: headersBase });
    const bootstrapHtml = await bootstrap.text();
    const cookie1 = cookieFrom(bootstrap);
    const pageUrl = new URL("/FFPB_COMPETITION/?id_competition=7", source.origin);
    const page = await fetch(pageUrl, {
      redirect: "follow",
      headers: { ...headersBase, ...(cookie1 ? { cookie: cookie1 } : {}) },
    });
    const html = await page.text();
    const cookie = mergeCookies(cookie1, cookieFrom(page));
    const actionRaw = html.match(/<form[^>]*action=["']([^"']+)["']/iu)?.[1];
    if (!actionRaw) throw new Error("form action missing");
    const action = new URL(decodeHtml(actionRaw), pageUrl.origin);
    const values = formValues(html);
    values.set("WD_ACTION_", "");
    values.set("WD_BUTTON_CLICK_", "I54");
    const body = new URLSearchParams();
    for (const [key, value] of values) body.set(key, value);
    const ranking = await fetch(action, {
      method: "POST",
      redirect: "follow",
      headers: {
        ...headersBase,
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        ...(cookie ? { cookie } : {}),
        referer: action.toString(),
      },
      body,
    });
    const lines = htmlToLines(await ranking.text());
    const headerIndex = lines.findIndex((line) => line.includes("Vict.") && line.includes("Points / partie"));
    const start = Math.max(0, headerIndex - 5);
    const end = Math.min(lines.length, headerIndex + 190);
    return response.status(200).json({
      status: ranking.status,
      lineCount: lines.length,
      headerIndex,
      rankingLines: lines.slice(start, end).map((line, offset) => ({ index: start + offset, line })),
    });
  } catch (error) {
    return response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}
