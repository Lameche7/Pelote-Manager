import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  ImagePlus,
  Save,
  Trash2,
} from "lucide-react";
import {
  clubMediaService,
  type ClubMediaAsset,
  type ClubMediaKind,
} from "../services/clubMediaService";
import "./ClubMediaManager.css";

type MediaDrafts = Record<ClubMediaKind, string>;
type MediaLists = Record<ClubMediaKind, ClubMediaAsset[]>;

const emptyLists: MediaLists = { dotation: [], partner: [] };
const emptyDrafts: MediaDrafts = { dotation: "", partner: "" };

const sections: Array<{
  kind: ClubMediaKind;
  eyebrow: string;
  title: string;
  description: string;
  labelPlaceholder: string;
}> = [
  {
    kind: "dotation",
    eyebrow: "Boutique",
    title: "Photos des dotations",
    description:
      "Ajoutez les vêtements et équipements à mettre en avant sur l’écran TV Boutique & partenaires.",
    labelPlaceholder: "Ex. Sweat adulte",
  },
  {
    kind: "partner",
    eyebrow: "Partenaires",
    title: "Logos partenaires",
    description:
      "Ajoutez les logos qui composeront automatiquement la plaquette partenaires sur l’écran TV.",
    labelPlaceholder: "Ex. Nom du partenaire",
  },
];

export function ClubMediaManager() {
  const [lists, setLists] = useState<MediaLists>(emptyLists);
  const [drafts, setDrafts] = useState<MediaDrafts>(emptyDrafts);
  const [isLoading, setIsLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  const load = useCallback(async () => {
    const [dotation, partner] = await Promise.all([
      clubMediaService.list("dotation"),
      clubMediaService.list("partner"),
    ]);
    setLists({ dotation, partner });
  }, []);

  useEffect(() => {
    load()
      .catch(() => setStatus("Impossible de charger les médias du club."))
      .finally(() => setIsLoading(false));
  }, [load]);

  const replaceAsset = (kind: ClubMediaKind, nextAsset: ClubMediaAsset) => {
    setLists((current) => ({
      ...current,
      [kind]: current[kind].map((asset) =>
        asset.id === nextAsset.id ? nextAsset : asset,
      ),
    }));
  };

  const runAction = async (key: string, action: () => Promise<void>) => {
    setBusyKey(key);
    setStatus("");
    try {
      await action();
      await load();
    } catch (error: unknown) {
      setStatus(
        error instanceof Error ? error.message : "Opération impossible.",
      );
    } finally {
      setBusyKey(null);
    }
  };

  const upload = async (
    kind: ClubMediaKind,
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    await runAction(`upload-${kind}`, async () => {
      await clubMediaService.upload(kind, file, drafts[kind]);
      setDrafts((current) => ({ ...current, [kind]: "" }));
      setStatus("Image ajoutée. Elle est immédiatement disponible pour la TV.");
    });
  };

  const saveLabel = async (asset: ClubMediaAsset) => {
    await runAction(`label-${asset.id}`, async () => {
      await clubMediaService.update(asset, { label: asset.label });
      setStatus("Libellé enregistré.");
    });
  };

  const toggle = async (asset: ClubMediaAsset) => {
    await runAction(`toggle-${asset.id}`, async () => {
      await clubMediaService.update(asset, { isActive: !asset.isActive });
      setStatus(asset.isActive ? "Image masquée de la TV." : "Image visible sur la TV.");
    });
  };

  const move = async (
    kind: ClubMediaKind,
    asset: ClubMediaAsset,
    direction: -1 | 1,
  ) => {
    const current = lists[kind];
    const index = current.findIndex((item) => item.id === asset.id);
    const neighbour = current[index + direction];
    if (!neighbour) return;

    const nextOrder =
      direction < 0 ? neighbour.sortOrder - 1 : neighbour.sortOrder + 1;

    await runAction(`move-${asset.id}`, async () => {
      await clubMediaService.update(asset, { sortOrder: nextOrder });
      setStatus("Ordre d’affichage mis à jour.");
    });
  };

  const remove = async (asset: ClubMediaAsset) => {
    if (!window.confirm("Supprimer définitivement cette image ?")) return;
    await runAction(`delete-${asset.id}`, async () => {
      await clubMediaService.remove(asset);
      setStatus("Image supprimée.");
    });
  };

  if (isLoading) {
    return <div className="admin-card club-media-manager">Chargement des médias…</div>;
  }

  return (
    <div className="club-media-manager">
      <header className="club-media-manager__header">
        <div>
          <p className="admin-page__eyebrow">Médiathèque</p>
          <h2>Images affichées sur le Mode TV</h2>
          <p>
            JPEG, PNG ou WebP, 8 Mo maximum. Les médias restent isolés dans le
            dossier de ce club.
          </p>
        </div>
        <span role="status">{status}</span>
      </header>

      {sections.map((section) => {
        const assets = lists[section.kind];
        return (
          <section className="admin-card club-media-section" key={section.kind}>
            <header>
              <div>
                <p className="admin-page__eyebrow">{section.eyebrow}</p>
                <h3>{section.title}</h3>
                <p>{section.description}</p>
              </div>
              <span>{assets.length} image{assets.length > 1 ? "s" : ""}</span>
            </header>

            <div className="club-media-upload">
              <label>
                Libellé facultatif
                <input
                  type="text"
                  maxLength={120}
                  placeholder={section.labelPlaceholder}
                  value={drafts[section.kind]}
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      [section.kind]: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="club-media-upload__file">
                <ImagePlus aria-hidden="true" />
                {busyKey === `upload-${section.kind}`
                  ? "Téléversement…"
                  : "Ajouter une image"}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={busyKey !== null}
                  onChange={(event) => void upload(section.kind, event)}
                />
              </label>
            </div>

            {assets.length === 0 ? (
              <p className="club-media-empty">
                Aucune image pour le moment. L’écran TV conserve son affichage
                de secours tant que cette galerie est vide.
              </p>
            ) : (
              <div className="club-media-grid">
                {assets.map((asset, index) => (
                  <article
                    className={`club-media-card${asset.isActive ? "" : " club-media-card--inactive"}`}
                    key={asset.id}
                  >
                    <div className="club-media-card__preview">
                      <img src={asset.imageUrl} alt={asset.label || ""} />
                      <span>{asset.isActive ? "Visible TV" : "Masqué"}</span>
                    </div>

                    <div className="club-media-card__body">
                      <label>
                        Libellé
                        <input
                          type="text"
                          maxLength={120}
                          value={asset.label}
                          onChange={(event) =>
                            replaceAsset(section.kind, {
                              ...asset,
                              label: event.target.value,
                            })
                          }
                        />
                      </label>

                      <div className="club-media-card__actions">
                        <button
                          type="button"
                          title="Enregistrer le libellé"
                          disabled={busyKey !== null}
                          onClick={() => void saveLabel(asset)}
                        >
                          <Save aria-hidden="true" />
                          Enregistrer
                        </button>
                        <button
                          type="button"
                          disabled={busyKey !== null}
                          onClick={() => void toggle(asset)}
                        >
                          {asset.isActive ? (
                            <EyeOff aria-hidden="true" />
                          ) : (
                            <Eye aria-hidden="true" />
                          )}
                          {asset.isActive ? "Masquer" : "Afficher"}
                        </button>
                        <button
                          type="button"
                          title="Monter"
                          disabled={busyKey !== null || index === 0}
                          onClick={() => void move(section.kind, asset, -1)}
                        >
                          <ArrowUp aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          title="Descendre"
                          disabled={busyKey !== null || index === assets.length - 1}
                          onClick={() => void move(section.kind, asset, 1)}
                        >
                          <ArrowDown aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="club-media-card__delete"
                          disabled={busyKey !== null}
                          onClick={() => void remove(asset)}
                        >
                          <Trash2 aria-hidden="true" />
                          Supprimer
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
