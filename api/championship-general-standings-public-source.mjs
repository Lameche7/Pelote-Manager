const ALLOWED_HOSTS = new Set(["lbpb.competition.ffpb.net"]);
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
    .replace(/&#x([0-9a-f]+);/giu, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    );
const stripTags = (value) =>
  decodeHtml(String(value ?? "").replace(/<[^>]+>/gu, " "))
    .replace(/\s+/gu, " ")
    .trim();
const normalizeSourceUrl = (value) => {
  const raw = String(value ?? "").trim();
  if (!raw) throw new Error("La source officielle du championnat est absente.");
  const url = new URL(/^https?:\/\//iu.test(raw) ? raw : `https://${raw}`);
  if (!ALLOWED_HOSTS.has(url.hostname))
    throw new Error("Cette source officielle n’est pas prise en charge.");
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
      const i = part.indexOf("=");
      if (i > 0) values.set(part.slice(0, i), part.slice(i + 1));
    }
  }
  return Array.from(values, ([key, value]) => `${key}=${value}`).join("; ");
};
const parseSelects = (html) =>
  Array.from(
    html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/giu),
    (match) => {
      const attrs = match[1];
      return {
        id: attrs.match(/\bid=["']([^"']+)["']/iu)?.[1] ?? null,
        name: attrs.match(/\bname=["']([^"']+)["']/iu)?.[1] ?? null,
        options: Array.from(
          match[2].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/giu),
          (option) => ({
            value: decodeHtml(
              option[1].match(/\bvalue=["']([^"']*)["']/iu)?.[1] ?? "",
            ),
            label: stripTags(option[2]),
            selected: /\bselected\b/iu.test(option[1]),
          }),
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
    const attrs = match[1],
      name = attrs.match(/\bname=["']([^"']+)["']/iu)?.[1];
    if (!name) continue;
    const type = (
      attrs.match(/\btype=["']([^"']+)["']/iu)?.[1] ?? "text"
    ).toLowerCase();
    if (
      (type === "checkbox" || type === "radio") &&
      !/\bchecked\b/iu.test(attrs)
    )
      continue;
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
  if (!actionRaw)
    throw new Error("Le formulaire de recherche FFPB n’a pas été reconnu.");
  return { html, cookie, origin, action: new URL(actionRaw, origin) };
};
const openPublicSession = async (sourceUrl) => {
  const root = new URL("/FFPB_COMPETITION/", sourceUrl.origin);
  const response = await fetch(root, {
    redirect: "follow",
    headers: headersBase,
  });
  const html = await response.text();
  if (!response.ok || !/<form\b/iu.test(html))
    throw new Error("La page publique FFPB n’a pas pu être lue.");
  return sessionFrom(html, cookieFrom(response), root.origin);
};
const optionValue = (html, id, label) => {
  const target = fold(label),
    select = parseSelects(html).find((item) => item.id === id);
  return (
    select?.options.find((option) => fold(option.label) === target)?.value ??
    null
  );
};
const optionValueFlexible = (html, id, label) => {
  const exact = optionValue(html, id, label);
  if (exact) return exact;
  const target = fold(label)
    .replace(/\bmasculin\b/gu, "")
    .replace(/\bfeminin\b/gu, "feminine")
    .replace(/\s+/gu, " ")
    .trim();
  const select = parseSelects(html).find((item) => item.id === id);
  return (
    select?.options.find(
      (option) => fold(option.label).replace(/\s+/gu, " ").trim() === target,
    )?.value ?? null
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
  if (!response.ok) throw new Error("La FFPB n’a pas répondu correctement.");
  return sessionFrom(
    html,
    mergeCookies(session.cookie, cookieFrom(response)),
    session.origin,
  );
};
const selectOption = async (session, id, label, flexible = false) => {
  const value = flexible
    ? optionValueFlexible(session.html, id, label)
    : optionValue(session.html, id, label);
  if (!value) throw new Error(`Option FFPB introuvable : ${label}.`);
  const values = parseFormValues(session.html);
  values.set(id, value);
  values.set("WD_ACTION_", "");
  values.set("WD_BUTTON_CLICK_", id);
  return postForm(session, values);
};
const buttonIdByText = (html, text) => {
  const target = fold(text);
  return (
    Array.from(
      html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/giu),
      (match) => ({
        id: match[1].match(/\bid=["']([^"']+)["']/iu)?.[1] ?? null,
        hidden: /visibility\s*:\s*hidden/iu.test(match[1]),
        disabled: /\bdisabled\b/iu.test(match[1]),
        text: stripTags(match[2]),
      }),
    ).find(
      (button) =>
        button.id &&
        !button.hidden &&
        !button.disabled &&
        fold(button.text) === target,
    )?.id ?? null
  );
};
const incompleteLineCounters = (html) =>
  Array.from(html.matchAll(/>(\d+)\s*\/\s*(\d+)\s+lignes</giu), (match) => ({
    shown: Number(match[1]),
    total: Number(match[2]),
  })).filter((counter) => counter.shown < counter.total);
const visibleShowMoreButtonIds = (html) =>
  Array.from(
    html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/giu),
    (match) => ({
      id: match[1].match(/\bid=["']([^"']+)["']/iu)?.[1] ?? null,
      hidden: /visibility\s*:\s*hidden/iu.test(match[1]),
      disabled: /\bdisabled\b/iu.test(match[1]),
      text: stripTags(match[2]),
    }),
  )
    .filter(
      (button) =>
        button.id &&
        !button.hidden &&
        !button.disabled &&
        /^Afficher plus/iu.test(button.text),
    )
    .map((button) => button.id);
const expandRankingPage = async (initial) => {
  let session = initial;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (incompleteLineCounters(session.html).length === 0) break;
    const buttonId = visibleShowMoreButtonIds(session.html)[0];
    if (!buttonId) break;
    const values = parseFormValues(session.html);
    values.set("WD_ACTION_", "");
    values.set("WD_BUTTON_CLICK_", buttonId);
    session = await postForm(session, values);
  }
  return session;
};
const searchGeneralRanking = async ({
  sourceUrl,
  seasonLabel,
  competitionName,
  specialty,
  divisionName,
}) => {
  let session = await openPublicSession(sourceUrl);
  session = await selectOption(session, "A34", seasonLabel);
  const options =
    parseSelects(session.html).find((item) => item.id === "A33")?.options ?? [];
  const folded = fold(competitionName);
  const competition = options.find(
    (option) =>
      fold(option.label) !== "toutes" && folded.includes(fold(option.label)),
  );
  if (!competition)
    throw new Error("Le type de championnat FFPB n’a pas été reconnu.");
  {
    const values = parseFormValues(session.html);
    values.set("A33", competition.value);
    values.set("WD_ACTION_", "");
    values.set("WD_BUTTON_CLICK_", "A33");
    session = await postForm(session, values);
  }
  session = await selectOption(session, "A36", divisionName);
  session = await selectOption(session, "A38", specialty, true);
  {
    const values = parseFormValues(session.html);
    values.set("WD_ACTION_", "");
    values.set("WD_BUTTON_CLICK_", "A32");
    session = await postForm(session, values);
  }
  const poolButton = buttonIdByText(session.html, "Classement");
  if (!poolButton)
    throw new Error(
      `Le classement FFPB de « ${divisionName} » n’est pas disponible.`,
    );
  {
    const values = parseFormValues(session.html);
    values.set("WD_ACTION_", "");
    values.set("WD_BUTTON_CLICK_", poolButton);
    session = await postForm(session, values);
  }
  const generalButton = buttonIdByText(
    session.html,
    "Classement Général (à l'issue des poules)",
  );
  if (!generalButton)
    throw new Error(
      `Le classement général officiel de « ${divisionName} » n’est pas disponible.`,
    );
  {
    const values = parseFormValues(session.html);
    values.set("WD_ACTION_", "");
    values.set("WD_BUTTON_CLICK_", generalButton);
    session = await postForm(session, values);
  }
  return expandRankingPage(session);
};
const htmlToLines = (html) =>
  decodeHtml(
    html
      .replace(/<script\b[\s\S]*?<\/script>/giu, " ")
      .replace(/<style\b[\s\S]*?<\/style>/giu, " ")
      .replace(/<(?:br|\/td|\/tr|\/div|\/p|\/li|\/table)>/giu, "\n")
      .replace(/<[^>]+>/gu, " "),
  )
    .split(/\r?\n/gu)
    .map((line) => line.replace(/\s+/gu, " ").trim())
    .filter(Boolean);
const teamFromLine = (line) => {
  if (line.startsWith("-")) return null;
  const match = line.match(
    /^(.*[A-Za-zÀ-ÖØ-öø-ÿ].*?)\s+(\d{1,3})(?=\s+-\s+|$)/u,
  );
  if (!match) return null;
  const clubName = match[1].trim();
  return {
    clubName,
    teamNumber: match[2],
    teamLabel: `${clubName} ${match[2]}`,
  };
};
const ordinal = (line) => {
  const match = line.match(/^(\d{1,3})(?:er|e|ème|eme)$/iu);
  return match ? Number(match[1]) : null;
};
const statToken = (line) => {
  if (line === "-") return { matched: true, value: null };
  if (!/^-?\d+(?:[.,]\d+)?$/u.test(line))
    return { matched: false, value: null };
  const value = Number(line.replace(",", "."));
  return { matched: Number.isFinite(value), value };
};
const parseGeneralStandings = (html, division) => {
  const lines = htmlToLines(html),
    standings = [];
  const headingIndex = lines.findIndex((line) =>
    /Classement Général.*issue des poules/iu.test(line),
  );
  const start = headingIndex >= 0 ? headingIndex + 1 : 0;
  let pendingRank = null;
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\d{1,3}$/u.test(line)) {
      pendingRank = Number(line);
      continue;
    }
    const team = teamFromLine(line);
    if (!team || !pendingRank) continue;
    let cursor = index + 1;
    while (cursor < lines.length && lines[cursor].startsWith("-")) cursor += 1;
    const poolMatch = lines[cursor]?.match(/^Poule\s+(.+)$/iu);
    if (!poolMatch) continue;
    const poolCode = poolMatch[1].trim();
    cursor += 1;
    const poolRank = ordinal(lines[cursor] ?? "");
    if (!poolRank) continue;
    cursor += 1;
    const stats = [];
    for (; cursor < lines.length && stats.length < 12; cursor += 1) {
      const parsed = statToken(lines[cursor]);
      if (!parsed.matched) break;
      stats.push(parsed.value);
    }
    if (stats.length < 12) continue;
    const [
      wins,
      losses,
      lost,
      points,
      pointsPerGame,
      setsWon,
      setsLost,
      averageSetDifference,
      scoreFor,
      scoreAgainst,
      scoreDifference,
      averageDifference,
    ] = stats;
    standings.push({
      row: standings.length + 1,
      division,
      divisionNormalized: fold(division),
      poolCode,
      poolRank,
      teamLabel: team.teamLabel,
      clubName: team.clubName,
      clubNormalized: fold(team.clubName),
      teamNumber: team.teamNumber,
      rank: pendingRank,
      played:
        Number.isInteger(wins) &&
        Number.isInteger(losses) &&
        Number.isInteger(lost)
          ? wins + losses + lost
          : null,
      wins: Number.isInteger(wins) ? wins : null,
      draws: null,
      losses: Number.isInteger(losses) ? losses : null,
      points: Number.isFinite(points) ? points : null,
      scoreFor: Number.isInteger(scoreFor) ? scoreFor : null,
      scoreAgainst: Number.isInteger(scoreAgainst) ? scoreAgainst : null,
      scoreDifference: Number.isInteger(scoreDifference)
        ? scoreDifference
        : null,
      sourcePayload: {
        "Rang poule": String(poolRank),
        "Vict.": String(wins),
        "Déf.": String(losses),
        "Perd.": String(lost),
        Points: String(points),
        "Points / partie": String(pointsPerGame),
        "Man. gagn.": String(setsWon),
        "Man. perd.": String(setsLost),
        "Dif. man. moy.": String(averageSetDifference),
        "points marq.": String(scoreFor),
        "points enc.": String(scoreAgainst),
        "Dif. points": String(scoreDifference),
        "Dif. points moy.": String(averageDifference),
      },
    });
    pendingRank = null;
    index = cursor - 1;
  }
  return standings;
};
export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "Method not allowed" });
  }
  try {
    const sourceUrl = normalizeSourceUrl(request.body?.sourceUrl);
    const seasonLabel = String(request.body?.seasonLabel ?? "").trim();
    const competitionName = String(request.body?.competitionName ?? "").trim();
    const specialty = String(request.body?.specialty ?? "").trim();
    const divisions = Array.isArray(request.body?.divisions)
      ? request.body.divisions
          .map((item) => String(item?.name ?? item ?? "").trim())
          .filter(Boolean)
      : [];
    if (
      !seasonLabel ||
      !competitionName ||
      !specialty ||
      divisions.length === 0
    )
      return response
        .status(400)
        .json({ error: "Paramètres FFPB incomplets." });
    const generalStandings = [],
      warnings = [];
    for (const divisionName of divisions) {
      try {
        const session = await searchGeneralRanking({
          sourceUrl,
          seasonLabel,
          competitionName,
          specialty,
          divisionName,
        });
        const rows = parseGeneralStandings(session.html, divisionName);
        if (rows.length === 0)
          warnings.push(
            `Aucun classement général publié n’a été reconnu pour « ${divisionName} ».`,
          );
        else generalStandings.push(...rows);
      } catch (cause) {
        warnings.push(
          cause instanceof Error
            ? cause.message
            : `Classement général impossible à lire pour « ${divisionName} ».`,
        );
      }
    }
    if (generalStandings.length === 0)
      return response
        .status(422)
        .json({
          error:
            "Aucun classement général officiel exploitable n’a pu être lu automatiquement.",
          warnings,
        });
    return response
      .status(200)
      .json({
        generalStandings,
        warnings,
        summary: {
          divisionCount: new Set(
            generalStandings.map((row) => row.divisionNormalized),
          ).size,
          teamCount: generalStandings.length,
        },
      });
  } catch (error) {
    return response
      .status(500)
      .json({
        error:
          error instanceof Error
            ? error.message
            : "Lecture automatique du classement général impossible.",
      });
  }
}
