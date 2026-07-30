import { useEffect, useState } from "react";
import { BadgeCheck, Building2, Mail, UserRound } from "lucide-react";
import { UserSpaceShell } from "@/features/user-space/components/UserSpaceShell";
import { accountTypeLabels } from "@/features/user-space/domain/userSpace";
import {
  memberProfileService,
  type MemberProfileDetails,
} from "@/features/user-space/profile/services/memberProfileService";
import { USER_ROLES } from "@/shared/config";
import { useAuth } from "@/shared/hooks/useAuth";
import "./MyProfilePage.css";

export function MyProfilePage() {
  const { profile } = useAuth();
  const [member, setMember] = useState<MemberProfileDetails | null>(null);

  useEffect(() => {
    if (!profile?.memberId) return;
    let active = true;
    void memberProfileService
      .get(profile.memberId)
      .then((details) => {
        if (active) setMember(details);
      })
      .catch(() => {
        if (active) setMember(null);
      });
    return () => {
      active = false;
    };
  }, [profile?.memberId]);

  if (!profile) return null;
  const isMember = profile.role === USER_ROLES.member;
  return (
    <UserSpaceShell>
      <section className="my-profile" aria-labelledby="my-profile-title">
        <header>
          <p>Mon espace</p>
          <h1 id="my-profile-title">Mon profil</h1>
          <span>Consultez les informations associées à votre compte.</span>
        </header>
        <div className="my-profile__panel">
          <div className="my-profile__identity">
            <span>
              <UserRound aria-hidden="true" />
            </span>
            <div>
              <strong>
                {profile.displayName ||
                  [profile.firstName, profile.lastName]
                    .filter(Boolean)
                    .join(" ") ||
                  "Utilisateur"}
              </strong>
              <small>{accountTypeLabels[profile.role]}</small>
            </div>
          </div>
          <dl className="my-profile__details">
            <div>
              <dt>Nom</dt>
              <dd>{profile.lastName || "Non renseigné"}</dd>
            </div>
            <div>
              <dt>Prénom</dt>
              <dd>{profile.firstName || "Non renseigné"}</dd>
            </div>
            <div>
              <dt>
                <Mail aria-hidden="true" /> Adresse email
              </dt>
              <dd>{profile.email}</dd>
            </div>
            <div>
              <dt>
                <BadgeCheck aria-hidden="true" /> Type de compte
              </dt>
              <dd>
                <span className="my-profile__account-type">
                  {accountTypeLabels[profile.role]}
                </span>
              </dd>
            </div>
            {isMember && member && (
              <>
                <div>
                  <dt>Numéro de licence</dt>
                  <dd>{member.licenceNumber}</dd>
                </div>
                <div>
                  <dt>
                    <Building2 aria-hidden="true" /> Club
                  </dt>
                  <dd>Pelotaris Club Lourdais</dd>
                </div>
                <div>
                  <dt>Saison</dt>
                  <dd>{member.season}</dd>
                </div>
              </>
            )}
          </dl>
        </div>
      </section>
    </UserSpaceShell>
  );
}
