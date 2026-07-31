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

L’assistant va réellement jusqu’à l’exécution : sélection, détection modifiable, mapping modifiable, prévisualisation, décisions par ligne, validation PostgreSQL, bilan, confirmation, exécution et résultat. Une validation serveur en erreur réinjecte ses diagnostics dans le tableau afin que chaque ligne soit corrigée ou explicitement ignorée. L’historique donne ensuite accès aux décisions, erreurs, avertissements et valeurs avant/après.

La prévisualisation charge en une seule RPC les licences et identités concernées ; aucune requête par ligne n’est effectuée. Cette comparaison navigateur reste indicative : validation et exécution recalculent les actions à partir des données verrouillées en PostgreSQL. Le résultat d’exécution distingue explicitement `completed` et `failed`, et un échec conserve uniquement le statut et le diagnostic après rollback des écritures métier.

Une identité connue sous un nouveau numéro reste bloquante jusqu’à la décision dédiée « autre personne ». Cette décision est indépendante d’une confirmation sensible, d’une réactivation ou d’une exclusion, puis elle est revérifiée et auditée côté PostgreSQL. Les actions exécutées distinguent `season_created` et `season_updated` : un changement uniquement saisonnier ne modifie pas la fiche stable, ne crée pas d’audit `import_updated` et n’incrémente pas `updated_count`.

## RPC et écrans

- `admin_list_club_members` fournit la liste paginée du club et son total ;
- `admin_search_members_global` applique les filtres interclubs et reste accessible en lecture seule à `members.manage` ou `tournaments.manage` ;
- `admin_get_member` renvoie la fiche et les saisons et journalise uniquement l’ouverture détaillée interclubs ;
- `admin_create_member`, `admin_update_member`, `admin_set_member_active`, `admin_correct_member_licence` et `admin_update_member_season` verrouillent, valident et auditent les écritures ;
- les RPC d’import persistent, valident de nouveau, exécutent atomiquement et restituent le détail complet.
- `admin_find_member_import_matches` fournit en une requête le contexte de prévisualisation sans accorder de droit d’écriture.

Les routes `/admin/membres/:memberId`, `/admin/membres/recherche-globale`, `/admin/membres/importer`, `/admin/membres/imports` et `/admin/membres/imports/:importId` couvrent respectivement consultation/modification, recherche globale, assistant et historique détaillé. Les types de ces RPC sont déclarés dans le schéma Supabase TypeScript ; le service n’utilise aucun contournement `as never`.

La fiche permet également de modifier chaque saison. Le classement et `is_licensed` sont contrôlés par concurrence optimiste ; une ancienne saison impose un motif et une confirmation explicite dans l’interface, tandis qu’un changement de validité de la saison active demande une confirmation claire.

La recherche globale refuse une requête interclubs entièrement vide, ne renvoie ni naissance ni coordonnées dans la liste synthétique, sélectionne au plus une saison par licencié et réserve les données complètes à l’ouverture auditée du détail. Les listes du club, la recherche et les imports possèdent une pagination serveur et un total fiable.

## Migration et limites

La migration crée au besoin les saisons historiques aux formats `AAAA-AAAA` ou `AAAA/AAAA`, effectue le backfill et refuse explicitement de supprimer les anciennes colonnes si une ligne ne peut être migrée. Les inscriptions aux tournois, la mutation de club, l’invitation, les paiements et un rollback métier sont hors périmètre.
