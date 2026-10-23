# SPEC — Liputa « Un samedi à l'atelier »

```text
GOAL:    un chef d'atelier se reconnaît dans le samedi débordé de gauche et veut le calme de droite :
         il retient « mes dates tenues, mes clientes qui ne m'appellent plus pour demander ».
OUTPUT:  HyperFrames, 1920 x 1080, 30 fps ; version française (voix off), anglaise ensuite.
TIME:    54 s x 30 = 1620 images. La voix off est l'horloge : chaque plan commence sur son mot
         d'ancrage (SCRIPT.md). Musique sous la voix à 0,14.
LOOK:    deux matières, une par moitié.
         Gauche, « avant » : papier kraft #E9DCC4 avec 3 % de grain, encre bille bleue #1F3A8A,
         ratures, tampon d'appels manqués rouge #D6453D. Dessiné et assumé comme illustration :
         aucun faux écran.
         Droite, « avec Liputa » : le papier de l'appli #F5F6FA, encre #16213E, feuilles #FFFFFF
         à 28 px de rayon, ombre 0 18px 40px rgba(22,33,62,0.12). Accent unique : le jaune
         ruban-mètre #F2C230, réservé au mètre ruban, à la date de livraison et au carton final.
         Vert #138A5E seulement pour « À retirer ».
         Titres : Bricolage Grotesque 700 (police de la marque, assets/fonts), 96 px, -2 % ;
         une ligne à l'écran à la fois, 6 mots au plus. Pas de sous-titres de la voix.
OBJECTS: le carnet de mesures (spirale, pages quadrillées, chiffres raturés) ; le téléphone à clapet
         posé sur la table qui vibre ; le mètre ruban jaune, graduations noires tous les 10 px,
         chiffres tous les 50 ; les écrans réels de Liputa (assets/screens), recadrés sur le bloc
         utile et montrés à 1,6–2× leur taille, jamais un petit téléphone au milieu du vide.
MOTION:  entrées power3.out sur 14 images ; déplacements de caméra power2.inOut sur 18 images ;
         sorties power2.in sur 10 images. Le mètre ruban se déroule en expo.out sur 24 images.
         Un seul mouvement principal par plan, le secondaire part 4 images après et va 60 % moins loin.
SHOTS:
  1   0–150    (0–5 s)    Plein cadre gauche : le carnet ; un stylo rature « 94 » ; le téléphone
                           vibre. Lit : « Samedi, 9 h ». Son : stylo, vibreur. Passe : le mètre
                           ruban traverse l'image de gauche à droite et coupe l'écran en deux.
  2   150–510  (5–17 s)    Gauche seule, trois temps sur la voix : carnet → pile d'appels manqués
                           (3 tampons rouges) → calendrier griffonné « jeudi ? vendredi ? ».
                           Son : sonneries qui se chevauchent, de plus en plus serrées.
  3   510–630  (17–21 s)   Le mètre ruban se déroule et ouvre la moitié droite : accueil Liputa,
                           « 2,4 j de travail en attente ». Titre : « Chaque commande à sa place ».
                           Son : les sonneries coupent net, la musique entre.
  4   630–780  (21–26 s)   Droite, « Mesures » : poussée sur 94 / 74 / 102 cm, les trois valeurs
                           se posent en jaune. Gauche : le carnet s'agite encore.
  5   780–930  (26–31 s)   « Patron » : le tracé du patron se dessine, « 3,22 m de tissu ».
                           Son : ciseaux.
  6   930–1110 (31–37 s)   Fiche de Chantal Kabeya : « Livraison prévue mercredi 28 octobre » ; le
                           mètre ruban de la date se remplit ; « charge en attente » lisible 2 s.
  7   1110–1260 (37–42 s)  Planning du samedi 24 : la caméra descend les cartes de Junior, Nadège,
                           Sarah ; une coche verte se pose. Son : machine à coudre.
  8   1260–1410 (42–47 s)  Suivi client public : « À retirer » s'allume en vert. Son : notification.
  9   1410–1500 (47–50 s)  La moitié gauche se replie comme une page de carnet et disparaît ; la
                           droite occupe tout l'écran. Son : page tournée, la musique s'ouvre.
  10  1500–1620 (50–54 s)  Carton final : le mètre ruban s'enroule et forme le cercle du logo,
                           « Liputa » s'écrit à côté, puis « Le sur-mesure, à l'heure » et
                           « Essai gratuit de 14 jours ». Tenu 2,5 s.
BANNED:  fond sombre avec petits éléments flottants ; lueurs, particules ; dégradés violets ou
         bleus ; trois cartes en ligne ; titre sur une capture assombrie ; logo dans un coin ;
         tout qui glisse vers le haut en fondu ; faux écrans de Liputa ; téléphone incliné en 3D ;
         chiffres inventés.
QA:      img 75 (carnet lisible, téléphone visible) ; img 570 (les deux moitiés, accueil Liputa
         lisible) ; img 700 (94 / 74 / 102 lisibles à ≥ 28 px) ; img 1000 (date de livraison
         lisible) ; img 1180 (noms des tailleurs lisibles) ; img 1330 (« À retirer » en vert) ;
         img 1600 (logo, slogan et essai gratuit, rien d'autre).
```

## Matériel

- Écrans réels : `assets/screens/01` à `12` (atelier fictif de `tools/liputa_film_seed.py`).
- Logo : `liputa/liputa_couture/static/description/icon.svg`.
- Police : `liputa/liputa_couture/static/src/app/fonts/BricolageGrotesque.ttf` (licence OFL).
- Voix off : selon le choix (voir la note de livraison) ; musique et bruitages : bibliothèque
  locale de `/media-use` et Openverse.
