# SELECTA — La culture de l'excellence

*Une solution **Naxoris**. Démonstration : +243 828 317 540 · +243 831 509 420 · contact@naxoris.com*

Module Odoo 18 Community (`selecta_concours`) entièrement piloté par des applications **OWL autonomes** : aucune vue native Odoo n'est utilisée. Le serveur s'installe sur un simple ordinateur de la salle d'examen et fonctionne **sans Internet**.

---

## 1. Ce que la solution garantit

| Exigence | Réponse SELECTA |
|---|---|
| Résultats immédiats | Correction automatique à la validation de la dernière page : pourcentage et décision (Admis / Non admis) affichés au candidat, liste des admis mise à jour en temps réel, produite définitivement à la clôture (automatique quand tous les inscrits ont terminé). |
| Code secret par candidat | 12 caractères (≈ 60 bits), alphabet sans caractères ambigus, **jamais stocké en clair** (HMAC-SHA256), affiché une seule fois sur la convocation imprimée. Verrouillage du poste après 8 essais infructueux. Une seule session active par candidat. |
| QCM paramétrables | Choix unique ou multiple, barème par question, matières, difficulté, illustrations, import CSV, tirage aléatoire individuel, mélange des questions et des propositions, pénalité optionnelle, crédit partiel. |
| Pas de retour arrière | Le serveur n'accepte que la page courante ; une page validée est définitive (réponses scellées en base). Bouton « Précédent » du navigateur neutralisé. |
| Chronomètre | Démarre à l'affichage du questionnaire. Autorité du serveur, horloge monotone côté poste (changer l'heure du PC ne sert à rien). À zéro, la page est soumise et l'épreuve close ; une tâche planifiée clôt aussi les épreuves abandonnées. |
| Surveillance IA par webcam | Vision 100 % locale (aucun flux vidéo transmis) : visage absent, plusieurs personnes, regard détourné (orientation de la tête), **contrôle continu d'identité biométrique** (comparaison client + vérification serveur), caméra masquée/coupée, changement d'onglet, sortie du plein écran, copier-coller, raccourcis interdits. Trois niveaux : tolérant, standard, tolérance zéro. Disqualification définitive avec cliché probatoire horodaté. |
| Anti-corruption | Aucune note n'est modifiable, même par un administrateur (écritures refusées hors moteur). Questionnaire figé à l'ouverture et empreinte SHA-256 consignée. Journal d'audit **chaîné** (toute altération en base est détectée). Procès-verbal scellé + QR code + page publique de vérification. Reçu de dépôt remis au candidat. Séparation des rôles. |
| Anti-tricherie | Ordre et propositions différents pour chaque voisin, filigrane nominatif, mode kiosque, détection de collusion statistique après l'épreuve. |
| IA d'analyse | Psychométrie (difficulté, discrimination 27 %, point-bisérial, fiabilité KR-20, erreur-type), analyse des distracteurs, **détection de clés de correction erronées**, collusion (réponses fausses identiques, modèle de Poisson, p < 0,001), vitesse anormale (z robuste), réponses au hasard, risque de surveillance, simulation de seuil, indice d'intégrité. Rapport rédigé optionnel par un LLM local (Ollama), données anonymisées. |
| Hors ligne | Aucun appel Internet. Mode résilience : si le réseau local coupe, le candidat continue (questionnaire préchargé **sans corrigé**), réponses et incidents sont mis en file sécurisée puis synchronisés dans l'ordre. Application installable (PWA). |
| Toute structure | Multi-structures (cloisonnement par société), logo, couleur et slogan personnalisables. |

## 2. Rôles et pages

* **Connexion du personnel** : `/selecta/login` · **Espace candidat** : `/selecta/exam` · **Console** : `/selecta/admin` · **Vérification publique** : `/selecta/verify/<empreinte>`
* Administrateur concours : tout. Concepteur : banque de questions et paramétrage. Jury : résultats, analyse IA, clôture, publication. Surveillant : suivi en direct, reprise sur incident, disqualification motivée — **sans jamais voir questions ni corrigés**.

Console : tableau de bord, concours (cycle Préparation → Validé → Ouvert → Clôturé → Publié), banque de questions, candidats (import CSV, génération et impression des convocations), surveillance en direct, résultats (Excel, impression du PV), analyse IA, journal d'audit (vérification d'intégrité), personnel et accès, paramètres.

## 3. Installation

### Windows 10/11 (recommandé pour un poste serveur de salle)
1. Copier le dossier `selecta` sur le PC serveur (pour une installation sans Internet, déposer `odoo_18.0.latest.exe` dans `installer\windows`).
2. Double-cliquer sur `installer\windows\Installer-SELECTA.bat` (droits administrateur).
3. Se connecter sur `http://localhost:8069/selecta/login` avec `admin / admin` et **changer le mot de passe**.

### Linux (Ubuntu 22.04/24.04, Debian 12)
```bash
sudo ./installer/linux/install.sh            # ajouter --demo pour le concours de démonstration, --https pour TLS local
```

### Docker
```bash
cd docker && docker compose up -d
docker compose run --rm odoo odoo -d selecta -i selecta_concours --without-demo=all --stop-after-init
```

### Odoo 18 existant
Copier `addons/selecta_concours` dans un dossier de l'`addons_path`, mettre à jour la liste des applications et installer « SELECTA ».

## 4. Postes candidats

Lancer `SELECTA-Poste-Candidat.bat` (Windows) ou `selecta-poste-candidat.sh` (Linux) après avoir renseigné l'adresse du serveur (`serveur.txt`). Le navigateur s'ouvre en **kiosque** (plein écran, sans barre d'adresse), profil jetable, caméra autorisée.

> Les navigateurs n'autorisent la caméra qu'en contexte sécurisé : le lanceur déclare le serveur de la salle comme origine de confiance. Alternative : `install.sh --https` puis installation du certificat sur les postes. Pour un verrouillage maximal, déployer en plus la stratégie Chrome/Edge `DeveloperToolsAvailability = 2`.

Matériel conseillé : webcam 720p, éclairage de face, Chrome/Edge récent. Serveur : 4 cœurs, 8 Go de RAM (indicatif) pour quelques centaines de candidats simultanés (`workers = 4`) ; à valider par un test de charge avant un grand concours.

## 5. Déroulé type d'un concours
1. Banque de questions (saisie ou import CSV, modèle téléchargeable).
2. Nouveau concours : durée, questions par page, tirage, seuil, places, surveillance.
3. Valider le questionnaire (contrôle de cohérence automatique).
4. Inscrire les candidats (CSV `reference;nom;email;telephone;salle;piece_identite`), **générer et imprimer les convocations**.
5. Ouvrir l'épreuve le jour J ; suivre la salle en direct.
6. Clôture (automatique ou manuelle) → liste des admis ; consulter l'analyse IA ; **publier et sceller** le procès-verbal.

## 6. Démonstration
Installée avec les données de démonstration, la base contient un concours ouvert de 16 questions et 5 candidats. Codes : `DEMO-2026-0001` à `DEMO-2026-0005`. Ne jamais activer les données de démonstration en production.

## 7. Assistant LLM local (facultatif)
```bash
# sur le serveur
ollama pull llama3.1:8b
```
Paramètres → Assistant : activer, point d'accès `http://127.0.0.1:11434/v1/chat/completions`. Sans assistant, toute l'analyse experte reste disponible.

## 8. Sécurité — points d'exploitation
* Changer `admin/admin`, conserver le mot de passe maître généré, gestionnaire de bases désactivé (`list_db = False`).
* Sauvegarder la base après chaque concours (`pg_dump`).
* Les clichés probatoires sont des données personnelles : définir leur durée de conservation conformément à la réglementation applicable.
* Limites assumées : la vision par ordinateur réduit fortement la fraude mais ne remplace pas totalement la présence d'un surveillant ; les seuils (durées tolérées, niveau) sont réglables par concours pour limiter les faux positifs.

## 9. Architecture technique
```
selecta_concours/
  models/      moteur d'épreuve, audit chaîné, IA d'analyse, façade back-office
  controllers/ API candidat (jeton d'épreuve), authentification, export, vérification
  security/    4 groupes, ACL, règles multi-structures (corrigés invisibles aux surveillants)
  static/src/  exam/ (OWL candidat + surveillance IA + file hors ligne), admin/ (console OWL), login/, sw/ (PWA)
  static/lib/face-api/  moteur de vision et modèles embarqués (fonctionnement hors ligne)
```

## 10. Contact
**Naxoris**, éditeur de SELECTA.
Démonstration et devis : **+243 828 317 540**, **+243 831 509 420**, **contact@naxoris.com**
