import { useCallback, useEffect, useState } from "react";
import { Handshake, QrCode, ShoppingBag } from "lucide-react";
import {
  tvMediaService,
  type TvMedia,
} from "@/features/tv/services/tvMediaService";
import "./TvPromotionPanel.css";

const QR_ENDPOINT = "https://quickchart.io/qr";
const MAX_DOTATIONS = 6;
const MAX_PARTNERS = 8;

const emptyMedia: TvMedia = { dotations: [], partners: [] };

const buildQrImageUrl = (value: string) =>
  `${QR_ENDPOINT}?text=${encodeURIComponent(value)}&format=svg&size=280&margin=2&ecLevel=M`;

function ShopQrCard({ shopUrl }: { shopUrl: string }) {
  return (
    <div className="tv-display__qr-card">
      <div className="tv-display__qr-image">
        <img
          src={buildQrImageUrl(shopUrl)}
          alt="QR code — ouvrir la boutique"
          referrerPolicy="no-referrer"
        />
      </div>
      <div>
        <QrCode aria-hidden="true" />
        <strong>Ouvrir la boutique</strong>
        <span>Scannez pour découvrir les dotations 2026</span>
      </div>
    </div>
  );
}

export function TvPromotionPanel({
  token,
  refreshIntervalSeconds,
  shopUrl,
}: {
  token: string;
  refreshIntervalSeconds: number;
  shopUrl: string;
}) {
  const [media, setMedia] = useState<TvMedia>(emptyMedia);
  const [hasError, setHasError] = useState(false);

  const load = useCallback(async () => {
    try {
      setMedia(await tvMediaService.getMedia(token));
      setHasError(false);
    } catch {
      setHasError(true);
    }
  }, [token]);

  useEffect(() => {
    void load();
    const refresh = window.setInterval(
      () => void load(),
      refreshIntervalSeconds * 1_000,
    );
    return () => window.clearInterval(refresh);
  }, [load, refreshIntervalSeconds]);

  const dotations = media.dotations.slice(0, MAX_DOTATIONS);
  const partners = media.partners.slice(0, MAX_PARTNERS);

  return (
    <section
      className="tv-display__promotion tv-display__view"
      aria-label="Boutique et partenaires du club"
    >
      <div className="tv-display__promotion-main">
        <article className="tv-display__shop-panel">
          <div className="tv-display__shop-copy">
            <span className="tv-display__promotion-kicker">
              <ShoppingBag aria-hidden="true" /> Boutique du club
            </span>
            <h2>Dotations 2026</h2>
            <p>
              Retrouvez les tenues et équipements aux couleurs du Pelotaris Club
              Lourdais sur la boutique HelloAsso.
            </p>

            {dotations.length > 0 ? (
              <div className="tv-display__shop-gallery">
                {dotations.map((asset) => (
                  <figure key={asset.id}>
                    <img
                      src={asset.imageUrl}
                      alt={asset.label || "Dotation du club"}
                    />
                    {asset.label && <figcaption>{asset.label}</figcaption>}
                  </figure>
                ))}
              </div>
            ) : (
              <div className="tv-display__shop-highlights">
                <span>Textile club</span>
                <span>Équipements</span>
                <span>Idées cadeaux</span>
              </div>
            )}
          </div>

          <ShopQrCard shopUrl={shopUrl} />
        </article>

        <aside className="tv-display__partners-panel">
          <Handshake aria-hidden="true" />
          <span>Partenaires</span>
          <h2>Merci à ceux qui font vivre le club</h2>

          {partners.length > 0 ? (
            <div className="tv-display__partners-grid">
              {partners.map((asset) => (
                <figure key={asset.id}>
                  <img
                    src={asset.imageUrl}
                    alt={asset.label || "Partenaire du club"}
                  />
                  {asset.label && <figcaption>{asset.label}</figcaption>}
                </figure>
              ))}
            </div>
          ) : (
            <p>
              {hasError
                ? "Les logos partenaires sont momentanément indisponibles."
                : "Ajoutez les logos depuis Administration → Club → Informations."}
            </p>
          )}
        </aside>
      </div>
    </section>
  );
}
