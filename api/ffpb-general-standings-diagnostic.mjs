import handler from "./championship-general-standings-public-source.mjs";

export default async function diagnostic(request, response) {
  const body = {
    sourceUrl: String(request.query.sourceUrl ?? "https://lbpb.competition.ffpb.net/FFPB_COMPETITION/"),
    seasonLabel: String(request.query.seasonLabel ?? "2027"),
    competitionName: String(request.query.competitionName ?? "CHAMPIONNAT HIVER 2027"),
    specialty: String(request.query.specialty ?? "Trinquet Paleta Pelote de Gomme Pleine Masculin"),
    divisions: [{ name: String(request.query.division ?? "2ème série") }],
  };
  let statusCode = 200;
  let payload = null;
  const fakeResponse = {
    setHeader() {},
    status(code) { statusCode = code; return this; },
    json(value) { payload = value; return this; },
  };
  await handler({ method: "POST", body }, fakeResponse);
  return response.status(statusCode).json(payload);
}
