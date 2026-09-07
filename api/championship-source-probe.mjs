const ALLOWED_HOSTS = new Set(["lbpb.competition.ffpb.net"]);
const baseHeaders = {
  "user-agent": "PeloteManager/1.0 (+https://pelote-manager.vercel.app)",
  accept: "text/html,application/xhtml+xml,*/*",
};

const normalizeSourceUrl = (value) => {
  const raw = String(value ?? "").trim();
  if (!raw) throw new Error("Source URL manquante");
  const url = new URL(/^https?:\/\//iu.test(raw) ? raw : `https://${raw}`);
  if (!ALLOWED_HOSTS.has(url.hostname)) throw new Error("Source non autorisée");
  return url;
};

const cookieFrom = (response) => {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);
  return values.map((value) => String(value).split(";", 1)[0]).join("; ");
};

const openSession = async (sourceUrl) => {
  const bootstrap = await fetch(sourceUrl, { redirect: "follow", headers: baseHeaders });
  const bootstrapHtml = await bootstrap.text();
  const firstCookie = cookieFrom(bootstrap);
  const pageUrl = /FFPB_COMPETITION/iu.test(bootstrapHtml) && !sourceUrl.pathname.includes("FFPB_COMPETITION")
    ? new URL(`/FFPB_COMPETITION/${sourceUrl.search}`, sourceUrl.origin)
    : sourceUrl;
  const page = await fetch(pageUrl, {
    redirect: "follow",
    headers: { ...baseHeaders, ...(firstCookie ? { cookie: firstCookie } : {}) },
  });
  const html = await page.text();
  const cookie = [firstCookie, cookieFrom(page)].filter(Boolean).join("; ");
  const action = html.match(/<form[^>]*action=["']([^"']+)["']/iu)?.[1];
  if (!action) throw new Error("Formulaire WebDev introuvable");
  return { html, cookie, action: new URL(action, pageUrl.origin) };
};

const selectedDivision = (text) => {
  const select = text.match(/<select[^>]*id=["']I7["'][\s\S]*?<\/select>/iu)?.[0] ?? "";
  return select.match(/<option[^>]*selected[^>]*>([^<]+)<\/option>/iu)?.[1] ?? null;
};

const describe = async (response) => {
  const text = await response.text();
  return {
    status: response.status,
    type: response.headers.get("content-type"),
    length: text.length,
    selectedDivision: selectedDivision(text),
    hasLescar: text.includes("LESCAR PELOTARI CLUB"),
    hasBillere: text.includes("BILLERE PELOTARI CLUB"),
    start: text.slice(0, 600),
  };
};

const trial = async (sourceUrl, params) => {
  const session = await openSession(sourceUrl);
  const body = new URLSearchParams(params);
  const result = await fetch(session.action, {
    method: "POST",
    redirect: "follow",
    headers: {
      ...baseHeaders,
      "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
      ...(session.cookie ? { cookie: session.cookie } : {}),
      referer: session.action.toString(),
      "x-requested-with": "XMLHttpRequest",
    },
    body,
  });
  return describe(result);
};

export default async function handler(request, response) {
  if (request.method !== "GET") return response.status(405).json({ error: "Method not allowed" });
  try {
    const sourceUrl = normalizeSourceUrl(request.query?.url);
    const trials = {};
    trials.normal = await trial(sourceUrl, {
      WD_ACTION_: "",
      WD_BUTTON_CLICK_: "I7",
      I7: "12",
    });
    trials.ajaxNoContext = await trial(sourceUrl, {
      WD_ACTION_: "AJAXPAGE",
      EXECUTE: "11",
      WD_BUTTON_CLICK_: "",
      I7: "12",
    });
    trials.ajaxA1 = await trial(sourceUrl, {
      WD_ACTION_: "AJAXPAGE",
      EXECUTE: "11",
      WD_CONTEXTE_: "A1",
      WD_BUTTON_CLICK_: "",
      I7: "12",
    });
    trials.ajaxA2 = await trial(sourceUrl, {
      WD_ACTION_: "AJAXPAGE",
      EXECUTE: "11",
      WD_CONTEXTE_: "A2",
      WD_BUTTON_CLICK_: "",
      I7: "12",
    });
    return response.status(200).json({ trials });
  } catch (error) {
    return response.status(400).json({ error: error instanceof Error ? error.message : "Probe impossible" });
  }
}
