import { Handshake, ImagePlus, Shirt, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  clubMediaService,
  type ClubTvMedia,
  type ClubTvMediaKind,
} from "../services/clubMediaService";
import "./ClubMediaManager.css";

type MediaSection = {
  kind: ClubTvMediaKind;
  eyebrow: string;
  title: string;
  help: string;
};

const sections: MediaSection[] = [
  {
    kind: "shop",
    eyebrow: "Dotations",
    title: "Photos des vêtements",
    help: "Ajoutez les photos des tenues et équipements à mettre en avant sur l’écran Boutique.",
  },
  {
    kind: "partner",
    eyebrow: "Partenaires",
    title: "Logos et plaquettes",
    help: "Ajoutez des logos individuels ou une plaquette regroupant plusieurs partenaires.",
  },
];

export function ClubMediaManager() {
  const [media, setMedia] = useState<ClubTvMedia[]>([]);
  const [status, setStatus] = useState("");
  const [busyKind, setBusyKind] = useState<ClubTvMediaKind | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    clubMediaService
      .list()
      .then(setMedia)
      .catch(() =>
        setStatus(
          "Impossible de charger les médias du Mode TV. Vérifiez que la migration PR60 est appliquée.",
        ),
      );
  }, []);

  const byKind = useMemo(
    () => ({
      shop: media.filter((item) => item.kind === "shop"),
      partner: media.filter((item) => item.kind === "partner"),
    }),
    [media],
  );

  const upload = async (kind: ClubTvMediaKind, files: FileList | null) => {
    if (!files?.length) return;

    setBusyKind(kind);
    setStatus("");

    try {
      const uploaded: ClubTvMedia[] = [];
      for (const file of Array.from(files)) {
        uploaded.push(await clubMediaService.upload(kind, file));
      }
      setMedia((current) => [...current, ...uploaded]);
      setStatus(
        `${uploaded.length} image${uploaded.length > 1 ? "s" : ""} ajoutée${uploaded.length > 1 ? "s" : ""}.`,
      );
    } catch (error: unknown) {
      setStatus(
        error instanceof Error ? error.message : "Téléversement impossible.",
      );
    } finally {
      setBusyKind(null);
    }
  };

  const remove = async (item: ClubTvMedia) => {
    setDeletingId(item.id);
    setStatus("");

    try {
      await clubMediaService.remove(item);
      setMedia((current) =>
        current.filter((mediaItem) => mediaItem.id !== item.id),
      );
      setStatus("Image supprimée.");
    } catch (error: unknown) {
      setStatus(
        error instanceof Error ? error.message : "Suppression impossible.",
      );
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section className="club-media-manager club-form__wide">
      <header className="club-media-manager__header">
        <div>
          <p className="admin-page__eyebrow">Médias Mode TV</p>
          <h2>Dotations et partenaires</h2>
          <p>
            Images JPEG, PNG ou WebP, 8 Mo maximum par fichier. Les médias
            enregistrés ici alimentent automatiquement l’écran TV Boutique &
            partenaires.
          </p>
        </div>
        <ImagePlus aria-hidden="true" />
      </header>

      <div className="club-media-manager__sections">
        {sections.map((section) => {
          const items = byKind[section.kind];
          const Icon = section.kind === "shop" ? Shirt : Handshake;

          return (
            <article className="club-media-section" key={section.kind}>
              <header>
                <Icon aria-hidden="true" />
                <div>
                  <span>{section.eyebrow}</span>
                  <h3>{section.title}</h3>
                  <p>{section.help}</p>
                </div>
              </header>

              <label className="club-media-upload">
                <ImagePlus aria-hidden="true" />
                <span>
                  {busyKind === section.kind
                    ? "Téléversement…"
                    : "Ajouter des images"}
                </span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  disabled={busyKind !== null}
                  onChange={(event) => {
                    void upload(section.kind, event.target.files);
                    event.currentTarget.value = "";
                  }}
                />
              </label>

              {items.length === 0 ? (
                <p className="club-media-empty">Aucune image ajoutée.</p>
              ) : (
                <div className="club-media-grid">
                  {items.map((item) => (
                    <figure className="club-media-tile" key={item.id}>
                      <img src={item.publicUrl} alt={item.originalName} />
                      <figcaption title={item.originalName}>
                        {item.originalName}
                      </figcaption>
                      <button
                        type="button"
                        aria-label={`Supprimer ${item.originalName}`}
                        disabled={deletingId !== null}
                        onClick={() => void remove(item)}
                      >
                        <Trash2 aria-hidden="true" />
                      </button>
                    </figure>
                  ))}
                </div>
              )}
            </article>
          );
        })}
      </div>

      <p className="club-media-manager__status" role="status">
        {status}
      </p>
    </section>
  );
}
