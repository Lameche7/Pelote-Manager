const HOST = "lbpb.competition.ffpb.net";
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

const fold = (value) => String(value ?? "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/gu, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/gu, " ")
  .trim();

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

const normalizeSource = (raw) => {
  const url = new URL(/^https?:\/\//iu.test(raw) ? raw : `https://${raw}`);
  if (url.hostname !== HOST) throw new Error("host not allowed");
  return url;
};

const categoryOptions = (html) => {
  const select = html.match(/<select\b[^>]*id=["']I7["'][^>]*>([\s\S]*?)<\/select>/iu)?.[1] ?? "";
  return Array.from(select.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/giu), (match) => {
    const attrs = match[1];
    return {
      value: decodeHtml(attrs.match(/\bvalue=["']([^"']*)["']/iu)?.[1] ?? ""),
      memory: decodeHtml(attrs.match(/\bdata-wb-valmem=["']([^"']*)["']/iu)?.[1] ?? ""),
      label: decodeHtml(match[2].replace(/<[^>]+>/gu, "")).replace(/\s+/gu, " ").trim(),
      selected: /\bselected\b/iu.test(attrs),
    };
  });
};

const selectedCategory = (html) => categoryOptions(html).find((item) => item.selected)?.label ?? null;

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

const describeHtml = (html) => {
  const compact = html.replace(/\s+/gu, " ");
  const marker = (needle) => compact.includes(needle);
  const around = (needle, radius = 500) => {
    const i = compact.indexOf(needle);
    return i < 0 ? null : compact.slice(Math.max(0, i - radius), Math.min(compact.length, i + radius));
  };
  return {
    length: html.length,
    selectedCategory: selectedCategory(html),
    hasForm: /<form/iu.test(html),
    hasI7: /id=["']I7["']/iu.test(html),
    hasI54: /id=["']I54["']/iu.test(html),
    markers: {
      Poule: marker("Poule 1"),
      Classement: marker("Classement"),
      Vic: marker("Vic."),
      Def: marker("Déf."),
      Perd: marker("Perd."),
      PointsPartie: marker("Points / partie"),
      Lourdes02: marker("PELOTARI CLUB LOURDAIS 02"),
    },
    aroundClassement: around("Classement"),
    aroundPoule: around("Poule 1"),
  };
};

const post = async (action, cookie, values) => {
  const body = new URLSearchParams();
  for (const [k, v] of values) body.set(k, v);
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
  const html = await response.text();
  return {
    response,
    html,
    cookie: mergeCookies(cookie, cookieFrom(response)),
  };
};

export default async function handler(request, response) {
  if (request.method !== "GET") return response.status(405).json({ error: "GET only" });
  try {
    const source = normalizeSource(String(request.query?.source ?? "lbpb.competition.ffpb.net?id_competition=7"));
    const division = String(request.query?.division ?? "Senior 1ère Série");

    const bootstrap = await fetch(source, { redirect: "follow", headers: headersBase });
    const bootstrapHtml = await bootstrap.text();
    const cookie1 = cookieFrom(bootstrap);
    const pageUrl = /FFPB_COMPETITION/iu.test(bootstrapHtml) && !source.pathname.includes("FFPB_COMPETITION")
      ? new URL(`/FFPB_COMPETITION/${source.search}`, source.origin)
      : source;
    const page = await fetch(pageUrl, {
      redirect: "follow",
      headers: { ...headersBase, ...(cookie1 ? { cookie: cookie1 } : {}) },
    });
    const html = await page.text();
    const cookie = mergeCookies(cookie1, cookieFrom(page));
    const actionRaw = html.match(/<form[^>]*action=["']([^"']+)["']/iu)?.[1];
    if (!actionRaw) throw new Error("form action missing");
    const action = new URL(decodeHtml(actionRaw), pageUrl.origin);
    const options = categoryOptions(html);
    const option = options.find((item) => fold(item.label) === fold(division));
    if (!option) return response.status(404).json({ division, options });

    const initial = describeHtml(html);

    const directValues = formValues(html);
    directValues.set("I7", option.value);
    directValues.set("WD_ACTION_", "");
    directValues.set("WD_BUTTON_CLICK_", "I54");
    const direct = await post(action, cookie, directValues);

    const changeValues = formValues(html);
    changeValues.set("I7", option.value);
    changeValues.set("WD_ACTION_", "");
    changeValues.set("WD_BUTTON_CLICK_", "I7");
    const changed = await post(action, cookie, changeValues);

    let ranking = null;
    if (/<form/iu.test(changed.html)) {
      const changedActionRaw = changed.html.match(/<form[^>]*action=["']([^"']+)["']/iu)?.[1];
      const changedAction = changedActionRaw ? new URL(decodeHtml(changedActionRaw), pageUrl.origin) : action;
      const rankingValues = formValues(changed.html);
      rankingValues.set("WD_ACTION_", "");
      rankingValues.set("WD_BUTTON_CLICK_", "I54");
      ranking = await post(changedAction, changed.cookie, rankingValues);
    }

    return response.status(200).json({
      source: source.toString(),
      pageUrl: pageUrl.toString(),
      action: action.toString(),
      division,
      option,
      initial,
      direct: {
        status: direct.response.status,
        url: direct.response.url,
        contentType: direct.response.headers.get("content-type"),
        ...describeHtml(direct.html),
        start: direct.html.slice(0, 800),
      },
      changed: {
        status: changed.response.status,
        url: changed.response.url,
        contentType: changed.response.headers.get("content-type"),
        ...describeHtml(changed.html),
        start: changed.html.slice(0, 800),
      },
      ranking: ranking ? {
        status: ranking.response.status,
        url: ranking.response.url,
        contentType: ranking.response.headers.get("content-type"),
        ...describeHtml(ranking.html),
        start: ranking.html.slice(0, 800),
      } : null,
    });
  } catch (error) {
    return response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}
