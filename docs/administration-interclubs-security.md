# Administration inter-clubs — contrat de sécurité

## État

La sélection `?club=slug` du bandeau est **un aperçu de marque uniquement**.
Elle ne peut ni attribuer un rôle, ni changer les données métier accessibles.
`getAccessForClub(clubId)` refuse tout club absent des habilitations renvoyées
par le serveur métier.

## Autorisation cible

1. L'utilisateur ouvre une session **plateforme** et une session **métier**
   distinctes. Une Edge Function privée vérifie les deux jetons côté serveur,
   le rôle plateforme et la correspondance des identités.
2. Après cette preuve, une opération **serveur à serveur**, jamais depuis le
   navigateur, délivre au seul identifiant utilisateur métier vérifié une
   autorisation courte, bornée dans le temps, révocable et journalisée.
3. La base métier vérifie cette autorisation dans ses fonctions de contrôle
   RLS. La seule présence de `?club`, d'une adresse email ou d'un drapeau
   JavaScript ne constitue jamais une permission.
4. L'accès aux données d'un club reste lié à un identifiant de club
   explicitement sélectionné **et autorisé**. Les opérations sensibles doivent
   revalider cette permission au serveur.
5. La contrainte `enforce_single_club_administrator()` demeure intacte :
   les administrateurs classiques restent limités à leur club.

## Conditions avant activation

- Refus d'un jeton plateforme absent, expiré, non administrateur ou lié à
  une autre identité métier.
- Refus de toute tentative d'auto-attribution de droit via l'API publique.
- Expiration, révocation et journalisation des autorisations temporaires ;
  vérifier le comportement après déconnexion plateforme.
- Tests RLS : admin Lourdes ne peut ni lire ni modifier Morlaàs ; un
  super-admin autorisé ne peut accéder qu'au club sélectionné selon les
  permissions accordées ; un jeton périmé perd immédiatement ses droits.
- Vérifier les accès à tous les modules : réservations, championnats,
  tournois, arbitrage, utilisateurs, notifications, paramètres et stockage.
- Vérifier le changement de club sans cache résiduel de l'ancien club.
- Faire valider les migrations et les tests d'isolation avant déploiement
  en production ; ne pas utiliser la clé `service_role` côté navigateur.

## Déploiement progressif

1. Autorisation serveur courte et révocable, tests SQL/RLS.
2. Lecture du catalogue autorisé par le service métier.
3. Contexte de club propagé dans les pages et requêtes administrateur.
4. Tests de bout en bout Lourdes ↔ Morlaàs ; seulement ensuite activation.
