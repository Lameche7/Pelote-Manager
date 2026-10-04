const ALLOWED_HOST = "lbpb.competition.ffpb.net";
const headersBase = {
  "user-agent": "PeloteManager/1.0 (+https://pelotemanager.fr)",
  accept: "text/html,application/xhtml+xml,*/*",
};

const fold = (value) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();

const decodeHtml = (value) =>
  String(value ?? "")
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&#(\d+);/gu, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/giu, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));

const cookieFrom = (response) => {
  const values = typeof response.headers.getSetCookie === "function"
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

const parseSelects = (html) => Array.from(
  html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/giu),
  (match) => {
    const attrs = match[1];
    return {
      id: attrs.match(/\bid=["']([^"']+)["']/iu)?.[1] ?? null,
      name: attrs.match(/\bname=["']([^"']+)["']/iu)?.[1] ?? null,
      options: Array.from(match[2].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/giu), (option) => ({
        value: decodeHtml(option[1].match(/\bvalue=["']([^"']*)["']/iu)?.[1] ?? ""),
        label: stripHtml(option[2]).join(" "),
        selected: /\bselected\b/iu.test(option[1]),
      })),
    };
  },
);

const parseFormValues = (html) => {
  const values = new Map();
  for (const select of parseSelects(html)) {
    const selected = select.options.find((option) => option.selected) ?? select.options[0];
    if (select.name && selected) values.set(select.name, selected.value);
  }
  for (const match of html.matchAll(/<input\b([^>]*)>/giu)) {
    const attrs = match[1];
    const name = attrs.match(/\bname=["']([^"']+)["']/iu)?.[1];
    if (!name) continue;
    values.set(name, decodeHtml(attrs.match(/\bvalue=["']([^"']*)["']/iu)?.[1] ?? ""));
  }
  return values;
};

const sessionFrom = (html, cookie, origin) => {
  const actionRaw = decodeHtml(html.match(/<form[^>]*action=["']([^"']+)["']/iu)?.[1] ?? "");
  if (!actionRaw) throw new Error("Formulaire FFPB introuvable");
  return { html, cookie, origin, action: new URL(actionRaw, origin) };
};

const openSession = async () => {
  const url = new URL("https://lbpb.competition.ffpb.net/FFPB_COMPETITION/");
  const response = await fetch(url, { redirect: "follow", headers: headersBase });
  const html = await response.text();
  if (!response.ok) throw new Error(`FFPB ${response.status}`);
  return sessionFrom(html, cookieFrom(response), url.origin);
};

const postForm = async (session, values) => {
  const body = new URLSearchParams();
  for (const [key, value] of values) body.set(key, value);
  const response = await fetch(session.action, {
    method: "POST",
    redirect: "follow",
    headers: {
      ...headersBase,
      "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
      ...(session.cookie ? { cookie: session.cookie } : {}),
      referer: session.action.toString(),
    },
    body,
  });
  const html = await response.text();
  return sessionFrom(html, mergeCookies(session.cookie, cookieFrom(response)), session.origin);
};

const selectOption = async (session, id, matcher) => {
  const select = parseSelects(session.html).find((item) => item.id === id);
  if (!select) throw new Error(`Sélecteur ${id} introuvable`);
  const option = select.options.find((item) => matcher(item.label));
  if (!option) throw new Error(`Option ${id} introuvable`);
  const values = parseFormValues(session.html);
  values.set(id, option.value);
  values.set("WD_ACTION_", "");
  values.set("WD_BUTTON_CLICK_", id);
  return postForm(session, values);
};

const describe = (html) => {
  const needle = "Quotas 2026-27";
  const quotaIndex = html.indexOf(needle);
  const quotaSnippets = quotaIndex >= 0
    ? [decodeHtml(html.slice(Math.max(0, quotaIndex - 5000), Math.min(html.length, quotaIndex + 5000)))]
    : [];
  const possibleFiles = Array.from(
    html.matchAll(/[^"'\s<>]+\.(?:pdf|xlsx?|ods|csv)(?:\?[^"'\s<>]*)?/giu),
    (match) => decodeHtml(match[0]),
  );
  const relevantInputs = Array.from(html.matchAll(/<input\b([^>]*)>/giu), (match) => {
    const attrs = match[1];
    return {
      id: attrs.match(/\bid=["']([^"']+)["']/iu)?.[1] ?? null,
      name: attrs.match(/\bname=["']([^"']+)["']/iu)?.[1] ?? null,
      value: decodeHtml(attrs.match(/\bvalue=["']([^"']*)["']/iu)?.[1] ?? ""),
      type: attrs.match(/\btype=["']([^"']+)["']/iu)?.[1] ?? null,
    };
  }).filter((item) => /quota|fich|pj|info|doc|attach|a2[0-9]/iu.test(`${item.id} ${item.name} ${item.value}`));

  return {
    lines: stripHtml(html).slice(0, 700),
    quotaSnippets,
    possibleFiles,
    relevantInputs,
    buttons: Array.from(html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/giu), (match) => ({
      id: match[1].match(/\bid=["']([^"']+)["']/iu)?.[1] ?? null,
      name: match[1].match(/\bname=["']([^"']+)["']/iu)?.[1] ?? null,
      onclick: decodeHtml(match[1].match(/\bonclick=["']([^"']+)["']/iu)?.[1] ?? ""),
      text: stripHtml(match[2]).join(" "),
    })).filter((item) => item.text),
    selects: parseSelects(html).map((item) => ({
      id: item.id,
      selected: item.options.find((option) => option.selected)?.label ?? null,
      options: item.options.map((option) => option.label).slice(0, 50),
    })),
  };
};

export default async function handler(request, response) {
  try {
    const season = String(request.query.season ?? "2027");
    const competition = String(request.query.competition ?? "CHAMPIONNAT HIVER 2027");
    let session = await openSession();
    session = await selectOption(session, "A34", (label) => fold(label) === fold(season));
    session = await selectOption(session, "A33", (label) => {
      const item = fold(label);
      const target = fold(competition);
      return item !== "toutes" && (item === target || target.includes(item));
    });
    return response.status(200).json(describe(session.html));
  } catch (error) {
    return response.status(500).json({
      error: error instanceof Error ? error.message : "Erreur inconnue",
    });
  }
}
