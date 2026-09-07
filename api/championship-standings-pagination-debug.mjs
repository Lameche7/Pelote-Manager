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
    values.set(name, decodeHtml(attrs.match(/\bvalue=["']([^"']*)["']/iu)?.[1] ?? ""));
  }
  return values;
};

const categoryOption = (html, label) => {
  const select = html.match(/<select\b[^>]*id=["']I7["'][^>]*>([\s\S]*?)<\/select>/iu)?.[1] ?? "";
  const clean = (v) => String(v).normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLowerCase().replace(/[^a-z0-9]+/gu, " ").trim();
  for (const match of select.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/giu)) {
    const text = decodeHtml(match[2].replace(/<[^>]+>/gu, "")).replace(/\s+/gu, " ").trim();
    if (clean(text) === clean(label)) {
      return decodeHtml(match[1].match(/\bvalue=["']([^"']*)["']/iu)?.[1] ?? "");
    }
  }
  return null;
};

const post = async (action, cookie, values) => {
  const body = new URLSearchParams();
  for (const [key, value] of values) body.set(key, value);
  const res = await fetch(action, {
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
  return { html: await res.text(), cookie: mergeCookies(cookie, cookieFrom(res)), status: res.status, url: res.url };
};

const contexts = (html, needle, radius = 650) => {
  const result = [];
  let from = 0;
  while (result.length < 20) {
    const index = html.indexOf(needle, from);
    if (index < 0) break;
    result.push(html.slice(Math.max(0, index - radius), Math.min(html.length, index + radius)).replace(/\s+/gu, " "));
    from = index + needle.length;
  }
  return result;
};

export default async function handler(request, response) {
  if (request.method !== "GET") return response.status(405).json({ error: "GET only" });
  try {
    const division = String(request.query?.division ?? "Sénior 3ème Série");
    const source = new URL("https://lbpb.competition.ffpb.net/?id_competition=7");
    const bootstrap = await fetch(source, { redirect: "follow", headers: headersBase });
    const cookie1 = cookieFrom(bootstrap);
    await bootstrap.text();
    const pageUrl = new URL("/FFPB_COMPETITION/?id_competition=7", source.origin);
    const page = await fetch(pageUrl, { redirect: "follow", headers: { ...headersBase, ...(cookie1 ? { cookie: cookie1 } : {}) } });
    const html = await page.text();
    const cookie = mergeCookies(cookie1, cookieFrom(page));
    const actionRaw = html.match(/<form[^>]*action=["']([^"']+)["']/iu)?.[1];
    if (!actionRaw) throw new Error("form action missing");
    const action = new URL(decodeHtml(actionRaw), source.origin);
    const option = categoryOption(html, division);
    if (!option) throw new Error(`division not found: ${division}`);
    const values = formValues(html);
    values.set("I7", option);
    values.set("WD_ACTION_", "");
    values.set("WD_BUTTON_CLICK_", "I54");
    const ranking = await post(action, cookie, values);

    const lineCounters = Array.from(ranking.html.matchAll(/>(\d+\s*\/\s*\d+\s+lignes)</giu), (m) => m[1]);
    const buttonMatches = Array.from(ranking.html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/giu), (m) => ({
      id: m[1].match(/\bid=["']([^"']+)["']/iu)?.[1] ?? null,
      onclick: decodeHtml(m[1].match(/\bonclick=["']([^"']+)["']/iu)?.[1] ?? ""),
      text: decodeHtml(m[2].replace(/<[^>]+>/gu, " ")).replace(/\s+/gu, " ").trim(),
    })).filter((item) => /Afficher plus/iu.test(item.text));

    return response.status(200).json({
      division,
      status: ranking.status,
      url: ranking.url,
      length: ranking.html.length,
      lineCounters,
      showMoreButtons: buttonMatches,
      showMoreContexts: contexts(ranking.html, "Afficher plus"),
      seventyThreeContext: contexts(ranking.html, "/ 73 lignes", 350),
    });
  } catch (error) {
    return response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}
