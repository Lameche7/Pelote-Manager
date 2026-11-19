# Pilotoki Live — architecture de diffusion mobile

## Livré : aperçu local

Le module `PilotokiLiveCameraStudio` utilise exclusivement `navigator.mediaDevices.getUserMedia` dans l'appareil de l'administrateur. Il exige une action explicite, utilise HTTPS, privilégie la caméra arrière et permet de changer de caméra, couper le microphone et arrêter. Aucune image ni piste audio n'est envoyée au serveur Pilotoki, à Supabase ou à YouTube.

La création de directs YouTube par l'administration est une fonction distincte déjà en place (PR #560). Le direct préparé reste non répertorié et ne démarre pas automatiquement.

## Architecture cible, **non encore activée**

1. Authentifier l'utilisateur Pilotoki et déterminer le club actif côté serveur ; appliquer les autorisations de diffusion propres au club et vérifier l'accord de captation des participants.
2. Créer ou réutiliser le `liveBroadcast` YouTube et créer un `liveStream` (ingestion RTMPS, protocole H.264/AAC), puis lier les deux via `liveBroadcasts.bind`.
3. Stocker l'URL RTMPS et le `streamName` **uniquement dans un coffre côté serveur**, jamais en base publique ni dans un bundle JS, ni dans une réponse accessible à un client navigateur.
4. Établir un jeton d'émission temporaire, à usage limité, lié à un utilisateur, un club, un direct et une durée ; le serveur média doit vérifier ce jeton et permettre sa révocation.
5. Envoyer l'audio/vidéo du navigateur vers la passerelle au moyen de WebRTC (HTTPS/WSS pour la signalisation, DTLS-SRTP pour le média). Convertir et envoyer le flux continu vers YouTube en RTMPS depuis un processus média durable.
6. Vérifier l'état du flux et contrôler la transition du direct YouTube vers le statut live, avant de l'afficher publiquement sur Pilotoki Network.
7. À l'arrêt, couper le flux et les autorisations d'émission, terminer le direct sur YouTube puis synchroniser le replay avec le `club_id` d'origine.

## Limites et décisions

- **Ne pas** tenter d'héberger un encodeur média longue durée dans une Vercel Function : ces fonctions ont une durée maximale et ne constituent pas un serveur RTMP/WebRTC permanent.
- **Ne pas** remettre l'adresse et la clé RTMPS directement au téléphone ; le serveur média doit seul connaître les secrets d'ingestion.
- Choisir ensuite une passerelle vidéo durable : service géré compatible WebRTC-RTMP(S), ou instance isolée avec SFU/WHIP et encodeur FFmpeg/GStreamer. Tester latence, coût par heure de direct, multi-club simultané, consommation mobile, disponibilité et récupération sur coupure réseau.
- Le modèle commercial peut plafonner les directs simultanés par club/offre et imposer une durée maximale ainsi qu'une confirmation explicite avant le début.
- Prévoir des tests avec plusieurs clubs, compte révoqué, perte de connexion, navigateur mis en arrière-plan, absence d'audio et arrêt forcé ; éviter toute diffusion publique accidentelle.

Références :
- https://developers.google.com/youtube/data/live/guides/implementation/broadcasts-and-streams
- https://developers.google.com/youtube/data/live/guides/rtmps-ingestion
- https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
- https://vercel.com/docs/functions/limitations
