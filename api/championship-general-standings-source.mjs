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

const normalizeSourceUrl = (value) => {
  const raw = String(value ?? "").trim();
  if (!raw) throw new Error("La source officielle du championnat est absente.");
  const url = new URL(/^https?:\/\//iu.test(raw) ? raw : `https://${raw}`);
  if (!ALLOWED_HOSTS.has(url.hostname)) {
    throw new Error("Cette source officielle n’est pas prise en charge.");
  }
  return url;
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

const actualPageUrl = (sourceUrl, bootstrapHtml) => {
  if (
    /FFPB_COMPETITION/iu.test(bootstrapHtml) &&
    !sourceUrl.pathname.includes("FFPB_COMPETITION")
  ) {
    const next = new URL("/FFPB_COMPETITION/", sourceUrl.origin);
    next.search = sourceUrl.search;
    return next;
  }
  return sourceUrl;
};

const openSession = async (sourceUrl) => {
  const bootstrap = await fetch(sourceUrl, {
    redirect: "follow",
    headers: headersBase,
  });
  const bootstrapHtml = await bootstrap.text();
  const cookie1 = cookieFrom(bootstrap);
  const pageUrl = actualPageUrl(sourceUrl, bootstrapHtml);
  const page = await fetch(pageUrl, {
    redirect: "follow",
    headers: { ...headersBase, ...(cookie1 ? { cookie: cookie1 } : {}) },
  });
  const html = await page.text();
  if (!page.ok || !/id=["']I7["']/iu.test(html)) {
    throw new Error("La page officielle du championnat n’a pas pu être lue.");
  }
  const actionRaw = html.match(/<form[^>]*action=["']([^"']+)["']/iu)?.[1];
  if (!actionRaw) {
    throw new Error("Le formulaire de la fédération n’a pas été reconnu.");
  }
  return {
    action: new URL(decodeHtml(actionRaw), pageUrl.origin),
    origin: pageUrl.origin,
    cookie: mergeCookies(cookie1, cookieFrom(page)),
    html,
  };
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
    ) {
      continue;
    }
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
    (match) => {
      const attrs = match[1];
      return {
        value: decodeHtml(
          attrs.match(/\bvalue=["']([^"']*)["']/iu)?.[1] ?? "",
        ),
        label: decodeHtml(match[2].replace(/<[^>]+>/gu, ""))
          .replace(/\s+/gu, " ")
          .trim(),
        selected: /\bselected\b/iu.test(attrs),
      };
    },
  );
};

const selectedCategory = (html) =>
  categoryOptions(html).find((item) => item.selected)?.label ?? null;

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
  const actionRaw = html.match(/<form[^>]*action=["']([^"']+)["']/iu)?.[1];
  return {
    action: actionRaw
      ? new URL(decodeHtml(actionRaw), session.origin)
      : session.action,
    origin: session.origin,
    html,
    cookie: mergeCookies(session.cookie, cookieFrom(response)),
    ok: response.ok,
  };
};

const incompleteLineCounters = (html) =>
  Array.from(html.matchAll(/>(\d+)\s*\/\s*(\d+)\s+lignes</giu), (match) => ({
    shown: Number(match[1]),
    total: Number(match[2]),
  })).filter((counter) => counter.shown < counter.total);

const visibleShowMoreButtonIds = (html) =>
  Array.from(
    html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/giu),
    (match) => {
      const attrs = match[1];
      const text = decodeHtml(match[2].replace(/<[^>]+>/gu, " "))
        .replace(/\s+/gu, " ")
        .trim();
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

const expandRankingPage = async (initialResult) => {
  let current = initialResult;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (incompleteLineCounters(current.html).length === 0) break;
    const buttonId = visibleShowMoreButtonIds(current.html)[0];
    if (!buttonId) break;
    const values = parseFormValues(current.html);
    values.set("WD_ACTION_", "");
    values.set("WD_BUTTON_CLICK_", buttonId);
    const next = await postForm(current, values);
    if (!next.ok) break;
    current = next;
  }
  return current;
};

const buttonIdByText = (html, expected) => {
  const target = fold(expected);
  const buttons = Array.from(
    html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/giu),
    (match) => {
      const attrs = match[1];
      return {
        id: attrs.match(/\bid=["']([^"']+)["']/iu)?.[1] ?? null,
        hidden: /visibility\s*:\s*hidden/iu.test(attrs),
        disabled: /\bdisabled\b/iu.test(attrs),
        text: decodeHtml(match[2].replace(/<[^>]+>/gu, " "))
          .replace(/\s+/gu, " ")
          .trim(),
      };
    },
  );
  return (
    buttons.find(
      (button) =>
        button.id &&
        !button.hidden &&
        !button.disabled &&
        fold(button.text) === target,
    )?.id ?? null
  );
};

const requestPoolRankingPage = async (sourceUrl, divisionName) => {
  const session = await openSession(sourceUrl);
  const option = categoryOptions(session.html).find(
    (item) => fold(item.label) === fold(divisionName),
  );
  if (!option) {
    return {
      session: null,
      warning: `Série « ${divisionName} » introuvable sur la page officielle.`,
    };
  }

  const directValues = parseFormValues(session.html);
  directValues.set("I7", option.value);
  directValues.set("WD_ACTION_", "");
  directValues.set("WD_BUTTON_CLICK_", "I54");
  let direct = await postForm(session, directValues);

  if (direct.ok && fold(selectedCategory(direct.html)) === fold(divisionName)) {
    return { session: await expandRankingPage(direct), warning: null };
  }

  const changeValues = parseFormValues(session.html);
  changeValues.set("I7", option.value);
  changeValues.set("WD_ACTION_", "");
  changeValues.set("WD_BUTTON_CLICK_", "I7");
  const changed = await postForm(session, changeValues);

  if (changed.ok) {
    const rankingValues = parseFormValues(changed.html);
    rankingValues.set("WD_ACTION_", "");
    rankingValues.set("WD_BUTTON_CLICK_", "I54");
    direct = await postForm(changed, rankingValues);
    if (
      direct.ok &&
      fold(selectedCategory(direct.html)) === fold(divisionName)
    ) {
      return { session: await expandRankingPage(direct), warning: null };
    }
  }

  return {
    session: null,
    warning: `La fédération n’a pas accepté la lecture automatique de « ${divisionName} » dans cette session.`,
  };
};

const requestGeneralRankingPage = async (sourceUrl, divisionName) => {
  const pool = await requestPoolRankingPage(sourceUrl, divisionName);
  if (!pool.session) return pool;
  const buttonId = buttonIdByText(
    pool.session.html,
    "Classement Général (à l'issue des poules)",
  );
  if (!buttonId) {
    return {
      session: null,
      warning: `Le classement général officiel de « ${divisionName} » n’est pas disponible.`,
    };
  }
  const values = parseFormValues(pool.session.html);
  values.set("WD_ACTION_", "");
  values.set("WD_BUTTON_CLICK_", buttonId);
  const general = await postForm(pool.session, values);
  if (!general.ok) {
    return {
      session: null,
      warning: `Le classement général officiel de « ${divisionName} » n’a pas pu être ouvert.`,
    };
  }
  return { session: await expandRankingPage(general), warning: null };
};

const htmlToLines = (html) => {
  const withoutNoise = html
    .replace(/<script\b[\s\S]*?<\/script>/giu, " ")
    .replace(/<style\b[\s\S]*?<\/style>/giu, " ")
    .replace(/<(?:br|\/td|\/tr|\/div|\/p|\/li|\/table)>/giu, "\n")
    .replace(/<[^>]+>/gu, " ");
  return decodeHtml(withoutNoise)
    .split(/\r?\n/gu)
    .map((line) => line.replace(/\s+/gu, " ").trim())
    .filter(Boolean);
};

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
  if (!/^-?\d+(?:[.,]\d+)?$/u.test(line)) {
    return { matched: false, value: null };
  }
  const value = Number(line.replace(",", "."));
  return { matched: Number.isFinite(value), value };
};

const parseGeneralStandings = (html, division) => {
  const lines = htmlToLines(html);
  const standings = [];
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
    const divisions = Array.isArray(request.body?.divisions)
      ? request.body.divisions
          .map((item) => String(item?.name ?? "").trim())
          .filter(Boolean)
      : [];
    if (divisions.length === 0 || divisions.length > 30) {
      return response
        .status(400)
        .json({ error: "Aucune série exploitable n’a été fournie." });
    }

    const generalStandings = [];
    const warnings = [];
    for (const division of divisions) {
      const result = await requestGeneralRankingPage(sourceUrl, division);
      if (!result.session) {
        if (result.warning) warnings.push(result.warning);
        continue;
      }
      const rows = parseGeneralStandings(result.session.html, division);
      if (rows.length === 0) {
        warnings.push(
          `Aucun classement général publié n’a été reconnu pour « ${division} ».`,
        );
        continue;
      }
      generalStandings.push(...rows);
    }

    if (generalStandings.length === 0) {
      return response.status(422).json({
        error:
          "Aucun classement général officiel exploitable n’a pu être lu automatiquement.",
        warnings,
      });
    }

    return response.status(200).json({
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
    return response.status(500).json({
      error:
        error instanceof Error
          ? error.message
          : "Lecture automatique du classement général impossible.",
    });
  }
}
