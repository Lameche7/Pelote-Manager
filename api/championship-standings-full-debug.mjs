import standingsHandler from "./championship-standings-source.mjs";

const divisions = [
  "M19 (moins de 19ans)",
  "M22 (moins de 22ans)",
  "Senior 1ère Série",
  "Senior 2ème Série",
  "Sénior 3ème Série",
  "Senior 4ème série",
];

export default async function handler(request, response) {
  if (request.method !== "GET") {
    return response.status(405).json({ error: "GET only" });
  }

  let statusCode = 200;
  let payload = null;
  const fakeResponse = {
    setHeader() {},
    status(code) {
      statusCode = code;
      return this;
    },
    json(value) {
      payload = value;
      return value;
    },
  };

  await standingsHandler(
    {
      method: "POST",
      body: {
        sourceUrl: "lbpb.competition.ffpb.net?id_competition=7",
        divisions: divisions.map((name) => ({ name })),
      },
    },
    fakeResponse,
  );

  if (!payload) {
    return response.status(500).json({ error: "No payload returned" });
  }

  const standings = Array.isArray(payload.standings) ? payload.standings : [];
  const byDivision = Object.fromEntries(
    divisions.map((division) => [
      division,
      {
        rows: standings.filter((row) => row.division === division).length,
        pools: Array.from(
          new Set(
            standings
              .filter((row) => row.division === division)
              .map((row) => row.poolCode),
          ),
        ),
      },
    ]),
  );

  return response.status(statusCode).json({
    statusCode,
    summary: payload.summary ?? null,
    warnings: payload.warnings ?? [],
    error: payload.error ?? null,
    byDivision,
    sample: standings.slice(0, 12),
  });
}
