# Revue — SELECTA (version 1)

Rendu : `renders/selecta-resultats-incontestables.mp4` (49,5 s, 1920 × 1080, 30 i/s, H.264 + AAC),
son normalisé après rendu à −14,9 LUFS, crête −1,5 dBFS.

## Choix de réalisation
- Structure demandée par la direction : la problématique (coût, volume de copies, attente des
  résultats, triche, fiabilité), puis la réponse de SELECTA point par point.
- Problème dessiné (bureau, piles de copies, téléphone, copie contestée) ; solution uniquement en
  vrais écrans, capturés en français sur une base de démonstration remplie par le vrai moteur
  d'épreuve (40 candidats fictifs, procès-verbal réellement scellé et vérifiable).
- La copie contestée devient l'écran d'épreuve : le passage du papier au numérique est un seul geste.
- « Sélecta » et « code Q R » sont écrits phonétiquement dans le texte de synthèse.

## Données de démonstration retouchées pour l'image
- Les compositions étant simulées instantanément, des durées réalistes (9 à 21 min, croissantes
  avec le rang) ont été inscrites avant publication ; elles n'affectent pas les notes.
- Un candidat a reçu un code réaliste (K7QP-M4XR-9TBA) au lieu du code de démonstration.
- L'écran d'épreuve vient d'une copie du concours sans surveillance caméra (le conteneur n'a pas de
  caméra ; l'ancienne capture montrait une mire de test verte).

## Mesuré / regardé / non vérifié
- `hyperframes check` : aucune erreur ni avertissement restant.
- Plans vérifiés image par image ; corrigés : chronomètre coupé, zoom qui tranchait le panneau du
  code, cadre « Admis » décalé, piles trop petites puis trop hautes, textes sous 28 px.
- Voix vérifiée par retranscription Whisper (meilleure de 4 prises). **Son non écouté**, mesuré.

## Limites connues
- Pas de musique de fond (sources bloquées par la politique réseau).
- La page de vérification affiche « 100.00 % » (point décimal) en français : à corriger dans
  `selecta_concours/views/selecta_templates.xml`.
- Plan le plus faible : le procès-verbal (bandeau peu haut, texte petit) ; à agrandir ou remplacer
  par la version imprimée du procès-verbal.

## Crédits à mentionner
- Voix : Piper « fr_FR-siwis-medium », jeu de données SIWIS, CC-BY 4.0.
- Bruitages : Pixabay Content License.
