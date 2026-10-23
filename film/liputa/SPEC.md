# SPEC — Liputa « L'atelier respire » (v2)

La v1 (« Un samedi à l'atelier », 44,5 s, commit dc7cc3d) était jugée trop plate : pas de
personnage, pas d'émotion. La v2 raconte une histoire avec des personnages.

```text
GOAL:    une couturière se reconnaît dans Nadège, débordée, puis veut ce qu'elle vit ensuite :
         « mon atelier respire, mes clientes suivent leur commande sans m'appeler ».
ARC:     difficulté → bouche-à-oreille (Papy) → création de l'atelier virtuel → l'atelier respire
         → l'annuaire noté fait connaître l'atelier (WhatsApp) → la cliente installe l'application,
         notifiée téléphone verrouillé → cinq étoiles, Nadège notifiée → appel à l'action.
OUTPUT:  HyperFrames, 1920 x 1080, 30 fps, 90 s, voix off française.
PERSOS:  dessin vectoriel animé (assets/rig.js) :
         Nadège, couturière, robe wax verte, foulard wax orange, mètre ruban jaune au cou ;
         Chantal, cliente, couettes afro, haut jaune puis robe wax le jour du retrait ;
         Papy, tailleur, présent par son message (avatar « P »).
         Six visages : neutre, inquiète, sourire, soulagée, espoir, joie ; clignements,
         respiration, regard, bouche qui parle sur les répliques.
VOIX:    narratrice SIWIS ; Chantal UPMC Jessica ; Papy UPMC Pierre (tools/voix_off.py,
         lexique « Kinshasa » → kinʃasa).
LOOK:    matin crème #F1E3CC, nuit bleue #1B2440 sous une lampe chaude, aube dorée ;
         encre #16213E, jaune ruban-mètre #F2C230, vert #138A5E réservé à « À retirer ».
         Bricolage Grotesque (marque). Écrans réels de Liputa dans un grand téléphone à droite.
```

## Scènes

| Scène (fichier) | Temps | Ce qu'on voit |
|---|---|---|
| `atelier` | 0–21,8 s | Titre « Kinshasa » sur carton crème ; Nadège à sa table ; appels manqués et papiers qui s'empilent, mains sur la tête ; la porte s'ouvre, des clientes passent ; Chantal demande sa robe, Nadège promet avec un sourire forcé ; la nuit tombe. |
| `message` | 21,4–35,4 s | La nuit, sous la lampe : le téléphone vibre, message de Papy ; l'espoir. L'aube : création de l'atelier sur le vrai formulaire, « Bonjour Nadège ». |
| `renouveau` | 35–51,4 s | Chaque papier d'hier se retourne en fiche nette (mesures, tissu, tailleur, date) au rythme des écrans : essayage, patron, planning, commande. Nadège ferme les yeux, inspire : la lumière s'ouvre. |
| `vitrine` | 51–62,4 s | « Les mieux notés, en premier » : la carte de Nadège passe devant ; annuaire réel (`/c`) ; une nouvelle cliente touche WhatsApp, conversation. |
| `cliente` | 62–80 s | Chantal installe Liputa ; écran verrouillé, notification « À retirer » ; suivi ; moto et téléphone barrés ; iris vers l'atelier, la robe ; cinq étoiles ; notification « Nouvel avis » chez Nadège. |
| `fin` | 79,6–90 s | Nadège et Chantal saluent ; logo, « Le sur-mesure, à l'heure », « Trouvez votre atelier, ou créez le vôtre », gratuit pour les clients, 14 jours d'essai pour les ateliers. |
