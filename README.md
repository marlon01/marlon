# SELECTA — La culture de l'excellence

*Une solution **Naxoris**. Démonstration : +243 828 317 540 · +243 831 509 420 · contact@naxoris.com*

Module Odoo 18 Community (`selecta_concours`) entièrement piloté par des applications **OWL autonomes** : aucune vue native Odoo n'est utilisée. Le serveur s'installe sur un simple ordinateur de la salle d'examen et fonctionne **sans Internet**.

---

## SELECTA SaaS — plateforme multi-structures

Le module **`selecta_saas`** transforme SELECTA en service en ligne : chaque entreprise, école ou administration crée elle-même son espace, l'utilise gratuitement pendant 14 jours, puis souscrit un abonnement selon sa catégorie. Sans ce module, `selecta_concours` reste la solution installée en salle d'examen, hors ligne, décrite plus bas.

### Parcours d'une structure
1. **Découverte** : page de présentation et tarifs publique, `https://<domaine>/selecta` (la racine du site y mène).
2. **Inscription** : `/selecta/signup`. Catégorie, nom de la structure, administrateur (e-mail = identifiant), mot de passe. L'espace est créé immédiatement et l'essai démarre : pas de carte bancaire.
3. **Essai gratuit** : 14 jours (réglable), toutes les fonctions de la catégorie, jusqu'à 100 candidats (réglable). Un bandeau indique les jours restants.
4. **Abonnement** : page « Abonnement » de la console. La structure choisit sa catégorie et son cycle (mensuel, ou annuel avec 2 mois offerts) ; une facture est émise ; elle paie (Mobile Money, virement, lien de paiement en ligne) puis **déclare son paiement** avec la référence de transaction et un justificatif. L'administration centrale valide : l'abonnement est prolongé, les jours d'essai restants sont conservés.
5. **Échéance** : 3 jours de grâce (réglable), puis **consultation seule** : plus de création de concours, d'inscription de candidats ni d'ouverture d'épreuve, mais résultats, procès-verbaux et exports restent accessibles. Une épreuve déjà ouverte se termine normalement.
6. **Suspension** (décision de la plateforme) : accès bloqué, y compris aux candidats.

### Catégories (grille par défaut, modifiable dans l'administration centrale)

| Catégorie | Mensuel | Annuel | Concours actifs | Candidats / mois | Personnel | Analyse IA | Assistant LLM | Personnalisation |
|---|---|---|---|---|---|---|---|---|
| École / ONG | 29 $ | 290 $ | 3 | 300 | 5 | oui | non | non |
| PME | 79 $ | 790 $ | 10 | 1 500 | 15 | oui | non | oui |
| Grande entreprise | 199 $ | 1 990 $ | illimité | 10 000 | 50 | oui | oui | oui |
| Administration publique | 349 $ | 3 490 $ | illimité | illimité | illimité | oui | oui | oui |

### Administration centrale — `/selecta/platform`
Réservée au groupe « Administrateur de la plateforme (SaaS) » (compte `admin` à l'installation, redirigé automatiquement après connexion).
* **Vue d'ensemble** : structures par statut, revenu mensuel et annuel récurrent (MRR / ARR), conversion essai → payant, encaissements du mois, inscriptions par semaine, encaissements par mois, répartition par catégorie, essais qui se terminent.
* **Structures** : recherche et filtres ; fiche détaillée (consommation, factures, personnel, concours, intégrité du journal d'audit, lien de l'espace candidat, notes internes) ; actions : prolonger l'essai, activer manuellement (contrat, bon de commande), changer de catégorie, suspendre, réactiver.
* **Paiements** : file des paiements déclarés, justificatif, validation ou refus motivé (la structure voit le motif).
* **Catégories et tarifs** : prix, quotas, fonctions incluses, mise en avant, activation.
* **Paramètres** : durée d'essai, délai de grâce, plafond de candidats pendant l'essai, ouverture des inscriptions, instructions de paiement, lien de paiement en ligne (https), support, émetteur des factures.

### Cloisonnement des données
Chaque structure est une société Odoo distincte ; ses comptes n'appartiennent qu'à elle.
* Règles d'accès par structure sur toutes les données SELECTA : concours, questions et propositions (y compris les corrigés), candidats, épreuves, réponses, preuves de surveillance, journal d'audit.
* **Un journal d'audit chaîné par structure**, vérifiable par elle seule ; le sceau des procès-verbaux est calculé sur sa propre chaîne. Numérotation des concours propre à chaque structure.
* Liaisons inter-structures refusées (une structure ne peut ni utiliser les questions d'une autre, ni y déplacer ses données).
* Champs du moteur (cycle de vie, scellés, codes) non modifiables par appel direct ; les drapeaux internes du moteur ne sont jamais acceptés depuis une requête.
* Personnel limité à sa structure ; le client Odoo générique (`/odoo`) est inaccessible au personnel des structures.
* Paramètres communs au serveur (assistant LLM, anti force brute) réservés à l'administrateur système.
* Limitation des tentatives fondée sur l'adresse réelle de la connexion (`proxy_mode` derrière le proxy), pas sur un en-tête falsifiable.
* Tests automatisés : `odoo-bin -d <base> -i selecta_saas --test-tags /selecta_saas --stop-after-init` (38 tests : cloisonnement, quotas, consultation seule, facturation, proratisation, paiement en ligne simulé, courriels, conservation des données, régressions de sécurité).

### Mise en ligne (Docker, HTTPS automatique)
```bash
cd docker/saas
cp .env.example .env            # domaine, e-mail de l'administrateur, mot de passe de la base
# changer admin_passwd dans odoo-saas.conf
docker compose up -d
docker compose run --rm odoo odoo -d selecta -i selecta_saas --without-demo=all --load-language=fr_FR --stop-after-init
```
Puis `https://<domaine>/selecta/login` avec `admin / admin` : **changer ce mot de passe immédiatement**, et renseigner les instructions de paiement dans l'administration centrale. Caddy obtient le certificat HTTPS et masque le gestionnaire de bases ; Odoo n'est pas exposé directement.

Exploitation : sauvegarde quotidienne de la base (`pg_dump`) et du volume `selecta-data` ; la tâche planifiée « fin d'essai et échéances d'abonnement » tourne toutes les heures (l'accès est de toute façon calculé en temps réel).

### Mise à jour d'une installation existante
`-u selecta_concours` migre le journal d'audit : l'historique existant est rattaché à la structure principale, où il reste intégralement vérifiable.

### Courriels
Les courriels sont mis en file puis envoyés toutes les 5 minutes : une panne du serveur de messagerie ne bloque jamais une inscription ou un paiement, et chaque envoi est tracé (fiche de la structure, onglet « Courriels »).
* **Structures** : bienvenue à l'inscription, rappels de fin d'essai (J-3, J-1), fin d'essai, rappels de renouvellement (J-7, J-1), abonnement échu, facture émise, paiement validé ou refusé, suspension et réactivation.
* **Plateforme** : nouvelle inscription, paiement déclaré à valider.
* Configuration : administration centrale → Paramètres → Messagerie (serveur SMTP, expéditeur, e-mail d'alerte, envoi de test), puis activer l'envoi. Chaque rappel n'est envoyé qu'une fois par échéance.

### Paiement en ligne
* **CinetPay** : Mobile Money (M-Pesa, Airtel Money, Orange Money) et cartes, Afrique francophone dont la RDC. Renseigner le Site ID et la clé API, activer les paiements en USD sur le compte CinetPay et déclarer l'URL de notification affichée dans les paramètres.
* **Stripe** : cartes bancaires internationales (clé secrète `sk_live_…`).
* Sécurité : un retour navigateur ou une notification ne valide jamais un paiement à eux seuls ; le serveur interroge le prestataire et vérifie statut, montant et devise avant d'activer l'abonnement. Une vérification automatique toutes les 15 minutes rattrape les notifications perdues (48 h).
* Les paiements hors ligne (instructions Mobile Money, virement, lien externe) restent possibles, avec déclaration et validation centrale.
* **Prérequis** : l'adresse publique du site doit être exacte pour les retours de paiement et les liens des courriels. Dans Odoo (mode développeur → Paramètres techniques → Paramètres système), fixer `web.base.url` à `https://<domaine>` et créer `web.base.url.freeze` = `True`.

### Changement de catégorie
* **Vers une catégorie supérieure** : la valeur non consommée de la période payée est déduite (avoir arrondi au dollar inférieur) et une nouvelle période démarre au paiement.
* **Vers une catégorie inférieure** : elle s'applique à l'échéance de la période en cours ; la structure conserve sa catégorie actuelle jusque-là.
* Un renouvellement dans la même catégorie s'ajoute à la période en cours ; un abonnement souscrit pendant l'essai conserve les jours d'essai restants.

### Données personnelles et documents juridiques
* Pages publiques `/selecta/conditions` (conditions d'utilisation) et `/selecta/confidentialite` (politique de confidentialité), liées depuis l'inscription, la page de présentation et chaque courriel. L'acceptation (date et version) est enregistrée à l'inscription.
* Les textes par défaut reprennent automatiquement les paramètres en vigueur (durée d'essai, délai de grâce, durée de conservation). Ils peuvent être remplacés depuis Paramètres → Documents juridiques. **Ce sont des modèles : faites-les relire par un juriste avant la mise en production.**
* **Conservation des données biométriques** : photos d'identité, gabarits faciaux et clichés probatoires sont effacés automatiquement N jours après la clôture du concours (180 par défaut, réglable ; 0 = conservation illimitée). Résultats, procès-verbaux et motifs d'incident sont conservés ; chaque effacement est consigné dans le journal d'audit.
* Logo par défaut : un monogramme aux initiales de la structure, remplaçable dans ses paramètres (catégories avec personnalisation).

### Limites actuelles
* Paiement en ligne non testé contre les API réelles de CinetPay et Stripe (aucun compte marchand disponible pendant le développement) : les échanges sont couverts par des tests simulés. À valider avec un compte de test de chaque prestataire avant l'ouverture.
* Pas de proratisation pour un passage à une catégorie inférieure (il prend effet à l'échéance, sans avoir).
* Les courriels sont en français uniquement.

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
selecta_saas/
  models/      catégories, structures clientes, factures, garde (quotas, consultation seule), API plateforme
  controllers/ présentation, inscription, administration centrale
  static/src/  signup/ (inscription), tenant/ (abonnement dans la console), platform/ (administration centrale)
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
