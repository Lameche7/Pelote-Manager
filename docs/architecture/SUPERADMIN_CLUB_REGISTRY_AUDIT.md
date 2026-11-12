# Audit du catalogue des clubs pour le super-admin — 12 novembre 2026

## Constat vérifié en lecture seule

La base métier `kuvwagoshhxibhwxknij` contient :
- `Pelotaris Club Lourdais` — `188029a8-3e6a-41cd-821f-01984a703552`, slug `pelotaris-club-lourdais`
- `Pelotari Club Morlaas` — `429d9256-54f5-45e5-a3af-789e276d2f23`, slug `pelotari-club-morlaas`

La base plateforme `ihgsxsnaidxioqbmmawb` possède un registre `public.platform_clubs`, mais ne contient **aucune entrée pour ces deux clubs** à la date de l'audit. Elle ne contient que des clubs de simulation ou de démonstration.

Le sélecteur actuel de `PlatformDashboardPage` utilise `platformRegistryService` et donc `platform_clubs`. Il ne peut pas lister Lourdes ou Morlaàs à partir de ce registre.

## Décision d'architecture

- Ne **pas** créer des enregistrements commerciaux fictifs dans `platform_clubs` pour corriger l'affichage : cela mélangerait l'annuaire de provisionnement et les clubs existants de la base métier.
- Distinguer **registre commercial** (instances/abonnements/provisionnement) et **catalogue métier** (`public.clubs`, club_id réel et immuable).
- Pour la sélection super-admin des clubs existants, construire une lecture serveur **en lecture seule** de `public.clubs` après vérification de la session plateforme et du rôle via `platform_is_admin()`.
- Le serveur doit valider le jeton auprès de l'instance plateforme, refuser les sessions absentes/expirées/non administratrices et n'utiliser les secrets de la base métier que côté serveur.
- Ne jamais envoyer la clé service_role au navigateur. Ne pas utiliser `club_id` client comme preuve d'autorisation.
- Avant toute mutation, établir des opérations métier ciblées avec contrôle de l'acteur et du club cible, journal d'audit et tests négatifs inter-clubs.
- Conserver le sélecteur actuel du registre commercial dans la console plateforme, mais **ne pas le présenter** comme un accès d'administration aux clubs métier.

## Critères d'acceptation

1. Le catalogue super-admin métier retourne Lourdes et Morlaàs, avec leurs vrais UUID métier.
2. Un utilisateur non connecté ou non super-admin obtient 401/403, sans fuite de noms de clubs.
3. Antoine reste administrateur de Morlaàs seulement ; son accès joueur à Lourdes est inchangé.
4. Aucun rôle, affiliation, réservation ou tournoi existant n'est modifié par la simple sélection d'un club.
5. L'administration d'un club tiers n'est activée qu'après sécurisation et test de chaque opération serveur.

## Statut

Audit documenté. **Aucun pont d'authentification inter-projets ni opération d'administration super-admin n'est encore livré.** Ne pas fusionner cette PR comme une fonctionnalité terminée.
