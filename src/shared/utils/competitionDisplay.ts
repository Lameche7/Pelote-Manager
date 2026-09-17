const matchupSeparators = [" — ", " – ", " vs ", " VS "];

export const formatMatchupLines = (value: string) => {
  const label = value.trim();
  for (const separator of matchupSeparators) {
    const separatorIndex = label.indexOf(separator);
    if (separatorIndex <= 0) continue;

    const teamA = label.slice(0, separatorIndex).trim();
    const teamB = label.slice(separatorIndex + separator.length).trim();
    if (teamA && teamB) return `${teamA}\nvs ${teamB}`;
  }

  return label;
};

export const formatCompetitionReservationParts = (
  competitionName: string,
  seriesName: string,
  matchup: string,
) =>
  [competitionName.trim(), seriesName.trim(), formatMatchupLines(matchup)]
    .filter(Boolean)
    .join("\n");

export const formatCompetitionReservationLabel = (value: string | null) => {
  if (!value) return null;

  const parts = value
    .split(" · ")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 3) return formatMatchupLines(value);

  const [competitionName, seriesName, ...matchupParts] = parts;
  return formatCompetitionReservationParts(
    competitionName,
    seriesName,
    matchupParts.join(" · "),
  );
};
