import { useEffect, useState } from "react";
import { BadgeCheck, Building2, Mail, UserRound } from "lucide-react";
import { UserSpaceShell } from "@/features/user-space/components/UserSpaceShell";
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
  const isMember =
    Boolean(profile.memberId) || profile.role === USER_ROLES.member;
  const firstName = member?.firstName || profile.firstName;
  const lastName = member?.lastName || profile.lastName;
  const displayName =
    [firstName, lastName].filter(Boolean).join(" ") || profile.displayName;
  const accountType = isMember ? "Licencié" : "Visiteur";
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
              <strong>{displayName || profile.email}</strong>
              <small>{accountType}</small>
            </div>
          </div>
          <dl className="my-profile__details">
            <div>
              <dt>Nom</dt>
              <dd>{lastName || "—"}</dd>
            </div>
            <div>
              <dt>Prénom</dt>
              <dd>{firstName || "—"}</dd>
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
                <span className="my-profile__account-type">{accountType}</span>
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
