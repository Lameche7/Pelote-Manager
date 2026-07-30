import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { memberAdminService } from "../services/memberAdminService";
export function GlobalMemberSearchPage() {
  const [search, setSearch] = useState("");
  const [active, setActive] = useState("");
  const [licensed, setLicensed] = useState("");
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ["members-global", search, active, licensed, page],
    queryFn: () =>
      memberAdminService.searchGlobal({
        search,
        page,
        page_size: 25,
        ...(active ? { active } : {}),
        ...(licensed ? { licensed } : {}),
      }),
    enabled: search.trim().length > 0,
  });
  const total = query.data?.[0]?.total_count ?? 0;
  return (
    <section className="members-page">
      <header>
        <div>
          <p className="eyebrow">Recherche interclubs</p>
          <h1>Annuaire global des licenciés</h1>
          <p>
            Accessible en lecture seule avec la gestion des membres ou des
            tournois.
          </p>
        </div>
      </header>
      <div className="member-filters">
        <label>
          Licence, nom ou prénom
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <label>
          Fiche
          <select value={active} onChange={(e) => setActive(e.target.value)}>
            <option value="">Toutes</option>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
        </label>
        <label>
          Licence saison
          <select
            value={licensed}
            onChange={(e) => setLicensed(e.target.value)}
          >
            <option value="">Toutes</option>
            <option value="true">Valide</option>
            <option value="false">Non valide</option>
          </select>
        </label>
      </div>
      {query.error ? (
        <p role="alert">{query.error.message}</p>
      ) : (
        <div className="member-table">
          <table>
            <thead>
              <tr>
                <th>Licence</th>
                <th>Identité</th>
                <th>Club actuel</th>
                <th>Classement</th>
                <th>Catégorie</th>
                <th>État</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {query.data?.map((member) => (
                <tr key={member.id}>
                  <td>{member.licence_number}</td>
                  <td>
                    {member.first_name} {member.last_name}
                  </td>
                  <td>{member.club_name}</td>
                  <td>{member.ranking ?? "—"}</td>
                  <td>{member.category ?? "—"}</td>
                  <td>
                    {member.is_active && member.is_licensed
                      ? "Licence valide"
                      : member.is_active
                        ? "Non licencié"
                        : "Inactive"}
                  </td>
                  <td>
                    <Link to={`/admin/membres/${member.id}`}>
                      Ouvrir la fiche
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!search.trim() && (
        <p className="empty">
          Saisissez une licence, un nom ou un prénom pour lancer la recherche
          interclubs.
        </p>
      )}
      <div className="members-actions">
        <button
          className="secondary"
          disabled={page === 1}
          onClick={() => setPage((p) => p - 1)}
        >
          Précédent
        </button>
        <span>
          Page {page} · {total} résultat(s)
        </span>
        <button
          className="secondary"
          disabled={page * 25 >= total}
          onClick={() => setPage((p) => p + 1)}
        >
          Suivant
        </button>
      </div>
    </section>
  );
}
