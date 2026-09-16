from pathlib import Path


def replace_once(path_value: str, old: str, new: str, label: str) -> None:
    path = Path(path_value)
    text = path.read_text()
    if new in text:
        return
    if old not in text:
        raise RuntimeError(f"Patch introuvable: {label}")
    path.write_text(text.replace(old, new, 1))


tournament_page = "src/features/user-space/tournaments/pages/MyTournamentsPage.tsx"
replace_once(
    tournament_page,
    'import { Link, useSearchParams } from "react-router-dom";',
    'import { Phone } from "lucide-react";\nimport { Link, useSearchParams } from "react-router-dom";',
    "tournament phone import",
)
replace_once(
    tournament_page,
    '''const teamLabel = (players: MyTournamentPlayer[]) =>
  players.map(playerLabel).filter(Boolean).join(" / ") || "Équipe";''',
    '''const teamLabel = (players: MyTournamentPlayer[]) =>
  players.map(playerLabel).filter(Boolean).join(" / ") || "Équipe";

const phoneHref = (phone: string) =>
  `tel:${phone.replace(/[^+\\d]/gu, "")}`;''',
    "tournament phone helper",
)
replace_once(
    tournament_page,
    '''  const opponent = teamLabel(match.opponentPlayers);
  const resultLabel = formatResult(match);''',
    '''  const opponent = teamLabel(match.opponentPlayers);
  const opponentContacts = match.opponentPlayers.filter(
    (player) => player.phone,
  );
  const resultLabel = formatResult(match);''',
    "tournament opponent contacts",
)
replace_once(
    tournament_page,
    '''        <strong>vs {opponent}</strong>
        {encouragement && (''',
    '''        <strong>vs {opponent}</strong>
        {opponentContacts.length > 0 && (
          <div className="my-tournaments__opponent-contacts">
            {opponentContacts.map((player) => (
              <a
                key={`${player.role}-${player.firstName}-${player.lastName}`}
                href={phoneHref(player.phone!)}
              >
                <Phone aria-hidden="true" />
                {playerLabel(player)} · {player.phone}
              </a>
            ))}
          </div>
        )}
        {encouragement && (''',
    "tournament opponent UI",
)
replace_once(
    tournament_page,
    '''                <span>
                  {roleLabels[player.role]}
                  {player.clubName ? ` · ${player.clubName}` : ""}
                </span>
              </div>''',
    '''                <span>
                  {roleLabels[player.role]}
                  {player.clubName ? ` · ${player.clubName}` : ""}
                </span>
                {player.phone && (
                  <a
                    className="my-tournaments__phone"
                    href={phoneHref(player.phone)}
                  >
                    <Phone aria-hidden="true" />
                    {player.phone}
                  </a>
                )}
              </div>''',
    "tournament own phone UI",
)

championship_page = "src/features/user-space/championships/pages/MyChampionshipsPage.tsx"
replace_once(
    championship_page,
    '''  ExternalLink,
  Send,
  Trophy,''',
    '''  ExternalLink,
  Phone,
  Send,
  Trophy,''',
    "championship phone import",
)
replace_once(
    championship_page,
    '''const officialSourceHref = (value: string) =>
  /^https?:\\/\\//iu.test(value) ? value : `https://${value}`;''',
    '''const officialSourceHref = (value: string) =>
  /^https?:\\/\\//iu.test(value) ? value : `https://${value}`;

const phoneHref = (phone: string) =>
  `tel:${phone.replace(/[^+\\d]/gu, "")}`;''',
    "championship phone helper",
)
replace_once(
    championship_page,
    '''          <strong>vs {match.opponentLabel || "Adversaire à définir"}</strong>
          {place && <small>{place}</small>}''',
    '''          <strong>vs {match.opponentLabel || "Adversaire à définir"}</strong>
          {match.opponentContacts.length > 0 && (
            <div className="my-championships__opponent-contacts">
              {match.opponentContacts.map((contact) => (
                <a
                  key={`${contact.firstName}-${contact.lastName}-${contact.phone}`}
                  href={phoneHref(contact.phone)}
                >
                  <Phone aria-hidden="true" />
                  {contact.firstName} {contact.lastName} · {contact.phone}
                </a>
              ))}
            </div>
          )}
          {place && <small>{place}</small>}''',
    "championship opponent UI",
)
replace_once(
    championship_page,
    '''              {player.isMe && <small>Vous</small>}
            </span>''',
    '''              {player.isMe && <small>Vous</small>}
              {player.phone && (
                <a
                  className="my-championships__phone"
                  href={phoneHref(player.phone)}
                >
                  <Phone aria-hidden="true" />
                  {player.phone}
                </a>
              )}
            </span>''',
    "championship own phone UI",
)

css_additions = {
    "src/features/user-space/tournaments/pages/MyTournamentsPage.css": """

.my-tournaments__phone,
.my-tournaments__opponent-contacts a {
  display: inline-flex;
  width: fit-content;
  align-items: center;
  gap: 0.3rem;
  color: inherit;
  font-size: 0.76rem;
  font-weight: 700;
  line-height: 1.25;
  text-decoration: none;
  opacity: 0.78;
}

.my-tournaments__phone:hover,
.my-tournaments__opponent-contacts a:hover {
  text-decoration: underline;
  opacity: 1;
}

.my-tournaments__phone svg,
.my-tournaments__opponent-contacts svg {
  width: 0.85rem;
  height: 0.85rem;
  flex: 0 0 auto;
}

.my-tournaments__opponent-contacts {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 0.75rem;
  margin-top: 0.15rem;
}
""",
    "src/features/user-space/championships/pages/MyChampionshipsPage.css": """

.my-championships__phone,
.my-championships__opponent-contacts a {
  display: inline-flex;
  width: fit-content;
  align-items: center;
  gap: 0.3rem;
  color: inherit;
  font-size: 0.78rem;
  font-weight: 700;
  text-decoration: none;
  opacity: 0.78;
}

.my-championships__phone:hover,
.my-championships__opponent-contacts a:hover {
  text-decoration: underline;
  opacity: 1;
}

.my-championships__phone svg,
.my-championships__opponent-contacts svg {
  width: 0.85rem;
  height: 0.85rem;
  flex: 0 0 auto;
}

.my-championships__opponent-contacts {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 0.75rem;
}
""",
}
for path_value, addition in css_additions.items():
    path = Path(path_value)
    text = path.read_text()
    marker = addition.strip().splitlines()[0]
    if marker not in text:
        path.write_text(text.rstrip() + addition + "\n")

Path("tests/playerPhoneContacts.test.mjs").write_text(
    '''import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("les téléphones restent limités aux participants des compétitions actives", async () => {
  const migration = await read(
    "supabase/migrations/20260916170000_add_player_phone_contacts.sql",
  );
  assert.match(migration, /get_my_tournament_player_contacts/);
  assert.match(migration, /get_my_championship_player_contacts/);
  assert.match(
    migration,
    /tournament\\.status not in \\('completed', 'archived', 'cancelled'\\)/,
  );
  assert.match(migration, /championship\\.status in \\('preparation', 'active'\\)/);
  assert.match(migration, /identity\\.status = 'verified'/);
  assert.match(migration, /player\\.external_identity_id is null/);
});

test("Mes tournois et Mes championnats affichent les contacts disponibles", async () => {
  const [tournamentService, tournamentPage, championshipService, championshipPage] =
    await Promise.all([
      read("src/features/user-space/tournaments/services/myTournamentsService.ts"),
      read("src/features/user-space/tournaments/pages/MyTournamentsPage.tsx"),
      read("src/features/user-space/championships/services/myChampionshipsService.ts"),
      read("src/features/user-space/championships/pages/MyChampionshipsPage.tsx"),
    ]);

  assert.match(tournamentService, /get_my_tournament_player_contacts/);
  assert.match(tournamentService, /phone: string \\| null/);
  assert.match(tournamentPage, /my-tournaments__opponent-contacts/);
  assert.match(tournamentPage, /phoneHref\\(player\\.phone/);

  assert.match(championshipService, /get_my_championship_player_contacts/);
  assert.match(championshipService, /opponentContacts/);
  assert.match(championshipPage, /my-championships__opponent-contacts/);
  assert.match(championshipPage, /phoneHref\\(contact\\.phone\\)/);
});
'''
)
