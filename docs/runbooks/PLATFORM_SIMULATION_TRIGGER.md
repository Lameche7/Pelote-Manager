# Déclencheur serveur de simulation

Ce protocole complète l’installation de la plateforme centrale de la PR43.

## Périmètre

Le déclencheur Vercel `/api/platform-provisioner-simulation` :

- s’exécute uniquement côté serveur ;
- exige une session valide de super administrateur central ;
- force le mode `simulation` et son acquittement ;
- revendique uniquement une demande dont le club possède un slug commençant par `simulation-` ;
- exécute une seule étape par clic ;
- ne lit aucun jeton Supabase Management API ou Vercel ;
- ne peut créer aucune ressource réelle.

## Migration préalable

La fonction suivante doit être installée dans la base centrale avant le premier lancement :

`supabase/platform/migrations/20260805030000_add_simulation_worker_claim.sql`

Elle est réservée à `service_role` et filtre le slug avant la prise du bail.

## Variables Vercel Preview

Configurer uniquement sur la branche de validation :

- `PLATFORM_SUPABASE_URL` : URL publique du projet central ;
- `PLATFORM_SUPABASE_SERVICE_ROLE_KEY` : clé secrète du projet central ;
- `PLATFORM_PROVISIONER_APPLICATION_VERSION` : version fictive facultative.

Ces variables sont serveur uniquement. Elles ne doivent jamais commencer par `VITE_`, être copiées dans GitHub, apparaître dans une capture ou être communiquées dans une conversation.

## Parcours

1. se connecter à `/super-admin` avec le compte central autorisé ;
2. enregistrer un club fictif `simulation-*` ;
3. préparer son instance ;
4. ouvrir `/api/platform-provisioner-simulation` sur le même déploiement Preview ;
5. cliquer une fois par étape ;
6. revenir au tableau de bord pour contrôler la progression ;
7. vérifier que les références finales utilisent exclusivement `.invalid` ;
8. vérifier qu’aucun nouveau projet réel n’existe chez Supabase ou Vercel.

Le mode réel demeure interdit.
