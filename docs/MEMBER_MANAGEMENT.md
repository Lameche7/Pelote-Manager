# Gestion complète des licenciés (PR38)

## Modèle métier

`club_members` est l’identité stable et globale d’une personne. Son numéro de licence textuel est normalisé (espaces supprimés, lettres en majuscules), globalement unique et conserve ses zéros initiaux. Le club porté par la fiche est le club actuel ; une future mutation conservera l’identifiant et la licence, mais le transfert est hors périmètre.

`club_member_seasons` est la seule source de vérité annuelle : club représenté, saison, classement facultatif, catégorie calculée et validité. La catégorie utilise l’âge atteint dans l’année civile de fin de saison. Une fiche active n’est licenciée que si une ligne licenciée existe pour la saison active de son club. Les anciennes saisons et anciens clubs restent ainsi consultables.

L’e-mail de `club_members` est un contact métier. Il ne modifie ni ne révèle jamais l’adresse de connexion Supabase Auth. Un import ne crée et ne rattache aucun compte.

## Administration et sécurité

Toutes les écritures passent par des RPC `SECURITY DEFINER`, qualifient les objets, fixent un `search_path` vide et revérifient `has_club_permission`. `members.manage` permet les écritures du seul club d’appartenance. `members.manage` ou `tournaments.manage` permet la recherche globale ; ce dernier reste strictement en lecture seule. L’accès au détail interclubs est destiné à être journalisé dans `club_member_access_log`.

Les créations, changements d’état et imports sont audités dans `club_member_audit_log`, immuable depuis le navigateur. Les corrections sensibles demandent un motif et une version `updated_at` observée. Il n’existe ni suppression définitive, ni changement de club, ni fusion automatique.

## Import CSV

L’assistant accepte UTF-8 et Windows-1252, virgule, point-virgule ou tabulation, avec une limite de 5 Mo et 10 000 lignes. Les en-têtes sont rapprochés sans casse, accents ou ponctuation. Saison et catégorie ne sont jamais mappées : l’import vise uniquement la saison active et recalcule la catégorie.

La prévisualisation ne réalise aucune écriture. Elle expose doublons internes, erreurs, avertissements sensibles, conflits d’identité, licences d’un autre club et fiches inactives. Une cellule vide conserve toujours la valeur actuelle. La réactivation est explicite. Une licence d’un autre club est bloquée et ne déclenche jamais une mutation.

`admin_execute_member_import` verrouille l’import et chaque fiche, revérifie permissions, saison, doublons, unicité et concurrence, puis applique toutes les lignes dans une sous-transaction. Une erreur annule toutes les mutations métier et conserve un statut `failed` exploitable. Les absents ne sont jamais désactivés et un import terminé n’est pas annulable automatiquement.

## Migration et limites

La migration crée au besoin les saisons historiques aux formats `AAAA-AAAA` ou `AAAA/AAAA`, effectue le backfill et refuse explicitement de supprimer les anciennes colonnes si une ligne ne peut être migrée. Les inscriptions aux tournois, la mutation de club, l’invitation, les paiements et un rollback métier sont hors périmètre.
