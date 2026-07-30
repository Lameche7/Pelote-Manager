import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { memberAdminService } from "../services/memberAdminService";
import type { MemberGender } from "../domain/memberRules";
export function MemberDetailPage() {
  const { memberId = "" } = useParams();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["admin-members", "detail", memberId],
    queryFn: () => memberAdminService.get(memberId),
    enabled: Boolean(memberId),
  });
  const [reason, setReason] = useState("");
  const mutation = useMutation({
    mutationFn: async (form: FormData) => {
      if (!query.data) return;
      const sensitive =
        String(form.get("birthDate")) !== query.data.birth_date ||
        String(form.get("gender")) !== query.data.gender;
      if (sensitive && !reason.trim())
        throw new Error(
          "Un motif est obligatoire pour cette modification sensible.",
        );
      await memberAdminService.update(
        memberId,
        {
          lastName: String(form.get("lastName")),
          firstName: String(form.get("firstName")),
          birthDate: String(form.get("birthDate")),
          gender: String(form.get("gender")) as MemberGender,
          email: String(form.get("email")),
          phone: String(form.get("phone")),
        },
        query.data.updated_at,
        reason,
      );
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ["admin-members"] }),
  });
  const correct = useMutation({
    mutationFn: (licence: string) => {
      if (!query.data || !reason.trim())
        throw new Error("Le motif est obligatoire.");
      return memberAdminService.correctLicence(
        memberId,
        licence,
        query.data.updated_at,
        reason,
      );
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ["admin-members"] }),
  });
  if (query.isLoading) return <p>Chargement de la fiche…</p>;
  if (query.error || !query.data)
    return <p role="alert">{query.error?.message ?? "Fiche introuvable."}</p>;
  const member = query.data;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    mutation.mutate(new FormData(event.currentTarget));
  };
  return (
    <section className="members-page">
      <header>
        <div>
          <p className="eyebrow">Fiche licencié · {member.club_name}</p>
          <h1>
            {member.first_name} {member.last_name}
          </h1>
          <p>
            Licence {member.licence_number} · compte{" "}
            {member.linked_account ? "lié" : "non lié"}
          </p>
        </div>
        {!member.canEdit && (
          <span className="pill muted">Lecture seule interclubs</span>
        )}
      </header>
      <form className="import-card" onSubmit={submit}>
        <div className="form-grid">
          <label>
            Nom
            <input
              name="lastName"
              defaultValue={member.last_name}
              disabled={!member.canEdit}
            />
          </label>
          <label>
            Prénom
            <input
              name="firstName"
              defaultValue={member.first_name}
              disabled={!member.canEdit}
            />
          </label>
          <label>
            Naissance
            <input
              name="birthDate"
              type="date"
              defaultValue={member.birth_date}
              disabled={!member.canEdit}
            />
          </label>
          <label>
            Sexe
            <select
              name="gender"
              defaultValue={member.gender}
              disabled={!member.canEdit}
            >
              <option value="male">Masculin</option>
              <option value="female">Féminin</option>
            </select>
          </label>
          <label>
            E-mail de contact
            <input
              name="email"
              type="email"
              defaultValue={member.email ?? ""}
              disabled={!member.canEdit}
            />
          </label>
          <label>
            Téléphone
            <input
              name="phone"
              defaultValue={member.phone ?? ""}
              disabled={!member.canEdit}
            />
          </label>
        </div>
        {member.canEdit && (
          <>
            <label>
              Motif pour une modification sensible
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <button disabled={mutation.isPending}>Enregistrer</button>
          </>
        )}
        {mutation.error && <p role="alert">{mutation.error.message}</p>}
      </form>
      {member.canEdit && (
        <div className="import-card">
          <h2>Correction du numéro de licence</h2>
          <p>Cette opération conserve la fiche et le compte lié.</p>
          <button
            onClick={() => {
              const licence = window.prompt(
                "Nouveau numéro de licence",
                member.licence_number,
              );
              if (
                licence &&
                window.confirm("Confirmer cette correction sensible ?")
              )
                correct.mutate(licence);
            }}
          >
            Corriger la licence
          </button>
          {correct.error && <p role="alert">{correct.error.message}</p>}
        </div>
      )}
      <div className="member-table">
        <table>
          <thead>
            <tr>
              <th>Saison</th>
              <th>Club représenté</th>
              <th>Classement</th>
              <th>Catégorie</th>
              <th>Licence</th>
            </tr>
          </thead>
          <tbody>
            {member.seasons.map((season) => (
              <tr key={season.id}>
                <td>{season.seasonName}</td>
                <td>{season.clubName}</td>
                <td>{season.ranking ?? "—"}</td>
                <td>{season.category}</td>
                <td>{season.isLicensed ? "Valide" : "Non valide"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
