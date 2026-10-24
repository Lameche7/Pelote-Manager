import { useEffect, useState } from "react";
import { BellOff, BellRing, Download, Smartphone } from "lucide-react";
import {
  pushNotificationService,
  type PushNotificationState,
  type PushDevice,
} from "@/features/notifications/services/pushNotificationService";

export function PushNotificationSettings() {
  const [state, setState] = useState<PushNotificationState | null>(null);
  const [devices, setDevices] = useState<PushDevice[]>([]);
  const [currentEndpoint, setCurrentEndpoint] = useState<string | null>(null);
  const refreshDevices = async () => {
    const [items, current] = await Promise.all([
      pushNotificationService.listMyDevices(),
      pushNotificationService.currentEndpoint(),
    ]);
    setDevices(items);
    setCurrentEndpoint(current);
  };
  useEffect(() => {
    void refreshDevices().catch(() => undefined);
  }, []);
  const removeDevice = async (device: PushDevice) => {
    if (
      !window.confirm(
        "Désactiver les notifications pour cet ancien abonnement ?",
      )
    )
      return;
    setSaving(true);
    setError("");
    try {
      await pushNotificationService.deactivateDevice(device.id);
      await refreshDevices();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Désactivation impossible.",
      );
    } finally {
      setSaving(false);
    }
  };
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    pushNotificationService
      .getState()
      .then(setState)
      .catch(() => {
        setState({
          supported: false,
          configured: false,
          permission: "unsupported",
          subscribed: false,
          isIos: /iPad|iPhone|iPod/.test(navigator.userAgent),
          isStandalone: window.matchMedia("(display-mode: standalone)").matches,
        });
      })
      .finally(() => setLoading(false));
  }, []);

  const enable = async () => {
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const nextState = await pushNotificationService.enable();
      setState(nextState);
      setMessage("Notifications activées sur cet appareil.");
    } catch (enableError) {
      setError(
        enableError instanceof Error
          ? enableError.message
          : "Activation impossible.",
      );
    } finally {
      setSaving(false);
    }
  };

  const disable = async () => {
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const nextState = await pushNotificationService.disable();
      setState(nextState);
      setMessage("Notifications désactivées sur cet appareil.");
    } catch (disableError) {
      setError(
        disableError instanceof Error
          ? disableError.message
          : "Désactivation impossible.",
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading || !state) {
    return (
      <section className="push-settings" aria-labelledby="push-settings-title">
        <p role="status">Vérification des notifications de l’appareil…</p>
      </section>
    );
  }

  const iosNeedsInstall = state.isIos && !state.isStandalone;
  const permissionDenied = state.permission === "denied";

  return (
    <section className="push-settings" aria-labelledby="push-settings-title">
      <div className="push-settings__icon" aria-hidden="true">
        {state.subscribed ? <BellRing /> : <Smartphone />}
      </div>
      <div className="push-settings__content">
        <p className="push-settings__eyebrow">Notifications sur téléphone</p>
        <h2 id="push-settings-title">
          {state.subscribed
            ? "Notifications push activées"
            : "Recevoir les alertes sans ouvrir Pelote Manager"}
        </h2>

        {iosNeedsInstall ? (
          <p>
            Sur iPhone ou iPad, utilisez{" "}
            <strong>Partager → Sur l’écran d’accueil</strong>, puis ouvrez
            Pelote Manager depuis l’icône installée. Vous pourrez alors
            autoriser les notifications.
          </p>
        ) : !state.supported ? (
          <p>
            Ce navigateur ne prend pas en charge les notifications Web Push.
          </p>
        ) : !state.configured ? (
          <p>
            Le canal push est présent mais sa configuration serveur n’est pas
            encore terminée.
          </p>
        ) : state.subscribed ? (
          <p>
            Cet appareil recevra les créneaux libérés, informations du club et
            futures alertes Pelote Manager même lorsque l’application n’est pas
            ouverte.
          </p>
        ) : permissionDenied ? (
          <p>
            Les notifications sont bloquées. Réactivez-les dans les réglages du
            navigateur ou du téléphone pour Pelote Manager.
          </p>
        ) : (
          <p>
            Activez-les une fois sur cet appareil. Chaque téléphone, tablette ou
            ordinateur peut être enregistré séparément.
          </p>
        )}

        {!state.isStandalone && !state.isIos && (
          <p className="push-settings__install-hint">
            <Download aria-hidden="true" /> Vous pouvez aussi installer Pelote
            Manager depuis le menu de votre navigateur pour l’utiliser comme une
            application.
          </p>
        )}

        {devices.length > 0 && (
          <div>
            <h3>Mes abonnements Push actifs ({devices.length})</h3>
            <p>
              Conservez celui de ce navigateur. Supprimez uniquement les anciens
              abonnements que vous reconnaissez.
            </p>
            {devices.map((device) => (
              <div key={device.id}>
                <span>
                  {device.platform ?? "Appareil"} ·{" "}
                  {new Date(device.created_at).toLocaleDateString("fr-FR")}{" "}
                  {device.endpoint === currentEndpoint
                    ? "· Ce navigateur"
                    : "· Autre abonnement"}
                </span>{" "}
                {device.endpoint !== currentEndpoint && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void removeDevice(device)}
                  >
                    Désactiver
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {message && (
          <p className="push-settings__success" role="status">
            {message}
          </p>
        )}
        {error && (
          <p className="push-settings__error" role="alert">
            {error}
          </p>
        )}
      </div>

      <div className="push-settings__action">
        {state.subscribed ? (
          <button
            type="button"
            disabled={saving}
            onClick={() => void disable()}
          >
            <BellOff aria-hidden="true" />
            {saving ? "Désactivation…" : "Désactiver sur cet appareil"}
          </button>
        ) : (
          <button
            type="button"
            disabled={
              saving ||
              iosNeedsInstall ||
              !state.supported ||
              !state.configured ||
              permissionDenied
            }
            onClick={() => void enable()}
          >
            <BellRing aria-hidden="true" />
            {saving ? "Activation…" : "Activer les notifications"}
          </button>
        )}
      </div>
    </section>
  );
}
