import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { NetworkHero } from "@/features/network/components/NetworkHero";
import { supabase } from "@/infrastructure/supabase/client";
import "./NetworkDirectoryPage.css";

type Plan = "essentiel" | "club" | "premium";
const planPrices: Record<Plan, string> = {
  essentiel: "9,90 €",
  club: "14,90 €",
  premium: "19,90 €",
};

function selectedPlan(value: string | null): Plan {
  return value === "essentiel" || value === "premium" ? value : "club";
}

export function NetworkClubRegistrationPage() {
  const [params] = useSearchParams();
  const [plan, setPlan] = useState<Plan>(selectedPlan(params.get("formule")));
  const [clubName, setClubName] = useState("");
  const [city, setCity] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSending || submitted) return;
    setErrorMessage("");
    setIsSending(true);
    try {
      const { error } = await supabase.rpc(
        "submit_network_club_registration_request",
        {
          target_club_name: clubName.trim(),
          target_city: city.trim(),
          target_contact_name: contactName.trim(),
          target_contact_email: email.trim(),
          target_contact_phone: phone.trim(),
          target_plan: plan,
          target_privacy_accepted: privacyAccepted,
          target_website: website,
        },
      );
      if (error) throw error;
      setSubmitted(true);
    } catch {
      setErrorMessage(
        "La demande n'a pas pu être enregistrée. Vérifiez vos informations ou réessayez plus tard. Une demande récente avec cet e-mail peut aussi être en attente.",
      );
    } finally {
      setIsSending(false);
    }
  };

  return (
    <main className="network-directory">
      <NetworkHero variant="subscription" />
      <section className="network-directory__section network-registration">
        <Link to="/reseau/abonnement" className="network-registration__back">
          ← Retour aux tarifs
        </Link>
        <div className="network-registration__panel">
          {submitted ? (
            <div className="network-registration__success" role="status">
              <h2>Votre demande a bien été enregistrée.</h2>
              <p>
                Nous avons reçu la demande d'inscription de votre club pour la
                formule {plan}, à {planPrices[plan]} par mois.
              </p>
              <p>
                L'équipe Pilotoki examinera votre demande avant toute création
                de club. Aucun paiement n'a été effectué et aucun abonnement
                n'est activé à ce stade.
              </p>
              <Link to="/reseau" className="network-pricing__explore">
                Retour à Pilotoki Network
              </Link>
            </div>
          ) : (
            <>
              <p className="network-directory__eyebrow">Rejoindre Pilotoki</p>
              <h2>Inscrire mon club</h2>
              <p>
                Présentez-nous votre club et la formule qui vous intéresse.
                L'inscription est une demande de prise de contact, sans paiement
                et sans activation automatique.
              </p>
              <form onSubmit={(event) => void submit(event)}>
                <div className="network-registration__fields">
                  <label>
                    Formule souhaitée
                    <select
                      value={plan}
                      onChange={(event) => setPlan(event.target.value as Plan)}
                    >
                      <option value="essentiel">Essentiel — 9,90 €/mois</option>
                      <option value="club">Club — 14,90 €/mois</option>
                      <option value="premium">Premium — 19,90 €/mois</option>
                    </select>
                  </label>
                  <label>
                    Nom du club
                    <input
                      required
                      minLength={3}
                      maxLength={120}
                      autoComplete="organization"
                      value={clubName}
                      onChange={(event) => setClubName(event.target.value)}
                    />
                  </label>
                  <label>
                    Commune
                    <input
                      required
                      minLength={2}
                      maxLength={100}
                      autoComplete="address-level2"
                      value={city}
                      onChange={(event) => setCity(event.target.value)}
                    />
                  </label>
                  <label>
                    Nom du responsable
                    <input
                      required
                      minLength={3}
                      maxLength={120}
                      autoComplete="name"
                      value={contactName}
                      onChange={(event) => setContactName(event.target.value)}
                    />
                  </label>
                  <label>
                    E-mail de contact
                    <input
                      required
                      type="email"
                      maxLength={254}
                      autoComplete="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                    />
                  </label>
                  <label>
                    Téléphone (facultatif)
                    <input
                      type="tel"
                      maxLength={32}
                      autoComplete="tel"
                      value={phone}
                      onChange={(event) => setPhone(event.target.value)}
                    />
                  </label>
                </div>
                <div className="network-registration__honeypot" aria-hidden="true">
                  <label>
                    Site web
                    <input
                      type="text"
                      name="website"
                      tabIndex={-1}
                      autoComplete="off"
                      value={website}
                      onChange={(event) => setWebsite(event.target.value)}
                    />
                  </label>
                </div>
                <label className="network-registration__privacy">
                  <input
                    required
                    type="checkbox"
                    checked={privacyAccepted}
                    onChange={(event) =>
                      setPrivacyAccepted(event.target.checked)
                    }
                  />
                  <span>
                    J'accepte que mes coordonnées soient utilisées pour traiter
                    cette demande et me recontacter. Voir la{" "}
                    <Link to="/confidentialite">politique de confidentialité</Link>.
                  </span>
                </label>
                {errorMessage && (
                  <p className="network-registration__error" role="alert">
                    {errorMessage}
                  </p>
                )}
                <button
                  type="submit"
                  className="network-pricing__explore network-registration__submit"
                  disabled={isSending}
                >
                  {isSending ? "Enregistrement…" : "Envoyer ma demande"}
                </button>
                <p className="network-registration__disclaimer">
                  Aucun paiement, aucun abonnement et aucune création de club
                  ne sont déclenchés par cette demande.
                </p>
              </form>
            </>
          )}
        </div>
      </section>
      <footer className="network-directory__footer">
        Pilotoki · Clubs et tournois
      </footer>
    </main>
  );
}
