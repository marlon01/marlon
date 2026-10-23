# Revue — Liputa « L'atelier respire » (version 2)

Rendu : `renders/liputa-l-atelier-respire.mp4` (72 s, 1920 × 1080, 30 i/s, H.264 + AAC),
son normalisé après rendu à −14,9 LUFS intégrés, crête −1,5 dBFS.
La v1 (« Un samedi à l'atelier », 44,5 s) est dans l'historique git (commit dc7cc3d).

## Retours de la direction sur la v1, et réponse
- « Trop plat, il faut de l'émotion » : une héroïne (Nadège), une cliente (Chantal), un ami
  (Papy) ; un arc difficulté → bouche-à-oreille → atelier virtuel → l'atelier respire → cliente
  rassurée ; visages expressifs (6 humeurs), répliques dites par les personnages.
- « Du motion design » : titre cinétique, notifications qui s'empilent, papiers qui se
  retournent en fiches, iris d'ouverture, lumière qui s'ouvre sur la respiration.
- « Kinshasa mal prononcé » : espeak lisait kɛ̃ʃaza ; le lexique de `tools/voix_off.py` écrit
  « Kinnchassa », lu kinʃasa (vérifié au phonémiseur).

## Mesuré / regardé / non vérifié
- `hyperframes check` : aucune erreur. Avertissements restants voulus : la vue par la fenêtre et
  Chantal derrière la porte sont rognés par leur cadre ; les bras tournent autour de l'épaule,
  pas de leur centre.
- Corrigés à la relecture des images : pivots des bras, de la tête et du buste (GSAP ignore le
  transform-origin CSS des groupes SVG, d'où svgOrigin dans `assets/rig.js`) ; tête qui tombait
  sous la table à la tombée de la nuit ; titre « Kinshasa » illisible sur Nadège (carton crème) ;
  note qui chevauchait la bulle de Nadège ; papiers affichés trop peu de temps ; heure du message
  sous 28 px.
- Images du MP4 final contrôlées à 10, 19, 49 et 60 s.
- **Le son n'a pas été écouté**, seulement mesuré ; prononciation vérifiée par Whisper
  (meilleure de 5 prises par phrase).

## Limites connues
- Pas de musique de fond (sites de musique bloqués par la politique réseau) ; une piste se pose
  en une ligne dans `index.html` (`<audio id="musique" … data-volume="0.14">`).
- Voix de synthèse locale : correctes, moins naturelles qu'un comédien.
- Personnages en dessin vectoriel simple, sans marche ni changement d'angle.

## Crédits à mentionner
- Voix : Piper « fr_FR-siwis-medium » (SIWIS, CC-BY 4.0) ; « fr_FR-upmc-medium », locuteurs
  Jessica et Pierre (UPMC, CC-BY-SA 4.0).
- Bruitages : Pixabay Content License. Police : Bricolage Grotesque (OFL).
