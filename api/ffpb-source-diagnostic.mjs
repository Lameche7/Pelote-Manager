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

const optionValue = (selects, id, label) =>
  selects
    .find((select) => select.id === id)
    ?.options.find((option) => option.label.toLowerCase() === label.toLowerCase())
    ?.value ?? null;

export default async function handler(request, response) {
  try {
    const raw = String(request.query?.url ?? "").trim();
    if (!raw) return response.status(400).json({ error: "missing url" });
    const source = new URL(raw);
    if (!ALLOWED_HOSTS.has(source.hostname)) return response.status(400).json({ error: "unsupported host" });

    const root = new URL("/FFPB_COMPETITION/", source.origin);
    const page = await fetch(root, { redirect: "follow", headers });
    const html = await page.text();
    const cookie = cookieFrom(page);
    const actionRaw = decodeHtml(
      html.match(/<form[^>]*action=["']([^"']+)["']/iu)?.[1] ?? "",
    );
    if (!page.ok || !actionRaw) return response.status(500).json({ error: "landing page unavailable" });
    const action = new URL(actionRaw, root.origin);
    const selects = parseSelects(html);
    const values = parseFormValues(html);
    const chosen = [
      ["A34", "2027"],
      ["A33", "CHAMPIONNAT HIVER"],
      ["A36", "4ème série"],
      ["A38", "Trinquet Paleta Pelote de Gomme Pleine"],
      ["A39", "Trinquet Paleta Pelote de Gomme Pleine"],
    ];
    for (const [id, label] of chosen) {
      const value = optionValue(selects, id, label);
      if (value) values.set(id, value);
    }
    values.set("WD_ACTION_", "");
    values.set("WD_BUTTON_CLICK_", "A32");

    const body = new URLSearchParams();
    for (const [key, value] of values) body.set(key, value);
    const result = await fetch(action, {
      method: "POST",
      redirect: "follow",
      headers: {
        ...headers,
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        ...(cookie ? { cookie } : {}),
        referer: root.toString(),
      },
      body,
    });
    const resultHtml = await result.text();
    const needle = "PELOTARI CLUB LOURDAIS 01";
    const index = resultHtml.indexOf(needle);
    const snippet = index >= 0 ? resultHtml.slice(Math.max(0, index - 5000), index + 9000) : "";

    return response.status(200).json({
      status: result.status,
      finalUrl: result.url,
      length: resultHtml.length,
      foundAt: index,
      snippet,
    });
  } catch (error) {
    return response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}
