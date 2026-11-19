# Pilotoki Live — prototype de passerelle autonome (NON DÉPLOYÉ)

Ce dossier est un prototype de test sur une **instance Linux isolée** ; aucun service cloud n'est créé automatiquement.
Il reçoit le téléphone via WebRTC/WHIP (MediaMTX), lit le flux en RTSP local puis FFmpeg encode vidéo H.264 + audio AAC vers YouTube RTMPS.
Le coût visé est 0 € avec Oracle Always Free si une instance est disponible, **sans garantie de disponibilité ni de performances**.

## Prérequis
- Instance persistante Linux x86_64 ou ARM64, Docker + Compose, DNS `LIVE_BRIDGE_DOMAIN` et IP publique.
- HTTPS via Caddy (TCP 80/443 autorisé), UDP 8189 ouvert pour WebRTC ; **ne pas** exposer TCP 8554, 8787 ou 8889.
- Remplacer `PUBLIC_IP_REPLACE_ME` dans `mediamtx.yml` par l'IP publique réelle ; adapter `webrtcAllowOrigins` au domaine exact de Pilotoki.
- Créer un secret fort : `openssl rand -hex 32`. Insérer la même valeur dans `.env` (serveur) et `LIVE_BRIDGE_SHARED_SECRET` (Vercel).
- Variables Vercel : `LIVE_BRIDGE_TEST_ENABLED=true` **uniquement en phase de test**, `LIVE_BRIDGE_CONTROL_URL=https://live.example.org`, `LIVE_BRIDGE_SHARED_SECRET`. Les variables OAuth/YouTube existantes restent nécessaires.
- Le compte YouTube doit avoir Live activé, OAuth autorisé et un direct non répertorié créé puis lié à son flux RTMPS.

## Démarrage
`cp .env.example .env`, remplir `.env`, configurer l'IP dans `mediamtx.yml`, puis `docker compose up -d --build`.
`curl https://live.example.org/live/test/whip` doit refuser les requêtes non autorisées (et ne pas permettre de publier sans jeton).
Le contrôleur ne publie aucune clé YouTube dans le navigateur. Le jeton WHIP expire après 20 minutes : pour une partie entière, augmenter cette valeur seulement après test et contrôle des limites.

## Limites importantes et vérifications
- **Prototype uniquement**, pas de production automatique. Le controller ne conserve qu'une session dans sa mémoire et n'est pas résilient au redémarrage. Le démarrage du worker précède la connexion WHIP et sa tentative RTSP est répétée.
- Sur des appareils ARM modestes, le réencodage H.264 en logiciel peut saturer le CPU. Tester d'abord 720p30 et CPU/débit, puis optimiser le pass-through uniquement si les codecs source le permettent.
- Vérifier la négociation WebRTC (H.264/Opus possibles), l'auth HTTP MediaMTX et le fonctionnement de WHIP sur Samsung/Chrome avec l'origine et la CORS réelles.
- La caméra du navigateur doit être conservée au premier plan et le téléphone alimenté ; écran verrouillé ou veille peuvent couper la capture.
- Le simple transport RTMPS ne rend pas automatiquement le direct YouTube **LIVE** : l'état doit être confirmé via l'API YouTube ou son contrôle de transition dans une étape supplémentaire. Le replay dépend de l'archivage par YouTube.
- Le bouton d'arrêt de Pilotoki est nécessaire ; l'arrêt brutal du navigateur peut laisser la passerelle active jusqu'au délai d'expiration.
- Le proxy public autorise uniquement `/live/*` et `/control/*`. Les requêtes de contrôle exigent le secret Vercel ; **ne jamais** exposer l'API /auth ni l'instance RTSP.
- Ne pas lancer le service sans revue de sécurité, vérification CORS, tests de charge, journaux purgés des paramètres RTMPS et protection réseau.
