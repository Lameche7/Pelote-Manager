import { supabase } from "@/infrastructure/supabase/client";
import { getSupabaseErrorMessage } from "@/infrastructure/supabase/errorMessages";

export type PushPermissionState = NotificationPermission | "unsupported";

export type PushNotificationState = {
  supported: boolean;
  configured: boolean;
  permission: PushPermissionState;
  subscribed: boolean;
  isIos: boolean;
  isStandalone: boolean;
};

type PushConfigResponse = {
  enabled?: boolean;
  publicKey?: string | null;
};

function isIosDevice(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

function isStandaloneMode(): boolean {
  const standaloneNavigator = navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    standaloneNavigator.standalone === true
  );
}

function platformLabel(): string {
  if (isIosDevice()) return "ios";
  if (/Android/i.test(navigator.userAgent)) return "android";
  return "desktop";
}

function urlBase64ToArrayBuffer(value: string): ArrayBuffer {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index);
  }
  return bytes.buffer;
}

async function getRegistration(): Promise<ServiceWorkerRegistration> {
  if (!("serviceWorker" in navigator)) {
    throw new Error(
      "Les notifications push ne sont pas prises en charge par ce navigateur.",
    );
  }

  return navigator.serviceWorker.ready;
}

async function getExistingRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration()) ?? null;
}

async function loadPushConfig(): Promise<PushConfigResponse> {
  const { data, error } = await supabase.functions.invoke("push-config");
  if (error) {
    throw new Error(
      getSupabaseErrorMessage(
        error,
        "La configuration des notifications push est indisponible.",
      ),
    );
  }
  return (data ?? {}) as PushConfigResponse;
}

async function registerSubscription(
  subscription: PushSubscription,
): Promise<void> {
  const serialized = subscription.toJSON();
  const p256dh = serialized.keys?.p256dh;
  const auth = serialized.keys?.auth;

  if (!p256dh || !auth) {
    throw new Error(
      "L’abonnement push fourni par le navigateur est incomplet.",
    );
  }

  const { error } = await supabase.rpc("register_push_subscription", {
    target_endpoint: subscription.endpoint,
    target_p256dh: p256dh,
    target_auth: auth,
    target_user_agent: navigator.userAgent,
    target_platform: platformLabel(),
  });

  if (error) {
    throw new Error(
      getSupabaseErrorMessage(
        error,
        "L’appareil n’a pas pu être enregistré pour les notifications.",
      ),
    );
  }
}

async function disableRegisteredSubscription(
  subscription: PushSubscription,
): Promise<void> {
  const { error } = await supabase.rpc("disable_push_subscription", {
    target_endpoint: subscription.endpoint,
  });
  if (error) {
    throw new Error(
      getSupabaseErrorMessage(
        error,
        "Les notifications n’ont pas pu être désactivées pour cet appareil.",
      ),
    );
  }
}

function browserSupportsPush(): boolean {
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export const pushNotificationService = {
  async syncExistingSubscription(): Promise<void> {
    if (!browserSupportsPush() || Notification.permission !== "granted") return;
    const registration = await getExistingRegistration();
    if (!registration) return;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) await registerSubscription(subscription);
  },

  async disableForLogout(): Promise<void> {
    if (!browserSupportsPush()) return;
    const registration = await getExistingRegistration();
    if (!registration) return;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return;
    await disableRegisteredSubscription(subscription);
  },

  async getState(): Promise<PushNotificationState> {
    const supported = browserSupportsPush();
    const isIos = isIosDevice();
    const isStandalone = isStandaloneMode();

    if (!supported) {
      return {
        supported: false,
        configured: false,
        permission: "unsupported",
        subscribed: false,
        isIos,
        isStandalone,
      };
    }

    let configured = false;
    try {
      const config = await loadPushConfig();
      configured = Boolean(config.enabled && config.publicKey);
    } catch {
      configured = false;
    }

    const registration = await getRegistration();
    const subscription = await registration.pushManager.getSubscription();

    if (subscription && Notification.permission === "granted") {
      try {
        await registerSubscription(subscription);
      } catch {
        // La synchronisation sera retentée lors de la prochaine ouverture.
      }
    }

    return {
      supported: true,
      configured,
      permission: Notification.permission,
      subscribed: Boolean(subscription),
      isIos,
      isStandalone,
    };
  },

  async enable(): Promise<PushNotificationState> {
    if (!browserSupportsPush()) {
      throw new Error(
        "Les notifications push ne sont pas prises en charge par ce navigateur.",
      );
    }

    if (isIosDevice() && !isStandaloneMode()) {
      throw new Error(
        "Sur iPhone ou iPad, ajoutez d’abord Pelote Manager à l’écran d’accueil puis ouvrez-le depuis son icône.",
      );
    }

    const config = await loadPushConfig();
    if (!config.enabled || !config.publicKey) {
      throw new Error(
        "Les notifications push ne sont pas encore configurées sur Pelote Manager.",
      );
    }

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      throw new Error(
        permission === "denied"
          ? "Les notifications sont bloquées dans les réglages du navigateur."
          : "L’autorisation de notifications n’a pas été accordée.",
      );
    }

    const registration = await getRegistration();
    let subscription = await registration.pushManager.getSubscription();
    let created = false;

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToArrayBuffer(config.publicKey),
      });
      created = true;
    }

    try {
      await registerSubscription(subscription);
    } catch (error) {
      if (created) await subscription.unsubscribe();
      throw error;
    }

    return this.getState();
  },

  async disable(): Promise<PushNotificationState> {
    if (!browserSupportsPush()) return this.getState();

    const registration = await getRegistration();
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return this.getState();

    await disableRegisteredSubscription(subscription);
    await subscription.unsubscribe();
    return this.getState();
  },
};
