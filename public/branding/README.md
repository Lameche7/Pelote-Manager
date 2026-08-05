# Éléments graphiques d’une instance

Chaque déploiement peut utiliser des fichiers ou des URL propres au club :

- le logo est défini par `VITE_CLUB_LOGO_URL` ;
- la photo d’accueil est définie par `VITE_CLUB_HERO_URL`.

Les fichiers historiques `pcl-logo.png` et `trinquet-hero.jpg` restent présents uniquement comme valeurs de secours pour l’instance du Pelotaris Club Lourdais. Une nouvelle instance doit définir ses deux variables dans Vercel et ne dépend pas de ces fichiers.

En cas de logo introuvable, l’application affiche automatiquement un blason neutre avec les initiales du club configuré.
