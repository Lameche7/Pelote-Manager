import { ExternalLink, RadioTower, Video } from "lucide-react";
import type { ClubBroadcastSummary } from "@/features/admin/live/services/adminLiveSettingsService";

type Props = {
  broadcast: ClubBroadcastSummary;
};

export function PilotokiLiveLaunchAssistant({ broadcast }: Props) {
  return (
    <section
      className="admin-card admin-live-settings__launch-assistant"
      aria-label={`Régie de diffusion : ${broadcast.title}`}
    >
      <h3>
        <RadioTower aria-hidden="true" /> Régie de diffusion
      </h3>
      <p>
        <strong>{broadcast.title}</strong>
      </p>
      <p className="admin-live-settings__hint">
        Pilotoki prépare la fiche YouTube. La vidéo et le son passent
        actuellement par Upstream Live Studio : ces deux étapes restent
        manuelles et n'activent pas une caméra dans Pilotoki.
      </p>
      <ol>
        <li>
          Ouvrir Upstream et vérifier que la caméra du téléphone est connectée
          à la bonne diffusion.
        </li>
        <li>
          Vérifier dans la régie YouTube que la destination sélectionnée dans
          Upstream correspond bien à <strong>cette diffusion</strong>. Ne pas
          utiliser une autre clé de flux créée pour un autre direct.
        </li>
        <li>
          Attendre que YouTube affiche l'aperçu vidéo, puis déclencher
          volontairement « Passer au direct » dans YouTube Studio.
        </li>
        <li>
          Contrôler le résultat sur la page spectateur. À la fin, arrêter la
          diffusion dans YouTube puis dans Upstream.
        </li>
      </ol>
      <div className="admin-live-settings__launch-actions">
        <a
          href="https://studio.upstream.so/"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Video aria-hidden="true" /> Ouvrir Upstream <ExternalLink aria-hidden="true" />
        </a>
        <a
          href="https://studio.youtube.com/"
          target="_blank"
          rel="noopener noreferrer"
        >
          <RadioTower aria-hidden="true" /> Régie YouTube <ExternalLink aria-hidden="true" />
        </a>
        <a href={broadcast.youtubeUrl} target="_blank" rel="noopener noreferrer">
          Voir la page spectateur <ExternalLink aria-hidden="true" />
        </a>
      </div>
      <p className="admin-live-settings__hint">
        Important : ces liens ouvrent les régies existantes. Aucun bouton
        ci-dessus ne déclenche ni n'arrête un direct automatiquement.
      </p>
    </section>
  );
}
