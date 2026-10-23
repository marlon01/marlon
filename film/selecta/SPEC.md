# SPEC — SELECTA « Clarisse respire » (v2)

La v1 (« Des résultats incontestables », 49,5 s, commit 7d7f172) listait le problème puis la
solution, sans personnage. La direction a demandé pour Liputa, puis pour SELECTA, une histoire
avec de l'émotion, des personnages et du motion design.

```text
GOAL:    un DRH se reconnaît dans Clarisse (coût, piles de copies, attente, contestations, soupçons
         de triche) et retient : en ligne, corrigé tout de suite, scellé, personne ne conteste.
ARC:     difficulté → conseil d'un collègue (Didier) → concours créé en ligne → l'épreuve de Grâce,
         résultat immédiat → résultats scellés, plus d'appels ni de réclamations → Clarisse respire.
OUTPUT:  HyperFrames, 1920 x 1080, 30 fps, 79 s, voix off française.
PERSOS:  dessin vectoriel animé (assets/rig.js, même mécanique que le film Liputa) :
         Clarisse, DRH, tailleur bleu nuit, lunettes, badge ; Grâce, candidate, tresses, haut violet ;
         Didier, DRH ami, présent par son message (avatar « D »).
VOIX:    narratrice SIWIS ; Grâce UPMC Jessica ; Didier UPMC Pierre (tools/voix_off.py).
LOOK:    bureau gris-bleu #EEF1F6, nuit #1B2440 sous la lampe, chambre lavande de Grâce ;
         encre #14213D, bleu SELECTA #0B5FFF, rouge #C23A33 réservé aux coûts et contestations,
         vert #138A5E réservé à ce qui est vérifié. Inter. Vrais écrans SELECTA dans un ordinateur.
```

## Scènes

| Scène (fichier) | Temps | Ce qu'on voit |
|---|---|---|
| `bureau` | 0–25 s | Titre « Kinshasa » ; Clarisse et l'affiche « 40 agents » ; factures (salles, surveillants, copies : 6 900 $) ; piles de copies et semaines de correction ; Grâce appelle pour ses résultats ; réclamation « CONTESTÉ », copies identiques ; la nuit. |
| `message` | 24,6–39,6 s | La nuit, Didier écrit : « Passe à SELECTA… corrigé en une minute » ; l'espoir. L'aube : tableau de bord SELECTA ; salle et copies barrées. |
| `epreuve` | 39,2–57,4 s | Chez Grâce : code personnel, épreuve, caméra (identité vérifiée, visage toutes les 8 s), résultat « Admis » dès la dernière page ; « Admise ? Déjà ? ». |
| `confiance` | 57–71,2 s | Procès-verbal scellé (sceau), vérification par code QR sur téléphone ; téléphone barré, « 0 réclamation » ; Clarisse respire. |
| `fin` | 70,8–79 s | Clarisse et Grâce saluent ; sceau, SELECTA, slogan, essai gratuit de 14 jours. |
