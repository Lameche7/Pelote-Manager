const ALLOWED_HOSTS = new Set([
  "lbpb.competition.ffpb.net",
]);

const normalizeSourceUrl = (value) => {
  const raw = String(value ?? "").trim();
  if (!raw) throw new Error("Source URL manquante");
  const url = new URL(/^https?:\/\//iu.test(raw) ? raw : `https://${raw}`);
  if (!ALLOWED_HOSTS.has(url.hostname)) {
    throw new Error("Source non autorisée");
  }
  return url;
};

const federationHeaders = {
  "user-agent": "PeloteManager/1.0 (+https://pelote-manager.vercel.app)",
  accept: "text/html,application/xhtml+xml",
};

const fetchFederationPage = async (sourceUrl) => {
  let upstream = await fetch(sourceUrl, {
    redirect: "follow",
    headers: federationHeaders,
  });
  let html = await upstream.text();

  if (/FFPB_COMPETITION/iu.test(html) && !sourceUrl.pathname.includes("FFPB_COMPETITION")) {
    const redirectedUrl = new URL("/FFPB_COMPETITION/", sourceUrl.origin);
    redirectedUrl.search = sourceUrl.search;
    upstream = await fetch(redirectedUrl, {
      redirect: "follow",
      headers: federationHeaders,
    });
    html = await upstream.text();
  }

  return { upstream, html };
};

const matches = (html, regexp) =>
  Array.from(html.matchAll(regexp), (match) => match[1]).filter(Boolean);

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "Method not allowed" });
  }

  try {
    const sourceUrl = normalizeSourceUrl(request.query?.url);
    const { upstream, html } = await fetchFederationPage(sourceUrl);
    const selectI7 = html.match(/<select[^>]*id=["']I7["'][\s\S]*?<\/select>/iu)?.[0] ?? null;
    const selectedI7 = selectI7?.match(/<option[^>]*selected[^>]*value=["']([^"']+)["'][^>]*data-wb-valmem=["']([^"']*)["'][^>]*>([^<]+)<\/option>/iu) ?? null;
    const formAction = html.match(/<form[^>]*action=["']([^"']*)["']/iu)?.[1] ?? null;
    const hiddenInputs = Array.from(
      html.matchAll(/<input[^>]*type=["']hidden["'][^>]*name=["']([^"']+)["'][^>]*value=["']([^"']*)["'][^>]*>/giu),
      (match) => ({ name: match[1], value: match[2] }),
    ).slice(0, 80);
    const scripts = matches(html, /<script[^>]*src=["']([^"']+)["']/giu).slice(0, 80);
    const contexts = matches(html, /WD_CONTEXTE_\s*[:=]\s*["']([^"']+)["']/giu).slice(0, 20);
    const ajaxTokens = Array.from(
      new Set(matches(html, /WD_ACTION_|AJAXPAGE|AJAXEXECUTE|WD_CONTEXTE_|EXECUTE/giu)),
    );

    return response.status(200).json({
      ok: upstream.ok,
      status: upstream.status,
      finalUrl: upstream.url,
      length: html.length,
      formAction,
      selectedI7: selectedI7
        ? { value: selectedI7[1], memory: selectedI7[2], label: selectedI7[3] }
        : null,
      hiddenInputs,
      scripts,
      contexts,
      ajaxTokens,
      hasLescar: html.includes("LESCAR PELOTARI CLUB"),
      hasBillere: html.includes("BILLERE PELOTARI CLUB"),
      i7Snippet: selectI7,
    });
  } catch (error) {
    return response.status(400).json({
      error: error instanceof Error ? error.message : "Probe impossible",
    });
  }
}
