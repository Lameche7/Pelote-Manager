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
    select.options.find((option) => fold(option.label) === target)?.value ?? null
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

const incompleteLineCounters = (html) =>
  Array.from(html.matchAll(/>(\d+)\s*\/\s*(\d+)\s+lignes</giu), (match) => ({
    shown: Number(match[1]),
    total: Number(match[2]),
  })).filter((counter) => counter.shown < counter.total);

const expandRankingPage = async (initialSession) => {
  let session = initialSession;
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

const searchDivisionRanking = async ({
  sourceUrl,
  seasonLabel,
  competitionName,
  specialty,
  divisionName,
}) => {
  let session = await openPublicSession(sourceUrl);
  session = await selectOption(session, "A34", seasonLabel);

  const competitionOptions = parseSelects(session.html).find(
    (item) => item.id === "A33",
  )?.options ?? [];
  const foldedName = fold(competitionName);
  const competitionOption = competitionOptions.find(
    (option) =>
      fold(option.label) !== "toutes" && foldedName.includes(fold(option.label)),
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

  {
    const values = parseFormValues(session.html);
    values.set("WD_ACTION_", "");
    values.set("WD_BUTTON_CLICK_", "A32");
    session = await postForm(session, values);
  }

  if (!/<button\b[^>]*id=["']I54["']/iu.test(session.html)) {
    throw new Error(`Le classement FFPB de « ${divisionName} » n’est pas disponible.`);
  }
  {
    const values = parseFormValues(session.html);
    values.set("WD_ACTION_", "");
    values.set("WD_BUTTON_CLICK_", "I54");
    session = await postForm(session, values);
  }

  session = await expandRankingPage(session);
  return session.html;
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

const poolFromLine = (line) =>
  line.match(/^Poule\s+(.+)$/iu)?.[1]?.trim() ?? null;

const teamFromLine = (line) => {
  if (line.startsWith("-")) return null;
  const match = line.match(
    /^(.*[A-Za-zÀ-ÖØ-öø-ÿ].*?)\s+(\d{1,3})(?=\s+-\s+.*\(\d{5,8}\)|$)/u,
  );
  if (!match) return null;
  const clubName = match[1].trim();
  return {
    clubName,
    teamNumber: match[2],
    teamLabel: `${clubName} ${match[2]}`,
  };
};

const numericTokens = (line) => {
  if (!/^-?\d+(?:[.,]\d+)?(?:\s+-?\d+(?:[.,]\d+)?)*$/u.test(line)) return [];
  return line
    .split(/\s+/u)
    .map((value) => Number(value.replace(",", ".")))
    .filter(Number.isFinite);
};

const parseStandings = (html, division) => {
  const lines = htmlToLines(html);
  const standings = [];
  let poolCode = "";
  let pendingRank = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const nextPool = poolFromLine(line);
    if (nextPool) {
      poolCode = nextPool;
      pendingRank = null;
      continue;
    }
    if (/^\d{1,2}$/u.test(line)) {
      pendingRank = Number(line);
      continue;
    }
    const team = teamFromLine(line);
    if (!team || !poolCode || !pendingRank) continue;

    const stats = [];
    let cursor = index + 1;
    for (; cursor < lines.length; cursor += 1) {
      const candidate = lines[cursor];
      if (poolFromLine(candidate) || teamFromLine(candidate)) break;
      const numeric = numericTokens(candidate);
      if (numeric.length > 0) {
        stats.push(...numeric);
      } else if (candidate.startsWith("-")) {
        continue;
      }
      if (stats.length >= 9) break;
    }
    if (stats.length < 9) continue;

    const [
      wins,
      losses,
      lost,
      points,
      pointsPerGame,
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
        "Vict.": String(wins),
        "Déf.": String(losses),
        "Perd.": String(lost),
        Points: String(points),
        "Points / partie": String(pointsPerGame),
        "points marq.": String(scoreFor),
        "points enc.": String(scoreAgainst),
        "Dif. points": String(scoreDifference),
        "Dif. points moy.": String(averageDifference),
      },
    });
    pendingRank = null;
    index = cursor;
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

    if (!seasonLabel || !competitionName || !specialty) {
      return response.status(400).json({
        error: "Saison, championnat et spécialité sont nécessaires pour lire les classements.",
      });
    }
    if (divisions.length === 0 || divisions.length > 30) {
      return response
        .status(400)
        .json({ error: "Aucune série exploitable n’a été fournie." });
    }

    const standings = [];
    const warnings = [];
    for (const divisionName of divisions) {
      try {
        const html = await searchDivisionRanking({
          sourceUrl,
          seasonLabel,
          competitionName,
          specialty,
          divisionName,
        });
        const rows = parseStandings(html, divisionName);
        if (rows.length === 0) {
          warnings.push(
            `Aucun classement publié n’a été reconnu pour « ${divisionName} ».`,
          );
          continue;
        }
        standings.push(...rows);
      } catch (cause) {
        warnings.push(
          cause instanceof Error
            ? cause.message
            : `Classement impossible à lire pour « ${divisionName} ».`,
        );
      }
    }

    if (standings.length === 0) {
      return response.status(422).json({
        error:
          "Aucun classement officiel exploitable n’a pu être lu automatiquement.",
        warnings,
      });
    }

    const pools = new Set(
      standings.map((row) => `${row.divisionNormalized}:${row.poolCode}`),
    );
    return response.status(200).json({
      standings,
      warnings,
      summary: {
        divisionCount: new Set(standings.map((row) => row.divisionNormalized))
          .size,
        poolCount: pools.size,
        teamCount: standings.length,
      },
    });
  } catch (error) {
    return response.status(500).json({
      error:
        error instanceof Error
          ? error.message
          : "Lecture automatique des classements impossible.",
    });
  }
}
