import handler from "./championship-pool-standings-source.mjs";

export default async function diagnostic(request, response) {
  const body = {
    sourceUrl: String(request.query.sourceUrl ?? ""),
    seasonLabel: String(request.query.seasonLabel ?? ""),
    competitionName: String(request.query.competitionName ?? ""),
    specialty: String(request.query.specialty ?? ""),
    divisions: [{ name: String(request.query.division ?? "") }],
  };

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
      return this;
    },
  };

  await handler({ method: "POST", body }, fakeResponse);
  return response.status(statusCode).json(payload);
}
