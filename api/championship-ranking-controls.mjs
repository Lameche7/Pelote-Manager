const headersBase = {
  "user-agent": "PeloteManager/1.0 (+https://pelote-manager.vercel.app)",
  accept: "text/html,application/xhtml+xml,*/*",
};

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

const cookieFrom = (response) => {
  const values =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie")].filter(Boolean);
  return values.map((value) => String(value).split(";", 1)[0]).join("; ");
};

const mergeCookies = (...cookies) => {
  const values = new Map();
  for (const cookie of cookies.filter(Boolean)) {
    for (const part of String(cookie).split(/;\s*/u)) {
      const index = part.indexOf("=");
      if (index > 0) values.set(part.slice(0, index), part.slice(index + 1));
    }
  }
  return Array.from(values, ([key, value]) => `${key}=${value}`).join("; ");
};

const parseSelects = (html) => {
  const values = new Map();
  for (const match of html.matchAll(
    /<select\b[^>]*name=["']([^"']+)["'][^>]*>([\s\S]*?)<\/select>/giu,
  )) {
    const [, name, body] = match;
    const selected =
      body.match(/<option\b[^>]*selected[^>]*value=["']([^"']*)["']/iu) ??
      body.match(/<option\b[^>]*value=["']([^"']*)["'][^>]*selected/iu) ??
      body.match(/<option\b[^>]*value=["']([^"']*)["']/iu);
    if (selected) values.set(name, decodeHtml(selected[1]));
  }
  return values;
};

const parseFormValues = (html) => {
  const values = parseSelects(html);
  for (const match of html.matchAll(/<input\b([^>]*)>/giu)) {
    const attrs = match[1];
    const name = attrs.match(/\bname=["']([^"']+)["']/iu)?.[1];
    if (!name) continue;
    const type = (
      attrs.match(/\btype=["']([^"']+)["']/iu)?.[1] ?? "text"
    ).toLowerCase();
    if (
      (type === "checkbox" || type === "radio") &&
      !/\bchecked\b/iu.test(attrs)
    )
      continue;
    const value = attrs.match(/\bvalue=["']([^"']*)["']/iu)?.[1] ?? "";
    values.set(name, decodeHtml(value));
  }
  return values;
};

const categoryOptions = (html) => {
  const select =
    html.match(
      /<select\b[^>]*id=["']I7["'][^>]*>([\s\S]*?)<\/select>/iu,
    )?.[1] ?? "";
  return Array.from(
    select.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/giu),
    (match) => ({
      value: decodeHtml(
        match[1].match(/\bvalue=["']([^"']*)["']/iu)?.[1] ?? "",
      ),
      label: decodeHtml(match[2].replace(/<[^>]+>/gu, ""))
        .replace(/\s+/gu, " ")
        .trim(),
    }),
  );
};

const postForm = async (action, cookie, values) => {
  const body = new URLSearchParams();
  for (const [key, value] of values) body.set(key, value);
  const response = await fetch(action, {
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
  return {
    html: await response.text(),
    cookie: mergeCookies(cookie, cookieFrom(response)),
    ok: response.ok,
  };
};

const controls = (html) => {
  const result = [];
  for (const match of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/giu)) {
    const attrs = match[1];
    const id = attrs.match(/\bid=["']([^"']+)["']/iu)?.[1] ?? null;
    const text = decodeHtml(match[2].replace(/<[^>]+>/gu, " "))
      .replace(/\s+/gu, " ")
      .trim();
    if (id && /classement|afficher plus/iu.test(text)) result.push({ tag: "button", id, text });
  }
  for (const match of html.matchAll(/<input\b([^>]*)>/giu)) {
    const attrs = match[1];
    const id = attrs.match(/\bid=["']([^"']+)["']/iu)?.[1] ?? null;
    const value = decodeHtml(
      attrs.match(/\bvalue=["']([^"']*)["']/iu)?.[1] ?? "",
    );
    if (id && /classement/iu.test(value)) result.push({ tag: "input", id, text: value });
  }
  return result;
};

export default async function handler(request, response) {
  if (request.method !== "GET") return response.status(405).json({ error: "GET only" });
  try {
    const sourceUrl = new URL("https://lbpb.competition.ffpb.net?id_competition=7");
    const bootstrap = await fetch(sourceUrl, { redirect: "follow", headers: headersBase });
    const bootstrapHtml = await bootstrap.text();
    const cookie1 = cookieFrom(bootstrap);
    const pageUrl = /FFPB_COMPETITION/iu.test(bootstrapHtml)
      ? new URL(`/FFPB_COMPETITION/${sourceUrl.search}`, sourceUrl.origin)
      : sourceUrl;
    const page = await fetch(pageUrl, {
      redirect: "follow",
      headers: { ...headersBase, ...(cookie1 ? { cookie: cookie1 } : {}) },
    });
    const html = await page.text();
    const cookie = mergeCookies(cookie1, cookieFrom(page));
    const actionRaw = html.match(/<form[^>]*action=["']([^"']+)["']/iu)?.[1];
    if (!actionRaw) throw new Error("form action missing");
    const action = new URL(decodeHtml(actionRaw), pageUrl.origin);
    const option = categoryOptions(html).find((item) => /Senior 2.me S.rie/iu.test(item.label));
    if (!option) throw new Error("Senior 2 option missing");

    const values = parseFormValues(html);
    values.set("I7", option.value);
    values.set("WD_ACTION_", "");
    values.set("WD_BUTTON_CLICK_", "I54");
    const ranking = await postForm(action, cookie, values);

    const snippets = [];
    for (const pattern of ["Classement Général", "Classement Par poule", "Classement Général Final"]) {
      const index = ranking.html.indexOf(pattern);
      if (index >= 0) snippets.push(ranking.html.slice(Math.max(0, index - 500), index + 700));
    }

    return response.status(200).json({
      ok: ranking.ok,
      controls: controls(ranking.html),
      snippets,
    });
  } catch (error) {
    return response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}
