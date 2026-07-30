import { useMemo, useState, type FormEvent } from "react";
import {
  useAdminMembers,
  useCreateMember,
  useSetMemberActive,
} from "../hooks/useAdminMembers";
import type { MemberGender } from "../domain/memberRules";
import type { AdminMember } from "../types";
import { SensitiveActionDialog } from "../components/SensitiveActionDialog";
import "./AdminMembersPage.css";
export function AdminMembersPage() {
  const [search, setSearch] = useState("");
  const [active, setActive] = useState("all");
  const [licensed, setLicensed] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [activeAction, setActiveAction] = useState<AdminMember>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const filters = useMemo(
    () => ({ search, active, licensed, page, page_size: pageSize }),
    [search, active, licensed, page, pageSize],
  );
  const query = useAdminMembers(filters);
  const create = useCreateMember();
  const activation = useSetMemberActive();
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    create.mutate(
      {
        licenceNumber: String(form.get("licence")),
        lastName: String(form.get("lastName")),
        firstName: String(form.get("firstName")),
        birthDate: String(form.get("birthDate")),
        gender: String(form.get("gender")) as MemberGender,
        email: String(form.get("email") || ""),
        phone: String(form.get("phone") || ""),
        ranking: String(form.get("ranking") || ""),
      },
      { onSuccess: () => setShowForm(false) },
    );
  };
  return (
    <section className="members-page">
      <header>
        <div>
          <p className="eyebrow">Registre du club</p>
          <h1>Licenciés</h1>
          <p>Identité durable, licence de la saison active et compte lié.</p>
        </div>
        <div className="members-actions">
          <a
            className="button secondary"
            href="/admin/membres/recherche-globale"
          >
            Recherche interclubs
          </a>
          <a className="button secondary" href="/admin/membres/imports">
            Historique des imports
          </a>
          <a className="button secondary" href="/admin/membres/importer">
            Importer un CSV
          </a>
          <button onClick={() => setShowForm(true)}>Ajouter un licencié</button>
        </div>
      </header>
      <div className="member-filters">
        <label>
          Rechercher
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Licence, nom ou prénom"
          />
        </label>
        <label>
          État
          <select value={active} onChange={(e) => setActive(e.target.value)}>
            <option value="all">Tous</option>
            <option value="true">Actifs</option>
            <option value="false">Inactifs</option>
          </select>
        </label>
        <label>
          Licence saison
          <select
            value={licensed}
            onChange={(e) => setLicensed(e.target.value)}
          >
            <option value="all">Toutes</option>
            <option value="true">Valide</option>
            <option value="false">Non valide</option>
          </select>
        </label>
      </div>
      {query.isLoading ? (
        <p role="status">Chargement des licenciés…</p>
      ) : query.error ? (
        <p role="alert">{query.error.message}</p>
      ) : (
        <div className="member-table">
          <table>
            <thead>
              <tr>
                <th>Licence</th>
                <th>Licencié</th>
                <th>Naissance</th>
                <th>Sexe</th>
                <th>Contact</th>
                <th>Catégorie</th>
                <th>Classement</th>
                <th>Statut</th>
                <th>Compte</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {query.data?.map((member) => (
                <tr key={member.id}>
                  <td>
                    <strong>{member.licence_number}</strong>
                  </td>
                  <td>
                    {member.first_name} {member.last_name}
                  </td>
                  <td>
                    {member.birth_date
                      ? new Date(member.birth_date).toLocaleDateString("fr-FR")
                      : "—"}
                  </td>
                  <td>{member.gender === "male" ? "Masculin" : "Féminin"}</td>
                  <td>{member.email ?? member.phone ?? "—"}</td>
                  <td>{member.category ?? "—"}</td>
                  <td>{member.ranking ?? "—"}</td>
                  <td>
                    <span
                      className={`pill ${member.is_active && member.is_licensed ? "ok" : "muted"}`}
                    >
                      {!member.is_active
                        ? "Fiche inactive"
                        : member.is_licensed
                          ? "Licence valide"
                          : "Non licencié"}
                    </span>
                  </td>
                  <td>{member.linked_account ? "Lié" : "Non lié"}</td>
                  <td>
                    <a href={`/admin/membres/${member.id}`}>Consulter</a>{" "}
                    <button
                      className="link-button"
                      onClick={() => setActiveAction(member)}
                    >
                      {member.is_active ? "Désactiver" : "Réactiver"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {query.data?.length === 0 && (
            <p className="empty">Aucun licencié ne correspond aux filtres.</p>
          )}
          <div className="members-actions">
            <button
              className="secondary"
              disabled={page === 1}
              onClick={() => setPage((value) => value - 1)}
            >
              Précédent
            </button>
            <span>
              Page {page} · {query.data?.[0]?.total_count ?? 0} résultat(s)
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
              disabled={page * pageSize >= (query.data?.[0]?.total_count ?? 0)}
              onClick={() => setPage((value) => value + 1)}
            >
              Suivant
            </button>
          </div>
        </div>
      )}
      {showForm && (
        <div className="dialog-backdrop" role="presentation">
          <form className="member-dialog" onSubmit={submit}>
            <h2>Ajouter un licencié</h2>
            <p>La catégorie sera calculée pour la saison active.</p>
            <div className="form-grid">
              <label>
                Numéro de licence
                <input name="licence" required />
              </label>
              <label>
                Nom
                <input name="lastName" required />
              </label>
              <label>
                Prénom
                <input name="firstName" required />
              </label>
              <label>
                Date de naissance
                <input
                  name="birthDate"
                  type="date"
                  max={new Date().toISOString().slice(0, 10)}
                  required
                />
              </label>
              <label>
                Sexe
                <select name="gender" required>
                  <option value="male">Masculin</option>
                  <option value="female">Féminin</option>
                </select>
              </label>
              <label>
                Classement
                <input name="ranking" />
              </label>
              <label>
                E-mail de contact
                <input name="email" type="email" />
              </label>
              <label>
                Téléphone
                <input name="phone" />
              </label>
            </div>
            {create.error && <p role="alert">{create.error.message}</p>}
            <footer>
              <button
                type="button"
                className="secondary"
                onClick={() => setShowForm(false)}
              >
                Annuler
              </button>
              <button disabled={create.isPending}>Créer</button>
            </footer>
          </form>
        </div>
      )}
      {activeAction && (
        <SensitiveActionDialog
          title={
            activeAction.is_active
              ? "Désactiver le licencié"
              : "Réactiver le licencié"
          }
          summary={`${activeAction.first_name} ${activeAction.last_name} · licence ${activeAction.licence_number}. Les saisons et le compte lié seront conservés.`}
          confirmLabel={activeAction.is_active ? "Désactiver" : "Réactiver"}
          pending={activation.isPending}
          error={activation.error?.message}
          onCancel={() => setActiveAction(undefined)}
          onConfirm={(reason) =>
            activation.mutate(
              {
                id: activeAction.id,
                active: !activeAction.is_active,
                updatedAt: activeAction.updated_at,
                reason,
              },
              { onSuccess: () => setActiveAction(undefined) },
            )
          }
        />
      )}
    </section>
  );
}
