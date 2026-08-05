# Modèle d’instance isolée

Ce dossier contient les opérations propres à la création d’un nouveau club. Elles ne sont pas des migrations normales et ne doivent jamais être lancées sur une instance déjà utilisée.

## Principe

Chaque club dispose de son propre projet Supabase :

- authentification indépendante ;
- base de données indépendante ;
- stockage indépendant ;
- licenciés et comptes indépendants ;
- réservations, paiements et journaux indépendants.

Le dépôt GitHub et le produit restent communs. Chaque déploiement reçoit ses propres variables Vercel et pointe vers le projet Supabase du club concerné.

## Ordre d’installation

1. Créer un projet Supabase neuf pour le club.
2. Appliquer toutes les migrations de `supabase/migrations` dans leur ordre.
3. Ouvrir `01_configure_blank_instance.sql`.
4. Remplacer le nom et le slug, puis exécuter le script.
5. Créer le premier compte dans **Authentication > Users**.
6. Ouvrir `02_attach_first_club_admin.sql`.
7. Remplacer l’adresse électronique, puis exécuter le script.
8. Créer un déploiement Vercel propre au club.
9. Définir les variables Supabase et les variables `VITE_CLUB_*` décrites dans `.env.example`.
10. L’administrateur du club configure ses installations, horaires, tarifs, membres et événements depuis l’application.

## Protections

Le premier script refuse de fonctionner dès qu’il trouve un compte, un licencié, une réservation, un paiement ou un événement. Il ne peut donc pas servir accidentellement à réinitialiser une instance en activité.

Le projet Supabase du Pelotaris Club Lourdais reste l’instance historique de référence et ne doit jamais recevoir ces scripts.
