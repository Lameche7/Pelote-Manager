import { createClient } from "npm:@supabase/supabase-js@2.110.5";

const EXPECTED_TOKEN_SHA256 =
  "9c739a6844eb5c9e1ac10febda421cb1000a633535f0452c5707ce5696c19b69";
const DEFAULT_SOURCE_BASE_URL = "https://pelotemanager.fr";
const PARIS_TIME_ZONE = "Europe/Paris";
const ALLOWED_WEEKDAYS = new Set(["Mon", "Thu", "Fri", "Sat", "Sun"]);

type JsonRow = Record<string, unknown>;

type ChampionshipRow = {
  id: string;
  name: string;
  specialty: string;
  season_label: string;
  source_url: string | null;
  created_by_club_id: string | null;
};

type DivisionRow = {
  id: string;
  championship_id: string;
  name: string;
  normalized_name: string;
};

type PoolRow = {
  id: string;
  division_id: string;
  code: string;
};

type FederationClubRow = {
  id: string;
  name: string;
  normalized_name: string;
};

type TeamRow = {
  id: string;
  division_id: string;
  federation_club_id: string;
  pool_id: string | null;
  team_number: string;
};

type MatchRow = {
  id: string;
  division_id: string;
  team1_id: string | null;
  team2_id: string | null;
  phase: string;
  scheduled_on: string | null;
  report_on: string | null;
  agreement_on: string | null;
  score_team1: number | null;
  score_team2: number | null;
  status: string;
};

const fold = (value: unknown) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();

const sha256 = async (value: string) => {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
};

const isAuthorized = async (request: Request) => {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : "";
  return Boolean(token) && (await sha256(token)) === EXPECTED_TOKEN_SHA256;
};

const parisSchedule = () => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: PARIS_TIME_ZONE,
    weekday: "short",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "";
  const hour = parts.find((part) => part.type === "hour")?.value ?? "";
  return { weekday, hour, allowed: ALLOWED_WEEKDAYS.has(weekday) && hour === "23" };
};

const normalizeSourceBaseUrl = (value: unknown) => {
  if (!value) return DEFAULT_SOURCE_BASE_URL;
  const url = new URL(String(value));
  const allowed =
    url.protocol === "https:" &&
    (url.hostname === "pelotemanager.fr" ||
      url.hostname === "www.pelotemanager.fr" ||
      url.hostname.endsWith("-guegue-team.vercel.app"));
  if (!allowed) throw new Error("Source parser host is not allowed.");
  return url.origin;
};

const fetchSource = async (baseUrl: string, path: string, body: JsonRow) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  const payload = (await response.json().catch(() => ({}))) as JsonRow;
  if (!response.ok) {
    throw new Error(String(payload.error ?? `FFPB parser failed (${response.status}).`));
  }
  return payload;
};

const asNumber = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const teamKey = (divisionId: string, clubName: unknown, teamNumber: unknown) =>
  `${divisionId}|${fold(clubName)}|${String(teamNumber ?? "").trim()}`;

const poolKey = (divisionId: string, poolCode: unknown) =>
  `${divisionId}|${fold(poolCode)}`;

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  if (!(await isAuthorized(request))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as JsonRow;
    const force = body.force === true;
    const local = parisSchedule();
    if (!force && !local.allowed) {
      return Response.json({ skipped: true, reason: "outside_schedule", local });
    }

    const sourceBaseUrl = normalizeSourceBaseUrl(body.sourceBaseUrl);
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Supabase service configuration is missing.");
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: championshipsData, error: championshipsError } = await admin
      .from("championships")
      .select("id,name,specialty,season_label,source_url,created_by_club_id")
      .eq("status", "active")
      .not("source_url", "is", null);
    if (championshipsError) throw championshipsError;

    const championships = (championshipsData ?? []) as ChampionshipRow[];
    const summaries: JsonRow[] = [];

    for (const championship of championships) {
      const summary: JsonRow = {
        championshipId: championship.id,
        name: championship.name,
        resultsUpdated: 0,
        poolStandingsUpdated: 0,
        generalStandingsUpdated: 0,
        warnings: [],
      };
      const warnings = summary.warnings as string[];

      try {
        const { data: divisionsData, error: divisionsError } = await admin
          .from("championship_divisions")
          .select("id,championship_id,name,normalized_name")
          .eq("championship_id", championship.id)
          .order("display_order");
        if (divisionsError) throw divisionsError;
        const divisions = (divisionsData ?? []) as DivisionRow[];
        if (divisions.length === 0) {
          warnings.push("No divisions found.");
          summaries.push(summary);
          continue;
        }

        const divisionIds = divisions.map((division) => division.id);
        const sourceBody = {
          sourceUrl: championship.source_url,
          seasonLabel: championship.season_label,
          competitionName: championship.name,
          specialty: championship.specialty,
          divisions: divisions.map((division) => ({ name: division.name })),
        };

        const [resultsSource, poolSource, generalSource] = await Promise.all([
          fetchSource(sourceBaseUrl, "/api/championship-results-source", sourceBody).catch(
            (error) => {
              warnings.push(`Results: ${error instanceof Error ? error.message : String(error)}`);
              return null;
            },
          ),
          fetchSource(
            sourceBaseUrl,
            "/api/championship-pool-standings-source",
            sourceBody,
          ).catch((error) => {
            warnings.push(
              `Pool standings: ${error instanceof Error ? error.message : String(error)}`,
            );
            return null;
          }),
          fetchSource(
            sourceBaseUrl,
            "/api/championship-general-standings-public-source",
            sourceBody,
          ).catch((error) => {
            warnings.push(
              `General standings: ${error instanceof Error ? error.message : String(error)}`,
            );
            return null;
          }),
        ]);

        const [{ data: poolsData, error: poolsError }, { data: teamsData, error: teamsError }]
          = await Promise.all([
            admin
              .from("championship_pools")
              .select("id,division_id,code")
              .in("division_id", divisionIds),
            admin
              .from("championship_teams")
              .select("id,division_id,federation_club_id,pool_id,team_number")
              .in("division_id", divisionIds),
          ]);
        if (poolsError) throw poolsError;
        if (teamsError) throw teamsError;
        const pools = (poolsData ?? []) as PoolRow[];
        const teams = (teamsData ?? []) as TeamRow[];

        const federationClubIds = [
          ...new Set(teams.map((team) => team.federation_club_id)),
        ];
        const { data: federationClubsData, error: federationClubsError } =
          federationClubIds.length > 0
            ? await admin
                .from("championship_federation_clubs")
                .select("id,name,normalized_name")
                .in("id", federationClubIds)
            : { data: [], error: null };
        if (federationClubsError) throw federationClubsError;
        const federationClubs = (federationClubsData ?? []) as FederationClubRow[];

        const divisionByName = new Map<string, DivisionRow>();
        for (const division of divisions) {
          divisionByName.set(fold(division.name), division);
          divisionByName.set(fold(division.normalized_name), division);
        }
        const poolByKey = new Map(pools.map((pool) => [poolKey(pool.division_id, pool.code), pool]));
        const clubById = new Map(federationClubs.map((club) => [club.id, club]));
        const teamByKey = new Map<string, TeamRow>();
        for (const team of teams) {
          const club = clubById.get(team.federation_club_id);
          if (!club) continue;
          teamByKey.set(teamKey(team.division_id, club.name, team.team_number), team);
          teamByKey.set(
            teamKey(team.division_id, club.normalized_name, team.team_number),
            team,
          );
        }

        if (resultsSource && Array.isArray(resultsSource.results)) {
          const { data: matchesData, error: matchesError } = await admin
            .from("championship_matches")
            .select(
              "id,division_id,team1_id,team2_id,phase,scheduled_on,report_on,agreement_on,score_team1,score_team2,status",
            )
            .in("division_id", divisionIds);
          if (matchesError) throw matchesError;
          const matches = (matchesData ?? []) as MatchRow[];

          for (const raw of resultsSource.results as JsonRow[]) {
            const division = divisionByName.get(fold(raw.division));
            const team1 = division
              ? teamByKey.get(
                  teamKey(
                    division.id,
                    (raw.team1 as JsonRow | undefined)?.clubName,
                    (raw.team1 as JsonRow | undefined)?.teamNumber,
                  ),
                )
              : undefined;
            const team2 = division
              ? teamByKey.get(
                  teamKey(
                    division.id,
                    (raw.team2 as JsonRow | undefined)?.clubName,
                    (raw.team2 as JsonRow | undefined)?.teamNumber,
                  ),
                )
              : undefined;
            const score1 = asNumber(raw.scoreTeam1);
            const score2 = asNumber(raw.scoreTeam2);
            if (
              !division ||
              !team1 ||
              !team2 ||
              score1 === null ||
              score2 === null ||
              score1 < 0 ||
              score2 < 0 ||
              score1 === score2
            ) {
              warnings.push(`Result row could not be matched: ${String(raw.team1Label ?? "?")} / ${String(raw.team2Label ?? "?")}.`);
              continue;
            }

            let candidates = matches.filter(
              (match) =>
                match.division_id === division.id &&
                match.team1_id === team1.id &&
                match.team2_id === team2.id &&
                fold(match.phase) === fold(raw.phase ?? "Poules"),
            );
            const sourceDate = String(raw.sourceDate ?? "");
            if (candidates.length > 1 && sourceDate) {
              candidates = candidates.filter((match) =>
                [match.scheduled_on, match.report_on, match.agreement_on].includes(sourceDate),
              );
            }
            if (candidates.length !== 1) {
              warnings.push(`Ambiguous result match: ${String(raw.team1Label ?? "?")} / ${String(raw.team2Label ?? "?")}.`);
              continue;
            }
            const match = candidates[0];
            if (
              match.score_team1 === score1 &&
              match.score_team2 === score2 &&
              match.status === "played"
            ) {
              continue;
            }
            const { error: updateError } = await admin
              .from("championship_matches")
              .update({
                score_team1: score1,
                score_team2: score2,
                score_raw: String(raw.scoreRaw ?? `${score1}-${score2}`),
                status: "played",
                updated_at: new Date().toISOString(),
              })
              .eq("id", match.id);
            if (updateError) throw updateError;
            summary.resultsUpdated = Number(summary.resultsUpdated) + 1;
          }
        }

        if (poolSource && Array.isArray(poolSource.standings)) {
          const standingRows: JsonRow[] = [];
          for (const raw of poolSource.standings as JsonRow[]) {
            const division = divisionByName.get(fold(raw.division));
            const pool = division
              ? poolByKey.get(poolKey(division.id, raw.poolCode))
              : undefined;
            const team = division
              ? teamByKey.get(teamKey(division.id, raw.clubName, raw.teamNumber))
              : undefined;
            if (!division || !pool || !team || team.pool_id !== pool.id) {
              warnings.push(`Pool standing row could not be matched: ${String(raw.teamLabel ?? "?")}.`);
              continue;
            }
            standingRows.push({
              pool_id: pool.id,
              team_id: team.id,
              rank: asNumber(raw.rank),
              played: asNumber(raw.played),
              wins: asNumber(raw.wins),
              draws: asNumber(raw.draws),
              losses: asNumber(raw.losses),
              points: asNumber(raw.points),
              score_for: asNumber(raw.scoreFor),
              score_against: asNumber(raw.scoreAgainst),
              score_difference: asNumber(raw.scoreDifference),
              source_payload: (raw.sourcePayload as JsonRow | undefined) ?? {},
              source_import_file_id: null,
              updated_at: new Date().toISOString(),
            });
          }
          if (standingRows.length > 0) {
            const { error: upsertError } = await admin
              .from("championship_standings")
              .upsert(standingRows, { onConflict: "pool_id,team_id" });
            if (upsertError) throw upsertError;
            summary.poolStandingsUpdated = standingRows.length;
          }
        }

        if (generalSource && Array.isArray(generalSource.generalStandings)) {
          const rowsByDivision = new Map<string, JsonRow[]>();
          for (const raw of generalSource.generalStandings as JsonRow[]) {
            const division = divisionByName.get(fold(raw.division));
            const pool = division
              ? poolByKey.get(poolKey(division.id, raw.poolCode))
              : undefined;
            const team = division
              ? teamByKey.get(teamKey(division.id, raw.clubName, raw.teamNumber))
              : undefined;
            if (!division || !pool || !team || team.pool_id !== pool.id) {
              warnings.push(`General standing row could not be matched: ${String(raw.teamLabel ?? "?")}.`);
              continue;
            }
            const target = rowsByDivision.get(division.id) ?? [];
            target.push({
              division_id: division.id,
              pool_id: pool.id,
              team_id: team.id,
              rank: asNumber(raw.rank),
              pool_rank: asNumber(raw.poolRank),
              played: asNumber(raw.played),
              wins: asNumber(raw.wins),
              draws: asNumber(raw.draws),
              losses: asNumber(raw.losses),
              points: asNumber(raw.points),
              score_for: asNumber(raw.scoreFor),
              score_against: asNumber(raw.scoreAgainst),
              score_difference: asNumber(raw.scoreDifference),
              source_payload: (raw.sourcePayload as JsonRow | undefined) ?? {},
              source_import_file_id: null,
              updated_at: new Date().toISOString(),
            });
            rowsByDivision.set(division.id, target);
          }

          for (const [divisionId, rows] of rowsByDivision) {
            if (rows.length === 0) continue;
            const incomingForDivision = (generalSource.generalStandings as JsonRow[]).filter(
              (raw) => divisionByName.get(fold(raw.division))?.id === divisionId,
            ).length;
            if (rows.length !== incomingForDivision) {
              warnings.push(`General standings for division ${divisionId} were not fully matched; previous data kept.`);
              continue;
            }
            const { error: deleteError } = await admin
              .from("championship_general_standings")
              .delete()
              .eq("division_id", divisionId);
            if (deleteError) throw deleteError;
            const { error: insertError } = await admin
              .from("championship_general_standings")
              .insert(rows);
            if (insertError) throw insertError;
            summary.generalStandingsUpdated =
              Number(summary.generalStandingsUpdated) + rows.length;
          }
        }

        const { error: auditError } = await admin
          .from("championship_audit_log")
          .insert({
            championship_id: championship.id,
            club_id: championship.created_by_club_id,
            actor_id: null,
            action: "championship.official_auto_sync",
            payload: {
              sourceBaseUrl,
              resultsUpdated: summary.resultsUpdated,
              poolStandingsUpdated: summary.poolStandingsUpdated,
              generalStandingsUpdated: summary.generalStandingsUpdated,
              warnings,
            },
          });
        if (auditError) throw auditError;
      } catch (error) {
        warnings.push(error instanceof Error ? error.message : String(error));
      }
      summaries.push(summary);
    }

    return Response.json({
      ok: true,
      forced: force,
      local,
      championshipCount: championships.length,
      summaries,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
});
