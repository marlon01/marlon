# Revue — Liputa « Un samedi à l'atelier » (version 1)

Rendu : `renders/liputa-un-samedi-a-l-atelier.mp4` (44,5 s, 1920 × 1080, 30 i/s, H.264 + AAC),
son normalisé après rendu à −14,9 LUFS intégrés, crête −1,3 dBFS.

## Choix de réalisation
- Piste B retenue par la direction (problème puis solution) ; pistes A « La robe de Chantal » et
  C « Le fil » non construites (`STORYLINES.md`).
- Durée réelle 44,5 s au lieu des 54 s du SPEC : la voix (39 s de parole) fixe le rythme ; chaque
  phrase est un fichier posé sur son plan (`assets/audio/phrases`).
- Côté « avant » dessiné et assumé comme illustration (carnet, téléphone, post-it) ; côté Liputa :
  uniquement de vraies captures de l'application en français (`assets/screens`, atelier fictif).
- Le mètre ruban jaune de l'application sert de fil conducteur : il ouvre l'écran partagé, repère
  les informations clés et souligne l'offre d'essai sur le carton final.
- « Liputa » est écrit « Lipouta » dans le texte de synthèse pour être bien prononcé.

## Mesuré / regardé / non vérifié
- `hyperframes check` : aucune erreur ni avertissement restant.
- Images vérifiées à chaque plan (planches de contrôle) ; corrigés : téléphone visible trop tôt,
  rature mal placée, cadres jaunes qui mordaient sur le texte voisin, textes sous 28 px.
- Voix : prononciation vérifiée par retranscription Whisper (meilleure de 4 prises par phrase).
  **Le son n'a pas été écouté**, seulement mesuré.

## Limites connues
- Pas de musique de fond : Hugging Face et Openverse sont bloqués par la politique réseau de
  l'environnement, et aucune piste n'a été fournie. Une musique se pose en une ligne dans
  `index.html` (`<audio id="musique" … data-volume="0.14">`).
- Voix de synthèse locale (Piper SIWIS) : correcte mais moins naturelle qu'une voix de studio
  (ElevenLabs, HeyGen) ou qu'un comédien.
- Plan le plus faible : le planning du samedi (texte petit dans la carte pendant le panoramique).

## Crédits à mentionner
- Voix : modèle Piper « fr_FR-siwis-medium », jeu de données SIWIS, licence CC-BY 4.0.
- Bruitages : Pixabay Content License. Police : Bricolage Grotesque (OFL).
