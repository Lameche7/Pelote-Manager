import { useMemo, useState } from "react";
import {
  useLinkUnlicensedProfile,
  usePreviewProfileLicenceLink,
  useUnlicensedPilotokiUsers,
} from "../hooks/useAdminMembers";
import type {
  AdminLicenceLinkPreview,
  AdminUnlicensedPilotokiUser,
} from "../types";
import "./AdminMembersPage.css";

const statusLabels: Record<AdminUnlicensedPilotokiUser["status"], string> = {
  unlinked: "Compte non rattaché",
  member_inactive: "Fiche licencié inactive",
  unlicensed: "Licence non active",
};

const displayName = (user: AdminUnlicensedPilotokiUser) => {
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ");
  return fullName || user.display_name || "Utilisateur PILOTOKI";
};

const previewLabel = (preview: AdminLicenceLinkPreview) => {
  if (preview.foundInClub) return "Licence retrouvée dans le registre du club";
  if (preview.foundGlobally) return "Identité sportive PILOTOKI retrouvée";
  return "Licence encore inconnue de PILOTOKI";
};

export function AdminUnlicensedPilotokiUsersPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selectedUser, setSelectedUser] =
    useState<AdminUnlicensedPilotokiUser | null>(null);
  const [licenceNumber, setLicenceNumber] = useState("");
  const [affiliationType, setAffiliationType] = useState<
    "primary" | "extension"
  >("primary");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [gender, setGender] = useState<"" | "male" | "female">("");
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const filters = useMemo(
    () => ({ search, page, page_size: pageSize }),
    [page, pageSize, search],
  );
  const query = useUnlicensedPilotokiUsers(filters);
  const previewMutation = usePreviewProfileLicenceLink();
  const linkMutation = useLinkUnlicensedProfile();
  const preview = previewMutation.data;
  const total = query.data?.[0]?.total_count ?? 0;

  const closeDialog = () => {
    setSelectedUser(null);
    setLicenceNumber("");
    setAffiliationType("primary");
    setFirstName("");
    setLastName("");
    setBirthDate("");
    setGender("");
    previewMutation.reset();
    linkMutation.reset();
  };

  const openDialog = (user: AdminUnlicensedPilotokiUser) => {
    previewMutation.reset();
    linkMutation.reset();
    setSuccessMessage(null);
    setSelectedUser(user);
    setLicenceNumber(user.licence_number ?? "");
    setAffiliationType("primary");
    setFirstName(user.first_name ?? "");
    setLastName(user.last_name ?? "");
    setBirthDate("");
    setGender("");
  };

  const verifyLicence = async () => {
    if (!selectedUser || !licenceNumber.trim()) return;

    try {
      const result = await previewMutation.mutateAsync({
        profileId: selectedUser.id,
        licenceNumber,
      });
      setLicenceNumber(result.licenceNumber);
      setFirstName(result.firstName ?? selectedUser.first_name ?? "");
      setLastName(result.lastName ?? selectedUser.last_name ?? "");
      setBirthDate(result.birthDate ?? "");
      setGender(
        result.gender === "male" || result.gender === "female"
          ? result.gender
          : "",
      );
      if (
        result.affiliationType === "primary" ||
        result.affiliationType === "extension"
      ) {
        setAffiliationType(result.affiliationType);
      } else if (
        result.otherAffiliations.some(
          (affiliation) => affiliation.affiliationType === "primary",
        )
      ) {
        setAffiliationType("extension");
      }
    } catch {
      // L'erreur est affichée par la mutation.
    }
  };

  const linkAccount = async () => {
    if (!selectedUser || !preview || preview.linkedToAnotherAccount) return;

    try {
      await linkMutation.mutateAsync({
        profileId: selectedUser.id,
        licenceNumber,
        affiliationType,
        firstName: firstName || undefined,
        lastName: lastName || undefined,
        birthDate: birthDate || undefined,
        gender: gender || undefined,
      });
      setSuccessMessage(
        `${displayName(selectedUser)} est maintenant rattaché à la licence ${preview.licenceNumber}.`,
      );
      closeDialog();
    } catch {
      // L'erreur est affichée par la mutation.
    }
  };

  return (
    <section className="members-page">
      <header>
        <div>
          <p className="eyebrow">Comptes PILOTOKI du club</p>
          <h1>Inscrits sans licence</h1>
          <p>
            Comptes créés dans PILOTOKI qui ne disposent pas d’une licence
            valide pour la saison active du club.
          </p>
        </div>
      </header>

      {successMessage && (
        <p className="member-link-success" role="status">
          {successMessage}
        </p>
      )}

      <div className="member-filters">
        <label>
          Rechercher
          <input
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Nom, prénom ou e-mail"
          />
        </label>
      </div>

      {query.isLoading ? (
        <p role="status">Chargement des inscrits…</p>
      ) : query.error ? (
        <p role="alert">{query.error.message}</p>
      ) : (
        <div className="member-table">
          <table>
            <thead>
              <tr>
                <th>Utilisateur</th>
                <th>E-mail</th>
                <th>Inscription PILOTOKI</th>
                <th>Situation</th>
                <th>Licence connue</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {query.data?.map((user) => (
                <tr key={user.id}>
                  <td>
                    <strong>{displayName(user)}</strong>
                  </td>
                  <td>{user.email || "—"}</td>
                  <td>
                    {new Date(user.created_at).toLocaleDateString("fr-FR")}
                  </td>
                  <td>
                    <span className="pill muted">
                      {statusLabels[user.status]}
                    </span>
                  </td>
                  <td>{user.licence_number || "—"}</td>
                  <td>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => openDialog(user)}
                    >
                      Rattacher
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {query.data?.length === 0 && (
            <p className="empty">
              Aucun inscrit sans licence ne correspond à la recherche.
            </p>
          )}

          <div className="members-actions member-pagination">
            <button
              className="secondary"
              disabled={page === 1}
              onClick={() => setPage((value) => value - 1)}
            >
              Précédent
            </button>
            <span>
              Page {page} · {total} résultat{total > 1 ? "s" : ""}
            </span>
            <select
              aria-label="Taille de page"
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setPage(1);
              }}
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
            <button
              className="secondary"
              disabled={page * pageSize >= total}
              onClick={() => setPage((value) => value + 1)}
            >
              Suivant
            </button>
          </div>
        </div>
      )}

      {selectedUser && (
        <div className="dialog-backdrop" role="presentation">
          <div
            className="member-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="licence-link-title"
          >
            <h2 id="licence-link-title">
              Rattacher {displayName(selectedUser)}
            </h2>
            <p>
              Vérifie d’abord le numéro de licence. Aucun rattachement n’est
              fait avant la validation finale.
            </p>

            <div className="form-grid">
              <label>
                Numéro de licence
                <input
                  inputMode="numeric"
                  value={licenceNumber}
                  onChange={(event) => {
                    setLicenceNumber(event.target.value);
                    previewMutation.reset();
                  }}
                  placeholder="Ex. 012345"
                />
              </label>
              <label>
                Type d’affiliation
                <select
                  value={affiliationType}
                  onChange={(event) =>
                    setAffiliationType(
                      event.target.value as "primary" | "extension",
                    )
                  }
                >
                  <option value="primary">Licence au club</option>
                  <option value="extension">
                    Extension depuis un autre club
                  </option>
                </select>
              </label>
            </div>

            <div className="member-link-verify">
              <button
                type="button"
                className="secondary"
                disabled={!licenceNumber.trim() || previewMutation.isPending}
                onClick={() => void verifyLicence()}
              >
                {previewMutation.isPending
                  ? "Vérification…"
                  : "Vérifier la licence"}
              </button>
            </div>

            {previewMutation.error && (
              <p className="member-link-error" role="alert">
                {previewMutation.error.message}
              </p>
            )}

            {preview && (
              <div className="member-link-preview">
                <strong>{previewLabel(preview)}</strong>
                <p>
                  Licence <strong>{preview.licenceNumber}</strong>
                  {preview.firstName || preview.lastName
                    ? ` · ${[preview.firstName, preview.lastName]
                        .filter(Boolean)
                        .join(" ")}`
                    : ""}
                </p>
                {preview.foundInClub && (
                  <p>
                    Fiche club {preview.memberActive ? "active" : "inactive"} ·
                    saison actuelle{" "}
                    {preview.licensedThisSeason ? "licenciée" : "non licenciée"}
                  </p>
                )}
                {preview.otherAffiliations.length > 0 && (
                  <p>
                    Autre affiliation connue :{" "}
                    {preview.otherAffiliations
                      .map(
                        (affiliation) =>
                          `${affiliation.clubName} (${affiliation.affiliationType})`,
                      )
                      .join(", ")}
                  </p>
                )}
                {preview.linkedToAnotherAccount && (
                  <p className="member-link-error" role="alert">
                    Cette licence est déjà rattachée à un autre compte PILOTOKI.
                  </p>
                )}
              </div>
            )}

            {preview && !preview.foundInClub && (
              <div className="form-grid member-link-identity">
                <label>
                  Prénom
                  <input
                    value={firstName}
                    onChange={(event) => setFirstName(event.target.value)}
                  />
                </label>
                <label>
                  Nom
                  <input
                    value={lastName}
                    onChange={(event) => setLastName(event.target.value)}
                  />
                </label>
                <label>
                  Date de naissance
                  <input
                    type="date"
                    value={birthDate}
                    onChange={(event) => setBirthDate(event.target.value)}
                  />
                </label>
                <label>
                  Sexe
                  <select
                    value={gender}
                    onChange={(event) =>
                      setGender(event.target.value as "" | "male" | "female")
                    }
                  >
                    <option value="">Choisir</option>
                    <option value="female">Féminin</option>
                    <option value="male">Masculin</option>
                  </select>
                </label>
              </div>
            )}

            {linkMutation.error && (
              <p className="member-link-error" role="alert">
                {linkMutation.error.message}
              </p>
            )}

            <footer>
              <button type="button" className="secondary" onClick={closeDialog}>
                Annuler
              </button>
              <button
                type="button"
                disabled={
                  !preview ||
                  preview.linkedToAnotherAccount ||
                  linkMutation.isPending
                }
                onClick={() => void linkAccount()}
              >
                {linkMutation.isPending
                  ? "Rattachement…"
                  : affiliationType === "primary"
                    ? "Rattacher comme licence au club"
                    : "Rattacher comme extension"}
              </button>
            </footer>
          </div>
        </div>
      )}
    </section>
  );
}
