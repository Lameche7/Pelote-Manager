# Déploiement différé : catalogue des clubs métier

La fonction `supabase/functions/platform-business-clubs/index.ts` est destinée **au projet plateforme** `ihgsxsnaidxioqbmmawb`, et **pas** au projet métier `kuvwagoshhxibhwxknij`.

## Conditions avant déploiement

1. Activer la vérification JWT de la fonction sur le projet plateforme (`verify_jwt = true`) ; l'implémentation vérifie en outre le token via `auth.getUser(token)` et le rôle via `platform_is_admin()`.
2. Configurer les secrets côté fonction plateforme : `BUSINESS_SUPABASE_URL` (URL du projet métier) et `BUSINESS_SUPABASE_SERVICE_ROLE_KEY` (clé service_role du projet métier). Ne jamais utiliser une variable `VITE_*` ni transmettre cette clé au navigateur.
3. Confirmer que les fonctions du dépôt ne sont pas déployées automatiquement sur le projet métier : ce fichier ne doit **pas** être inclus dans un déploiement global des Edge Functions métier.
4. Tester une requête sans jeton (401), avec un utilisateur plateforme ordinaire (403), avec un jeton expiré (401), et avec un vrai super-admin (200). Vérifier que la réponse autorisée contient les vrais UUID de Lourdes et Morlaàs.
5. Avant de brancher le navigateur, définir une politique CORS à origine autorisée explicite et limiter les abus (rate limiting). La fonction actuelle n'expose pas d'en-têtes CORS : elle n'est pas encore consommable depuis l'interface web.
6. Vérifier les journaux et la révocation de rôle en production. Ne pas activer d'opérations d'écriture à ce stade.

**État : code et tests statiques uniquement. Aucun déploiement, secret ou autorisation de production modifié.**
