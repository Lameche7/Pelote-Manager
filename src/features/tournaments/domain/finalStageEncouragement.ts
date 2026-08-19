export type FinalStageRound =
  "preliminary" | "round_of_16" | "quarterfinal" | "semifinal" | "final";

export type FinalStageEncouragementState =
  "pre_match" | "qualified" | "eliminated";

const messages: Record<
  FinalStageEncouragementState,
  Record<FinalStageRound, readonly string[]>
> = {
  pre_match: {
    preliminary: [
      "Rien à perdre, tout à aller chercher.",
      "Le tableau commence maintenant. Fais parler ton jeu.",
      "Un point après l’autre. Le prochain est le seul qui compte.",
    ],
    round_of_16: [
      "Le tableau commence ici. Fais parler ton jeu.",
      "Respecte l’adversaire. Crois en ton jeu.",
      "Calme dans la tête, feu dans le jeu.",
    ],
    quarterfinal: [
      "Plus on avance, plus chaque point compte.",
      "Le classement donne une tendance. Le terrain donne la vérité.",
      "Ne joue pas l’enjeu. Joue le prochain point.",
    ],
    semifinal: [
      "Une marche avant la finale. Joue le point, pas l’enjeu.",
      "La pression est un privilège. Transforme-la en énergie.",
      "Tu es arrivé jusque-là par ton jeu. Continue à lui faire confiance.",
    ],
    final: [
      "Dernier match. Même exigence : un point après l’autre.",
      "Une finale récompense ceux qui restent eux-mêmes sous pression.",
      "Profite du moment, impose ton jeu et va chercher le dernier point.",
    ],
  },
  qualified: {
    preliminary: [
      "Barrage franchi. Un tour de plus, le travail continue.",
      "Première marche franchie. Garde le même cap.",
    ],
    round_of_16: [
      "Un tour de plus. Le travail continue.",
      "Qualification acquise. Reste dans ton rythme.",
    ],
    quarterfinal: [
      "Direction les demi-finales. Continue à construire point après point.",
      "Le dernier carré est là. Garde la même exigence.",
    ],
    semifinal: [
      "Finale ! Savoure une seconde, puis remets le prochain point au centre.",
      "Une marche encore. Tout ce qui compte maintenant, c’est le prochain point.",
    ],
    final: [
      "Champion ! Le dernier point récompense tout le chemin parcouru.",
      "Victoire finale. Profite : celle-là, tu es allé la chercher.",
    ],
  },
  eliminated: {
    preliminary: [
      "Le tournoi s’arrête ici, pas le progrès. Chaque match nourrit le suivant.",
      "Une défaite ferme un tableau, jamais le chemin.",
    ],
    round_of_16: [
      "Ce résultat ne résume pas ton tournoi. Garde ce qui te fera avancer.",
      "Le tableau s’arrête, l’apprentissage continue.",
    ],
    quarterfinal: [
      "Tu étais dans les huit. Garde le parcours, analyse le match, puis avance.",
      "Les grandes victoires se construisent aussi avec les défaites bien utilisées.",
    ],
    semifinal: [
      "Le dernier carré reste un beau parcours. Transforme la frustration en prochain objectif.",
      "Si près de la finale : garde la preuve que tu peux revenir jusque-là.",
    ],
    final: [
      "Une finale perdue reste une finale gagnée en expérience. Le prochain défi commence ici.",
      "La déception passera. Le chemin jusqu’ici, lui, reste.",
    ],
  },
};

const stableIndex = (key: string, length: number) => {
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  }
  return hash % length;
};

export const getFinalStageEncouragement = ({
  round,
  state,
  stableKey,
}: {
  round: FinalStageRound;
  state: FinalStageEncouragementState;
  stableKey: string;
}) => {
  const pool = messages[state][round];
  return pool[stableIndex(`${round}:${state}:${stableKey}`, pool.length)];
};
