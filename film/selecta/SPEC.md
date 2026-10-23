# SPEC — SELECTA « Des résultats incontestables »

```text
GOAL:    un directeur des ressources humaines reconnaît son concours sur papier (coût, piles de
         copies, attente, contestations) et retient « en ligne, corrigé tout de suite, impossible à
         contester ».
OUTPUT:  HyperFrames, 1920 x 1080, 30 fps ; voix off française (SIWIS), sans musique (aucune source).
TIME:    49,5 s x 30 = 1485 images. La voix est l'horloge : une phrase par fichier, posée sur son plan.
LOOK:    deux mondes.
         Problème : bureau gris administratif #D5DAE3 (grain 7 %), papier #FBFCFE, encre #14213D,
         rouge #C2352B réservé à la note contestée. Illustration assumée, aucun faux écran.
         Solution : fond #EEF1F7, vrais écrans SELECTA dans des cadres arrondis (20 px, ombre
         0 20 48 rgba(20,33,61,.16)). Accent bleu de marque #0B5FFF (chronomètre, sceau),
         vert #0E8A5F (« Admis », QR code), rouge pour l'incident de surveillance.
         Police Inter (proche du système de l'application).
SHOTS:
  1   0–4,6 s    Piles de copies qui montent.
  2   4,9–8,8    Salles à louer, surveillants à payer, correction : semaine 1 → 4.
  3   9,0–11,9   Le téléphone du candidat : « Toujours aucune nouvelle. »
  4   12,2–16,4  Copie n° 0427 : tampon « NOTE CONTESTÉE », point d'interrogation.
  5   16,6–21,7  La copie grandit et devient l'écran d'épreuve ; chronomètre repéré, poussée sur la question.
  6   21,9–26,0  Saisie du code K7QP-M4XR-9TBA, poussée sur le champ.
  7   26,0–31,6  Surveillance en direct : compteurs, puis incident « Plusieurs personnes détectées », disqualifié.
  8   31,7–35,8  Résultat du candidat : Admis, 100 %, poussée sur la décision.
  9   35,8–38,6  Procès-verbal scellé : empreinte SHA-256, QR code repéré.
  10  38,6–42,0  Page publique de vérification : « Document authentique », liste des 10 admis.
  11  41,6–49,5  Sceau « SCELLÉ · SELECTA · VÉRIFIABLE » frappé, marque, slogan, essai gratuit.
BANNED:  fond sombre et éléments flottants ; lueurs ; dégradés violets ; trois cartes en ligne ;
         logo dans un coin ; faux écrans ; chiffres inventés présentés comme réels.
```

Matériel : captures de la base de démonstration (`tools/selecta_film_seed.py`,
`tools/selecta_film_capture.mjs`), structure fictive « Groupe Mayombe (démonstration) ».
