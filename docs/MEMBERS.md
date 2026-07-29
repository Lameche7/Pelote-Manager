# Gestion des membres

## Architecture

`club_members` est le registre métier des licenciés du club, y compris ceux qui ne
possèdent aucun compte. `auth.users` reste l'identité d'authentification et
`profiles` le profil applicatif. La colonne nullable `profiles.member_id` relie ces
deux cycles de vie indépendants :

```text
auth.users (1) -> (1) profiles (0..1) -> (1) club_members
```

La nullabilité conserve les comptes existants pendant la transition. Le futur
parcours de création devra obligatoirement appeler `link_profile_to_member` avant
de considérer un nouveau profil comme finalisé. L'unicité de `member_id` garantit
qu'une licence ne peut être associée qu'à un compte.

## Modèle et règles métier

- Une ligne `club_members` représente une licence importée pour une saison et peut
  exister sans compte.
- Le numéro de licence et le lien depuis `profiles` sont uniques.
- `is_active` porté par la licence est la source de vérité du statut de licencié ;
  ce statut n'est pas un rôle d'autorisation.
- Les anciennes colonnes d'adhésion de `profiles` restent supportées uniquement
  pour les profils non encore migrés, afin de préserver les réservations
  existantes. Dès qu'un `member_id` existe, `club_members.is_active` prévaut.
- Une suppression de licence liée est refusée (`ON DELETE RESTRICT`) afin de ne
  jamais rendre un compte incohérent.

Les champs sportifs (`ranking`, `category`) et `season` préparent les imports FFTB,
les renouvellements, compétitions, tournois et statistiques sans les coupler à
l'authentification. Une modélisation historique plus détaillée pourra extraire
les licences saisonnières dans une table dédiée lorsque plusieurs saisons devront
être actives simultanément, sans changer l'identité stable du membre.

## Sécurité et RPC

RLS est activé sur `club_members`. Un utilisateur authentifié ne peut lire que la
licence liée à son propre profil. Les administrateurs disposent des opérations
complètes ; un import serveur peut utiliser la `service_role`, qui contourne RLS.

Les parcours clients passent exclusivement par deux fonctions `SECURITY DEFINER`
à surface limitée :

- `find_member_by_licence(text)` expose uniquement identité, naissance, saison et
  état nécessaires à la vérification ;
- `link_profile_to_member(text)` verrouille la licence, vérifie la présence du
  profil courant et l'absence d'un autre lien, puis réalise l'association.

Les droits `PUBLIC` sont révoqués et seuls les utilisateurs authentifiés peuvent
exécuter ces fonctions. Un trigger interdit de contourner la RPC en modifiant
directement son propre profil. Toutes les validations d'intégrité et de concurrence
restent ainsi côté PostgreSQL.

## Couche TypeScript

Le service `src/features/members/services/memberService.ts` encapsule les RPC,
normalise les entrées et transforme les lignes SQL en objets TypeScript. Les hooks
TanStack Query de `src/features/members/hooks/useMemberLookup.ts` constituent les
fondations du Sprint 2 sans introduire de logique SQL ou métier dans React.
