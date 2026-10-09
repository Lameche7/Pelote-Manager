import crypto from "node:crypto";

const ALLOWED_HOSTS = new Set(["lbpb.competition.ffpb.net"]);

const headersBase = {
  "user-agent": "PeloteManager/1.0 (+https://pelote-manager.vercel.app)",
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
    .replace(/&#x([0-9a-f]+);/giu, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    );

const stripTags = (value) =>
  decodeHtml(String(value ?? "").replace(/<[^>]+>/gu, " "))
    .replace(/\s+/gu, " ")
    .trim();

const escapeRegex = (value) =>
  String(value).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

const normalizeSourceUrl = (value) => {
  const raw = String(value ?? "").trim();
  if (!raw) throw new Error("La source officielle du championnat est absente.");
  const url = new URL(/^https?:\/\//iu.test(raw) ? raw : `https://${raw}`);
  if (!ALLOWED_HOSTS.has(url.hostname)) {
    throw new Error("Cette source officielle n’est pas prise en charge.");
  }
  return url;
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
    if (
      (type === "checkbox" || type === "radio") &&
      !/\bchecked\b/iu.test(attrs)
    ) {
      continue;
    }
    values.set(
      name,
      decodeHtml(attrs.match(/\bvalue=["']([^"']*)["']/iu)?.[1] ?? ""),
    );
  }
  return values;
};

const sessionFrom = (html, cookie, origin) => {
  const actionRaw = decodeHtml(
    html.match(/<form[^>]*action=["']([^"']+)["']/iu)?.[1] ?? "",
  );
  if (!actionRaw) {
    throw new Error("Le formulaire de recherche FFPB n’a pas été reconnu.");
  }
  return {
    html,
    cookie,
    origin,
    action: new URL(actionRaw, origin),
  };
};

const openPublicSession = async (sourceUrl) => {
  const root = new URL("/FFPB_COMPETITION/", sourceUrl.origin);
  const response = await fetch(root, {
    redirect: "follow",
    headers: headersBase,
  });
  const html = await response.text();
  if (!response.ok || !/<form\b/iu.test(html)) {
    throw new Error("La page publique FFPB n’a pas pu être lue.");
  }
  return sessionFrom(html, cookieFrom(response), root.origin);
};

const optionValue = (html, id, expectedLabel) => {
  const target = fold(expectedLabel);
  const select = parseSelects(html).find((item) => item.id === id);
  if (!select) return null;
  return (
    select.options.find((option) => fold(option.label) === target)?.value ??
    null
  );
};

const optionValueFlexible = (html, id, expectedLabel) => {
  const exact = optionValue(html, id, expectedLabel);
  if (exact) return exact;
  const target = fold(expectedLabel)
    .replace(/\bmasculin\b/gu, "")
    .replace(/\bfeminin\b/gu, "feminine")
    .replace(/\s+/gu, " ")
    .trim();
  const select = parseSelects(html).find((item) => item.id === id);
  if (!select) return null;
  return (
    select.options.find((option) => {
      const label = fold(option.label);
      return label === target || label.replace(/\s+/gu, " ").trim() === target;
    })?.value ?? null
  );
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
  if (!response.ok) {
    throw new Error("La FFPB n’a pas répondu correctement.");
  }
  return sessionFrom(
    html,
    mergeCookies(session.cookie, cookieFrom(response)),
    session.origin,
  );
};

const selectOption = async (session, fieldId, label, flexible = false) => {
  const value = flexible
    ? optionValueFlexible(session.html, fieldId, label)
    : optionValue(session.html, fieldId, label);
  if (!value) {
    throw new Error(`Option FFPB introuvable : ${label}.`);
  }
  const values = parseFormValues(session.html);
  values.set(fieldId, value);
  values.set("WD_ACTION_", "");
  values.set("WD_BUTTON_CLICK_", fieldId);
  return postForm(session, values);
};

const visibleShowMoreButtonIds = (html) =>
  Array.from(
    html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/giu),
    (match) => {
      const attrs = match[1];
      const text = stripTags(match[2]);
      return {
        id: attrs.match(/\bid=["']([^"']+)["']/iu)?.[1] ?? null,
        hidden: /visibility\s*:\s*hidden/iu.test(attrs),
        disabled: /\bdisabled\b/iu.test(attrs),
        text,
      };
    },
  )
    .filter(
      (button) =>
        button.id &&
        !button.hidden &&
        !button.disabled &&
        /^Afficher plus/iu.test(button.text),
    )
    .map((button) => button.id);

const rowCount = (html) =>
  new Set(
    Array.from(html.matchAll(/id=["']I158_(\d+)["']/giu), (match) => match[1]),
  ).size;

const declaredMatchCount = (html) => {
  const match = stripTags(
    html.match(/>\s*(\d+)\s+rencontres\s*</iu)?.[0] ?? "",
  ).match(/(\d+)/u);
  return match ? Number(match[1]) : null;
};

const expandAllRows = async (initialSession) => {
  let session = initialSession;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const declared = declaredMatchCount(session.html);
    const current = rowCount(session.html);
    if (declared !== null && current >= declared) break;
    const buttonId = visibleShowMoreButtonIds(session.html)[0];
    if (!buttonId) break;
    const values = parseFormValues(session.html);
    values.set("WD_ACTION_", "");
    values.set("WD_BUTTON_CLICK_", buttonId);
    session = await postForm(session, values);
  }
  return session;
};

const searchDivision = async ({
  sourceUrl,
  seasonLabel,
  competitionName,
  specialty,
  divisionName,
}) => {
  let session = await openPublicSession(sourceUrl);
  session = await selectOption(session, "A34", seasonLabel);

  const competitionOptions =
    parseSelects(session.html).find((item) => item.id === "A33")?.options ?? [];
  const foldedName = fold(competitionName);
  const competitionOption = competitionOptions.find(
    (option) =>
      fold(option.label) !== "toutes" &&
      foldedName.includes(fold(option.label)),
  );
  if (!competitionOption) {
    throw new Error("Le type de championnat FFPB n’a pas été reconnu.");
  }
  {
    const values = parseFormValues(session.html);
    values.set("A33", competitionOption.value);
    values.set("WD_ACTION_", "");
    values.set("WD_BUTTON_CLICK_", "A33");
    session = await postForm(session, values);
  }

  session = await selectOption(session, "A36", divisionName);
  session = await selectOption(session, "A38", specialty, true);

  const searchValues = parseFormValues(session.html);
  searchValues.set("WD_ACTION_", "");
  searchValues.set("WD_BUTTON_CLICK_", "A32");
  session = await postForm(session, searchValues);
  session = await expandAllRows(session);
  return session.html;
};

const fieldHtml = (html, row, attributeId) => {
  const id = `zrl_${row}_ATT_${attributeId}_1`;
  const pattern = new RegExp(
    `<div[^>]*id=["']${escapeRegex(id)}["'][^>]*>([\\s\\S]*?)<\\/div>`,
    "iu",
  );
  return html.match(pattern)?.[1] ?? "";
};

const fieldText = (html, row, attributeId) =>
  stripTags(fieldHtml(html, row, attributeId));

const teamLabel = (html, row, attributeId) => {
  const source = fieldHtml(html, row, attributeId);
  const bold = source.match(/<b>([\s\S]*?)<\/b>/iu)?.[1];
  return stripTags(bold ?? source);
};

const parseDate = (value) => {
  const match = String(value ?? "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/u);
  if (!match) return null;
  return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
};

const parseTeam = (label) => {
  const match = String(label ?? "")
    .trim()
    .match(/^(.*\S)\s+(\d{1,3})$/u);
  if (!match) return null;
  return { clubName: match[1].trim(), teamNumber: match[2] };
};

const parseScore = (value) => {
  const raw = String(value ?? "")
    .replace(/\s+/gu, " ")
    .trim();
  if (!raw) return null;
  const match = raw.match(/(\d{1,3})\s*(?:\/|-|–|—)\s*(\d{1,3})/u);
  if (!match) return null;
  const scoreTeam1 = Number(match[1]);
  const scoreTeam2 = Number(match[2]);
  if (!Number.isInteger(scoreTeam1) || !Number.isInteger(scoreTeam2))
    return null;
  if (scoreTeam1 === scoreTeam2) return null;
  return {
    scoreRaw: `${scoreTeam1}-${scoreTeam2}`,
    scoreTeam1,
    scoreTeam2,
  };
};

const parseDivisionResults = (html, divisionName) => {
  const rows = Array.from(
    new Set(
      Array.from(html.matchAll(/id=["']I158_(\d+)["']/giu), (match) =>
        Number(match[1]),
      ),
    ),
  ).sort((a, b) => a - b);

  const results = [];
  for (const row of rows) {
    const firstLabel = teamLabel(html, row, "I165");
    const secondLabel = teamLabel(html, row, "I167");
    const team1 = parseTeam(firstLabel);
    const team2 = parseTeam(secondLabel);
    if (!team1 || !team2) continue;
    const score = parseScore(fieldText(html, row, "I168"));
    if (!score) continue;
    results.push({
      division: divisionName,
      phase: "Poules",
      poolCode:
        fieldText(html, row, "I220")
          .replace(/^Poule\s+/iu, "")
          .trim() || null,
      sourceDate: parseDate(fieldText(html, row, "I163")),
      team1Label: firstLabel,
      team2Label: secondLabel,
      team1,
      team2,
      ...score,
      sourceInfo: fieldText(html, row, "I222") || null,
    });
  }
  return {
    declaredCount: declaredMatchCount(html),
    loadedCount: rows.length,
    results,
  };
};

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("allow", "POST");
    return response.status(405).json({ error: "Méthode non autorisée." });
  }

  try {
    const body = request.body ?? {};
    const sourceUrl = normalizeSourceUrl(body.sourceUrl);
    const seasonLabel = String(body.seasonLabel ?? "").trim();
    const competitionName = String(body.competitionName ?? "").trim();
    const specialty = String(body.specialty ?? "").trim();
    const divisions = Array.isArray(body.divisions)
      ? body.divisions
          .map((item) => ({ name: String(item?.name ?? "").trim() }))
          .filter((item) => item.name)
      : [];

    if (
      !seasonLabel ||
      !competitionName ||
      !specialty ||
      divisions.length === 0
    ) {
      return response.status(400).json({
        error: "Les informations du championnat sont incomplètes.",
      });
    }

    const allResults = [];
    const divisionSummary = [];
    const warnings = [];
    for (const division of divisions) {
      try {
        const html = await searchDivision({
          sourceUrl,
          seasonLabel,
          competitionName,
          specialty,
          divisionName: division.name,
        });
        const parsed = parseDivisionResults(html, division.name);
        allResults.push(...parsed.results);
        divisionSummary.push({
          division: division.name,
          declaredCount: parsed.declaredCount,
          loadedCount: parsed.loadedCount,
          resultCount: parsed.results.length,
        });
        if (
          parsed.declaredCount !== null &&
          parsed.loadedCount < parsed.declaredCount
        ) {
          warnings.push(
            `${division.name} : ${parsed.loadedCount}/${parsed.declaredCount} rencontres ont été lues.`,
          );
        }
      } catch (cause) {
        warnings.push(
          `${division.name} : ${cause instanceof Error ? cause.message : "lecture impossible"}`,
        );
      }
    }

    const snapshot = JSON.stringify(
      allResults
        .map((item) => ({
          division: item.division,
          team1: item.team1Label,
          team2: item.team2Label,
          score: item.scoreRaw,
          date: item.sourceDate,
        }))
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    );
    const checksum = crypto.createHash("sha256").update(snapshot).digest("hex");

    return response.status(200).json({
      source: "ffpb-public-search",
      checkedAt: new Date().toISOString(),
      checksum,
      summary: {
        divisionCount: divisions.length,
        officialResultCount: allResults.length,
      },
      divisions: divisionSummary,
      results: allResults,
      warnings,
    });
  } catch (cause) {
    return response.status(500).json({
      error:
        cause instanceof Error
          ? cause.message
          : "Impossible de lire les résultats officiels FFPB.",
    });
  }
}
