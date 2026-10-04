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
              value: decodeHtml(
                optionAttrs.match(/\bvalue=["']([^"']*)["']/iu)?.[1] ?? "",
              ),
              label: stripTags(optionMatch[2]),
              selected: /\bselected\b/iu.test(optionAttrs),
            };
          },
        ),
      };
    },
  );

const parseFormValues = (html) => {
  const values = new Map();
  for (const select of parseSelects(html)) {
    const selected =
      select.options.find((option) => option.selected) ?? select.options[0];
    if (select.name && selected) values.set(select.name, selected.value);
  }
  for (const match of html.matchAll(/<input\b([^>]*)>/giu)) {
    const attrs = match[1];
    const name = attrs.match(/\bname=["']([^"']+)["']/iu)?.[1];
    if (!name) continue;
    const type = (
      attrs.match(/\btype=["']([^"']+)["']/iu)?.[1] ?? "text"
    ).toLowerCase();
    if ((type === "checkbox" || type === "radio") && !/\bchecked\b/iu.test(attrs)) continue;
    values.set(
      name,
      decodeHtml(attrs.match(/\bvalue=["']([^"']*)["']/iu)?.[1] ?? ""),
    );
  }
  return values;
};

const optionValue = (html, id, label) =>
  parseSelects(html)
    .find((select) => select.id === id)
    ?.options.find((option) => option.label.toLowerCase() === label.toLowerCase())
    ?.value ?? null;

const selectedLabel = (html, id) =>
  parseSelects(html)
    .find((select) => select.id === id)
    ?.options.find((option) => option.selected)?.label ?? null;

const sessionFrom = (html, cookie, origin) => {
  const actionRaw = decodeHtml(
    html.match(/<form[^>]*action=["']([^"']+)["']/iu)?.[1] ?? "",
  );
  if (!actionRaw) throw new Error("FFPB form action missing");
  return { html, cookie, origin, action: new URL(actionRaw, origin) };
};

const post = async (session, fieldId, fieldValue, buttonId) => {
  const values = parseFormValues(session.html);
  if (fieldId && fieldValue) values.set(fieldId, fieldValue);
  values.set("WD_ACTION_", "");
  values.set("WD_BUTTON_CLICK_", buttonId);
  const body = new URLSearchParams();
  for (const [key, value] of values) body.set(key, value);
  const result = await fetch(session.action, {
    method: "POST",
    redirect: "follow",
    headers: {
      ...headers,
      "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
      ...(session.cookie ? { cookie: session.cookie } : {}),
      referer: session.action.toString(),
    },
    body,
  });
  const html = await result.text();
  return {
    ...sessionFrom(html, mergeCookies(session.cookie, cookieFrom(result)), session.origin),
    status: result.status,
    url: result.url,
  };
};

export default async function handler(request, response) {
  try {
    const raw = String(request.query?.url ?? "").trim();
    if (!raw) return response.status(400).json({ error: "missing url" });
    const source = new URL(raw);
    if (!ALLOWED_HOSTS.has(source.hostname)) return response.status(400).json({ error: "unsupported host" });

    const root = new URL("/FFPB_COMPETITION/", source.origin);
    const landing = await fetch(root, { redirect: "follow", headers });
    const landingHtml = await landing.text();
    let session = sessionFrom(landingHtml, cookieFrom(landing), root.origin);
    const trace = [];

    for (const [id, label] of [
      ["A34", "2027"],
      ["A33", "CHAMPIONNAT HIVER"],
      ["A36", "4ème série"],
      ["A38", "Trinquet Paleta Pelote de Gomme Pleine"],
    ]) {
      const value = optionValue(session.html, id, label);
      if (!value) throw new Error(`Option ${label} missing in ${id}`);
      session = await post(session, id, value, id);
      trace.push({
        id,
        wanted: label,
        selected: selectedLabel(session.html, id),
        length: session.html.length,
      });
    }

    session = await post(session, null, null, "A32");
    const countText = stripTags(
      session.html.match(/>\s*(\d+)\s+rencontres\s*</iu)?.[0] ?? "",
    );
    const firstCategory = Array.from(
      session.html.matchAll(/>(1ère série|2ème série|3ème série|4ème série)</giu),
      (match) => match[1],
    ).slice(0, 10);
    const rowCount = Array.from(session.html.matchAll(/id=["']I158_\d+["']/giu)).length;

    return response.status(200).json({
      trace,
      search: {
        status: session.status,
        finalUrl: session.url,
        countText,
        rowCount,
        selected: {
          year: selectedLabel(session.html, "A34"),
          competition: selectedLabel(session.html, "A33"),
          category: selectedLabel(session.html, "A36"),
          specialty: selectedLabel(session.html, "A38"),
        },
        categoryMentions: firstCategory,
      },
    });
  } catch (error) {
    return response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}
