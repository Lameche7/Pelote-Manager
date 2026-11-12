# Sauvegarde manuelle de Pilotoki (sans installation)

Le workflow `.github/workflows/manual-production-backup.yml` est **manuel uniquement**. Il ne modifie pas la base et ne restaure aucune donnée.

## Prérequis GitHub

Dans **Settings → Environments**, créer l'environnement `production-backup`. Configurer des reviewers obligatoires si le dépôt et l'offre GitHub le permettent.

Dans **Settings → Secrets and variables → Actions**, créer :

- `SUPABASE_BACKUP_DATABASE_URL` : chaîne de connexion PostgreSQL **directe ou pooler session** fournie par Supabase (Database → Connect), avec utilisateur et mot de passe ; choisir un compte de lecture adapté à l'export. Ne jamais copier cette URL dans un ticket, une conversation, un fichier suivi par Git ou les logs.
- `SUPABASE_BACKUP_PASSPHRASE` : phrase secrète aléatoire unique de 24 caractères minimum, conservée **hors de GitHub** également. Sans elle, la sauvegarde chiffrée est irrécupérable.

Le mot de passe de connexion PostgreSQL et la phrase secrète sont deux valeurs distinctes.

## Exécution

1. Faire parvenir le workflow sur la branche par défaut via une PR **indépendante** du chantier multi-clubs, puis vérifier qu'il apparaît dans **Actions**.
2. Dans Actions, choisir « Sauvegarde manuelle chiffrée Supabase » puis « Run workflow ».
3. Attendre le succès du job. Télécharger l'artefact chiffré et le fichier SHA-256 (rétention GitHub : 3 jours).
4. Conserver l'artefact chiffré dans un lieu privé et durable, distinct de GitHub.
5. Vérifier la somme SHA-256 et conserver la phrase secrète séparément. Le job vérifie déjà la possibilité de déchiffrer et de lire le catalogue via `pg_restore --list`.

## Limites importantes

- La vérification du catalogue **ne remplace pas un essai de restauration**. Une sauvegarde ne doit pas être qualifiée de « restauration testée » avant un essai sur une base isolée.
- `pg_dump` ne sauvegarde pas automatiquement l'intégralité des objets globaux PostgreSQL, les comptes Auth gérés hors schéma accessible, les fichiers Storage ni les secrets Edge Functions. Le périmètre réel dépend des droits du compte SQL et des schémas exportés.
- La connexion et le stockage d'artefact peuvent entraîner des coûts selon les offres et quotas GitHub/Supabase.
- Ne jamais fusionner la PR multi-clubs pour rendre ce workflow accessible : le déployer séparément.
- Aucun mot de passe ne doit être communiqué dans le chat.
