import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { memberAdminService } from "../services/memberAdminService";
import type { MemberGender } from "../domain/memberRules";
import { SensitiveActionDialog } from "../components/SensitiveActionDialog";
import { MemberSeasonDialog } from "../components/MemberSeasonDialog";
import { useUpdateMemberSeason } from "../hooks/useAdminMembers";
import type { MemberSeason } from "../types";
export function MemberDetailPage() {
  const { memberId = "" } = useParams();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["admin-members", "detail", memberId],
    queryFn: () => memberAdminService.get(memberId),
    enabled: Boolean(memberId),
  });
  const [reason, setReason] = useState("");
  const [correctingLicence, setCorrectingLicence] = useState<string>();
  const [editingSeason, setEditingSeason] = useState<MemberSeason>();
  const seasonMutation = useUpdateMemberSeason(memberId);
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
          ranking: String(form.get("ranking")),
          confirmedSensitive: form.get("confirmedSensitive") === "on",
        },
        query.data.updated_at,
        reason,
      );
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ["admin-members"] }),
  });
  const correct = useMutation({
    mutationFn: ({
      licence,
      correctionReason,
    }: {
      licence: string;
      correctionReason: string;
    }) => {
      if (!query.data) throw new Error("Fiche indisponible.");
      return memberAdminService.correctLicence(
        memberId,
        licence,
        query.data.updated_at,
        correctionReason,
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
            Classement de la saison active
            <input
              name="ranking"
              defaultValue={member.ranking ?? ""}
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
              defaultValue={member.birth_date ?? ""}
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
            <label>
              <input name="confirmedSensitive" type="checkbox" /> Je confirme
              les changements sensibles éventuels.
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
              setCorrectingLicence(member.licence_number);
            }}
          >
            Corriger la licence
          </button>
          {correct.error && <p role="alert">{correct.error.message}</p>}
        </div>
      )}
      {correctingLicence !== undefined && (
        <SensitiveActionDialog
          title="Confirmer la correction de licence"
          summary={`La licence ${member.licence_number} sera remplacée. La fiche et le compte lié seront conservés.`}
          confirmLabel="Corriger la licence"
          pending={correct.isPending}
          error={correct.error?.message}
          onCancel={() => setCorrectingLicence(undefined)}
          onConfirm={(correctionReason) =>
            correct.mutate(
              { licence: correctingLicence, correctionReason },
              { onSuccess: () => setCorrectingLicence(undefined) },
            )
          }
        >
          <label>
            Numéro corrigé
            <input
              value={correctingLicence}
              onChange={(event) => setCorrectingLicence(event.target.value)}
            />
          </label>
        </SensitiveActionDialog>
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
              {member.canEdit && <th>Action</th>}
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
                {member.canEdit && (
                  <td>
                    <button
                      className="link-button"
                      onClick={() => setEditingSeason(season)}
                    >
                      Modifier la saison
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editingSeason && (
        <MemberSeasonDialog
          season={editingSeason}
          pending={seasonMutation.isPending}
          error={seasonMutation.error?.message}
          onCancel={() => setEditingSeason(undefined)}
          onConfirm={(input) =>
            seasonMutation.mutate(
              {
                seasonId: editingSeason.clubSeasonId,
                ranking: input.ranking,
                isLicensed: input.isLicensed,
                expectedUpdatedAt: editingSeason.updatedAt,
                reason: input.reason,
              },
              { onSuccess: () => setEditingSeason(undefined) },
            )
          }
        />
      )}
    </section>
  );
}
