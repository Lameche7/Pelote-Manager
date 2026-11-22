# Pilotoki Live — validation du smartphone → LiveKit → YouTube

## Ce qui est maintenant implémenté

- L'utilisateur habilité ouvre un direct préparé depuis l'administration du club pilote.
- Il autorise sa caméra et son microphone, puis publie les pistes dans une salle LiveKit propre à ce club et à cette vidéo.
- En cliquant sur **Diffuser cette partie sur YouTube**, Pilotoki demande à LiveKit une sortie RTMPS vers le flux YouTube **préalablement lié à cette vidéo**, sans remettre sa clé au téléphone.
- Pilotoki vérifie que LiveKit fournit réellement ce flux et que YouTube le reçoit avant d'indiquer **DIRECT YOUTUBE EN COURS**.
- **Terminer** demande à YouTube de finaliser le direct, coupe l'egress LiveKit puis synchronise les replays.

Les droits actuels restent volontairement limités à l'administration du **club pilote Lourdes**. L'habilitation des autres membres et des autres clubs n'est **pas encore activée**.

## Vérifications sans diffuser publiquement

1. Confirmer que `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` sont présents uniquement dans l'environnement serveur Vercel de Production ; ne jamais afficher leur valeur dans le navigateur.
2. Préparer un direct YouTube de test et lui associer son flux RTMPS via Pilotoki Live, sans démarrer une ancienne régie Upstream pour ce direct.
3. Ouvrir **Caméra mobile** sur un téléphone, autoriser caméra/micro, vérifier la présence de l'aperçu local.
4. Choisir **Connecter la caméra à LiveKit**. La caméra est alors envoyée à LiveKit mais **pas encore à YouTube**. Contrôler la salle dans la console LiveKit Cloud.
5. Pour le premier test de bout en bout, utiliser une vidéo non répertoriée, avec accord des personnes filmées. Cliquer sur **Diffuser cette partie sur YouTube** et confirmer la réception du flux sur YouTube.
6. Cliquer sur **Terminer le direct**. Contrôler que YouTube affiche **complete**, que LiveKit ne possède plus d'egress actif pour la vidéo et que le replay apparaît dans **Pilotoki Vidéos**.
7. Tester ensuite un **deuxième direct distinct** avec le même téléphone : aucune référence à la clé RTMPS ni au flux précédent ne doit subsister.

## Sécurité et limites

- Le bouton **Diffuser** est une action explicite : aucune vidéo n'est rendue publique par l'ouverture de la caméra.
- Une même vidéo n'accepte pas deux egress actifs détectés par LiveKit. Ce contrôle n'est **pas une transaction atomique** en cas de deux commandes strictement simultanées : avant généralisation multi-club, mettre en place un verrou serveur en base.
- Une coupure du navigateur ou un départ de la salle pendant le direct peut nécessiter l'intervention de l'administrateur pour terminer YouTube. L'arrêt automatique sur perte durable de signal et la récupération après panne restent à durcir.
- Un direct réel LiveKit Egress consomme le quota de transcodage de LiveKit Cloud ; surveiller les minutes disponibles avant la finale.
- Les tests automatiques vérifient des appels simulés à LiveKit et YouTube. **Ils ne prouvent pas la qualité vidéo réelle ni la disponibilité des services tiers.**
- Les anciennes fonctions Upstream restent présentes pour les directs existants, mais le nouveau circuit mobile n'en dépend pas.
