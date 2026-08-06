import { useEffect, useMemo, useState } from "react";
import { Bell, BellRing, CheckCheck } from "lucide-react";
import { UserSpaceShell } from "@/features/user-space/components/UserSpaceShell";
import {
  notificationService,
  type MemberNotification,
} from "@/features/notifications/services/notificationService";
import "./NotificationsPage.css";

const priorityLabels = {
  normal: "Information",
  important: "Important",
  urgent: "Urgent",
} as const;

export function NotificationsPage() {
  const [notifications, setNotifications] = useState<MemberNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = async () => {
    setNotifications(await notificationService.listMyNotifications());
  };

  useEffect(() => {
    load()
      .catch((loadError: unknown) =>
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Chargement impossible.",
        ),
      )
      .finally(() => setLoading(false));
  }, []);

  const unreadCount = useMemo(
    () =>
      notifications.filter(
        (notification) => notification.isActive && !notification.readAt,
      ).length,
    [notifications],
  );

  const changeReadState = async (
    notification: MemberNotification,
    read: boolean,
  ) => {
    setSavingId(notification.deliveryId);
    setError("");
    try {
      await notificationService.markRead(notification.deliveryId, read);
      await load();
    } catch (changeError) {
      setError(
        changeError instanceof Error
          ? changeError.message
          : "Modification impossible.",
      );
    } finally {
      setSavingId(null);
    }
  };

  const markAllRead = async () => {
    const unread = notifications.filter(
      (notification) => notification.isActive && !notification.readAt,
    );
    if (unread.length === 0) return;
    setError("");
    try {
      for (const notification of unread) {
        setSavingId(notification.deliveryId);
        await notificationService.markRead(notification.deliveryId, true);
      }
      await load();
    } catch (changeError) {
      setError(
        changeError instanceof Error
          ? changeError.message
          : "Modification impossible.",
      );
    } finally {
      setSavingId(null);
    }
  };

  return (
    <UserSpaceShell>
      <section className="notifications-page" aria-labelledby="notifications-title">
        <header className="notifications-page__header">
          <div>
            <p className="notifications-page__eyebrow">Mon espace</p>
            <h1 id="notifications-title">Notifications</h1>
            <p>
              Retrouvez ici les messages publiés par le club à destination des
              licenciés.
            </p>
          </div>
          {unreadCount > 0 && (
            <button type="button" onClick={() => void markAllRead()}>
              <CheckCheck aria-hidden="true" /> Tout marquer comme lu
            </button>
          )}
        </header>

        {error && (
          <p className="notifications-page__error" role="alert">
            {error}
          </p>
        )}

        {loading ? (
          <p role="status">Chargement des notifications…</p>
        ) : notifications.length === 0 ? (
          <div className="notifications-page__empty">
            <Bell aria-hidden="true" />
            <h2>Aucun message pour le moment</h2>
            <p>Les communications du club apparaîtront automatiquement ici.</p>
          </div>
        ) : (
          <div className="notifications-page__list">
            {notifications.map((notification) => {
              const unread = notification.isActive && !notification.readAt;
              return (
                <article
                  className={`member-notification member-notification--${notification.priority}${unread ? " member-notification--unread" : ""}`}
                  key={notification.deliveryId}
                >
                  <div className="member-notification__icon">
                    {unread ? (
                      <BellRing aria-hidden="true" />
                    ) : (
                      <Bell aria-hidden="true" />
                    )}
                  </div>
                  <div className="member-notification__content">
                    <div className="member-notification__meta">
                      <span>{priorityLabels[notification.priority]}</span>
                      {!notification.isActive && (
                        <span className="member-notification__inactive">
                          Information terminée
                        </span>
                      )}
                      <time dateTime={notification.publishedAt}>
                        {new Date(notification.publishedAt).toLocaleString(
                          "fr-FR",
                        )}
                      </time>
                    </div>
                    <h2>{notification.title}</h2>
                    <p>{notification.body}</p>
                    {notification.expiresAt && notification.isActive && (
                      <small>
                        Valable jusqu’au{" "}
                        {new Date(notification.expiresAt).toLocaleString(
                          "fr-FR",
                        )}
                      </small>
                    )}
                  </div>
                  <div className="member-notification__action">
                    <button
                      type="button"
                      disabled={savingId === notification.deliveryId}
                      onClick={() =>
                        void changeReadState(notification, !notification.readAt)
                      }
                    >
                      {notification.readAt ? "Marquer non lue" : "Marquer lue"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </UserSpaceShell>
  );
}
