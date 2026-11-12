# Audit de blocage — super-admin multi-club (12 novembre 2026)

## Vérifications sur la base métier de production
- `get_my_club_access()` retourne uniquement les clubs dont `club_memberships.profile_id = auth.uid()`.
- `admin_current_club_id()` refuse explicitement les comptes sans club (42501) et les comptes avec plusieurs clubs (P0003).
- Les RPC d'administration historiques appellent `admin_current_club_id()`. Un sélecteur React ne peut donc pas leur faire cibler un autre club.
- L'identité super-admin est vérifiée par `platform_is_admin()` sur **une autre instance Supabase**, avec une session indépendante. Cette preuve n'est pas actuellement utilisable par les RPC de la base métier.
- Le rattachement d'un utilisateur comme administrateur de deux clubs est interdit par `enforce_single_club_administrator()` : ne pas contourner ce garde-fou.

## Critères de livraison
1. Établir une identité de super-admin vérifiable côté base métier (jeton signé, issuer/audience/expiration vérifiés, ou service serveur validant la session plateforme). Ne jamais autoriser par simple e-mail ou drapeau client.
2. Créer une fonction d'autorisation ciblée `can_administer_club(actor, target_club)`, avec tests de refus pour utilisateurs ordinaires et comptes non authentifiés.
3. Adapter les RPC admin avec un contexte club explicitement contrôlé; aucun accès en écriture au club tiers via les anciennes RPC.
4. Ajouter la sélection UI avec club actif visible en permanence, et conserver le mode joueur indépendant.
5. Exécuter tests automatisés + scénarios de non-régression Lourdes / Morlaàs avant toute migration de production.

## Décision
Ne pas fusionner ni déployer la PR #497 tant que les RPC d'administration ne sont pas adaptées. L'affichage de plusieurs clubs n'est pas équivalent à l'autorisation de les administrer.
