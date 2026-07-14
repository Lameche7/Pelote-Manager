import type { TeamInsert } from '@/types/database'

/**
 * Parses a CSV string into team insert records.
 *
 * Expected CSV format (with header row):
 * joueur1,joueur2,serie_id,telephone,email
 */
export function parseTeamsCsv(csv: string, tournamentId: string): TeamInsert[] {
  const lines = csv
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

  if (lines.length < 2) throw new Error('Le fichier CSV est vide ou invalide')

  const [, ...dataLines] = lines

  return dataLines.map((line, index) => {
    const cols = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''))

    const [player1, player2, seriesId, phone, email] = cols

    if (!player1 || !player2 || !seriesId) {
      throw new Error(
        `Ligne ${index + 2}: joueur1, joueur2 et serie_id sont obligatoires`,
      )
    }

    return {
      tournament_id: tournamentId,
      series_id: seriesId,
      player1_name: player1,
      player2_name: player2,
      phone: phone ?? null,
      email: email ?? null,
    }
  })
}
