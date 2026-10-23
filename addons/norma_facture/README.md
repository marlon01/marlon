# NORMA — Facturation normalisée DGI (République démocratique du Congo)

*Une solution **Naxoris**. Démonstration : +243 828 317 540 · +243 831 509 420 · contact@naxoris.com*

Module Odoo 18 Community (`norma_facture`) entièrement piloté par des applications **OWL autonomes** : aucune vue, aucun menu ni aucune mention d'Odoo n'apparaît aux utilisateurs. Les comptes des entreprises sont de type portail : le client web générique (`/odoo`) leur est fermé et les renvoie vers leur espace.

| Adresse | Qui | Contenu |
|---|---|---|
| `/norma` | tout le monde | présentation, métiers, conformité |
| `/norma/signup` | entreprises | création du compte (catégorie, NIF, RCCM, Id. Nat., premier établissement, administrateur) |
| `/norma/login` | personnel des entreprises, plateforme | connexion unique, limitée en tentatives |
| `/norma/app` | personnel des entreprises | espace de vente selon le métier, factures, rapports, paramètres |
| `/norma/platform` | administration centrale (Naxoris) | entreprises, vérification, suspension, groupes de taxation |
| `/norma/print/<id>?format=a4\|ticket` | personnel | facture A4 ou ticket 80 mm |
| `/norma/v/<jeton>` | public (QR code) | vérification de la facture |

## Cadre réglementaire pris en compte

* **Ordonnance-loi 10/001** (TVA), art. 58 modifié par la **Loi de finances 2023** : facture normalisée émise par un dispositif électronique fiscal (DEF) ; amende de 10 M CDF par facture non normalisée.
* **Décret 23/10 du 3 mars 2023** et **arrêtés 032 à 035 du 23 octobre 2023** (mesures d'application, homologation des systèmes de facturation), **arrêté 016/2025**.
* Calendrier : homologation des SFE ouverte en juin 2025, généralisation en août puis décembre 2025, **fin du moratoire des sanctions le 31 mars 2026**.
* Taux : 16 % (normal), 8 % (première nécessité), 5 % et 1 % (Loi de finances 2026 et LFR n° 26/032 du 7 août 2026), 0 % à l'exportation.

NORMA est un **SFE** (système de facturation d'entreprise) relié à l'**e-MCF** (module de contrôle de facturation en ligne de la DGI, API v1.3). Chaque établissement a son propre e-MCF (jeton, ISF, NID).

## Catégories et interfaces

| Catégorie | Espace de vente |
|---|---|
| Supermarché, magasin, pharmacie, station-service | **Caisse rapide** : lecteur de codes-barres (`3*code` = trois unités), F2 recherche, F9 encaissement, paiement mixte, rendu de monnaie, ticket 80 mm |
| Hôtel | **Plan des chambres** par étage : arrivée (client enregistré), nuitées portées automatiquement, consommations et services sur la note, départ = une facture, chambre « à nettoyer » ensuite |
| Restaurant, bar | **Plan de salle** : ouverture de table, commandes, envoi en cuisine, changement de table, encaissement ; vente au comptoir |
| Services, BTP, commerce de gros | **Éditeur de facture** : client identifié, FV, FT (acompte), EV/ET (exportation), facture à crédit, référence de commande |

À l'inscription, un catalogue de départ adapté au métier est créé (rayons, articles, chambres ou tables) : l'entreprise facture immédiatement en mode simulation.

## Conformité DGI

* **Calcul serveur conforme aux Spécifications SFE (1.5)** — `lib/fiscal.py`, sans dépendance à Odoo :
  prix à 2 décimales, quantités à 3, total **par groupe de taxation**, TVA extraite du TTC et **arrondie au centime supérieur** (base + TVA = total), taxe spécifique incluse dans la base de TVA, groupe N entièrement TVA. Le navigateur n'envoie jamais un montant, une taxe ni un prix (sauf un gestionnaire, explicitement).
* **Montants transmis en CDF**, y compris pour une facture en USD (`curCode`, `curRate`, `curDate`, taux du jour enregistré sur la facture, équivalent imprimé).
* **Groupes de taxation A à S** (nomenclature FACNO v2.0) modifiables par la plateforme et resynchronisables depuis `/api/info/taxGroups`.
* **Types de facture** FV, FT, FA, EV, ET, EA ; **types de client** PP, PM, PC, PL, AO (NIF obligatoire pour PM/PC/PL, référence d'exonération pour AO) ; **natures d'article** BIE, SER, TAX ; **paiements** ESPECES, MOBILEMONEY, CARTEBANCAIRE, VIREMENT, CHEQUES, CREDIT, AUTRE.
* **Circuit e-MCF** (`models/emcf.py`) : `POST /api/invoice` → comparaison des totaux de la DGI avec les nôtres (écart = annulation de la demande et blocage) → `PUT …/confirm` avec `total`/`vtotal` → enregistrement de `codeDEFDGI`, `counters`, `nim`, `dateTime`, `qrCode`.
* **Factures définitives** : une facture normalisée ne se modifie ni ne se supprime (contrôle dans le modèle et droits en lecture seule). Correction = **facture d'avoir** FA/EA avec la nature (COR, RAN, RAM, RRR), le code DEF/DGI d'origine et le motif, **plafonnée ligne par ligne** à ce qui reste de la facture d'origine.
* **Numérotation sans trou** par établissement et par type (`KIN-01-FV-2026-000184`) ; le numéro est le `rn` transmis ; le code de l'établissement figure aussi dans le commentaire `cmta`. Une facture abandonnée garde son numéro et son motif.
* **Mentions imprimées** (A4 et ticket) : vendeur (nom, NIF, RCCM, Id. Nat., adresse, centre des impôts, ISF), titre selon le type, numéro, date, client (type, NIF, adresse), établissement (code, adresse, NID), opérateur, mode TTC, devise et taux, lignes avec groupe, ventilation HT/TVA/TTC par groupe en CDF, taxe spécifique, paiements, montant en lettres, bloc de sécurité (QR code DGI, code DEF/DGI, NID, compteurs, heure DEF). Tant que la DGI n'a pas confirmé : **« NE VAUT PAS FACTURE »**. En simulation ou en test : **« SANS VALEUR FISCALE »**.
* **Coupures** : l'`uid` est enregistré dès réception ; reprise automatique toutes les 5 minutes qui **relit les demandes en attente** (rapprochement par `rn`) au lieu d'envoyer un doublon ; l'état « confirmation à vérifier » est enregistré **avant** la confirmation et n'est jamais renvoyé à l'aveugle (vérification sur le portail DGI, puis levée en recopiant le numéro).
* **Rapports fiscaux** (période, rapport Z du jour) : par groupe de taxation, type, mode de paiement, établissement ; export CSV détaillé.

## Sécurité

* Cloisonnement par entreprise (règles d'accès sur tous les modèles) et **par établissement** pour le caissier.
* Rôles : caissier/réception < gestionnaire/comptable < administrateur ; remise maximale du caissier, prix modifiables par le seul gestionnaire.
* La façade (`models/api.py`) est le seul chemin d'écriture : méthodes **privées** (`@api.private`, refusées par `/web/dataset/call_kw`), contrôle du rôle, de l'entreprise et de son état ; les comptes des entreprises n'ont **aucun droit d'écriture ORM** direct ; un enregistrement ne change jamais d'entreprise.
* **e-MCF** : adresses limitées aux serveurs de la DGI déclarés par la plateforme (`norma.emcf_allowed_hosts`, HTTPS, port 443, sans redirection) ; jeton jamais réaffiché ni journalisé ; NIF du jeton comparé au NIF de l'entreprise ; **sortie du mode simulation réservée aux entreprises vérifiées par la plateforme** (RCCM, NIF, mandat).
* Journal d'audit **chaîné SHA-256** par entreprise et **chaîne des factures normalisées** (empreinte de chaque facture), vérifiables dans « Intégrité » ; journal des échanges e-MCF en ajout seul.
* Connexion limitée (par adresse et par identifiant, valable sur toutes les routes), inscription limitée (5/jour/adresse, champ piège), clé d'idempotence sur chaque vente (pas de double facture en cas de double clic ou de requête rejouée), verrous contre les transmissions et avoirs concurrents.
* En-têtes `X-Frame-Options: DENY`, `nosniff`, `no-store` ; logo par défaut en SVG servi avec CSP ; export CSV protégé contre l'injection de formules.

## Tests

```bash
odoo-bin -d <base> -i norma_facture --test-tags /norma_facture --stop-after-init
```
52 tests : moteur fiscal (arrondis SFE, taxe spécifique, groupe N, montant en lettres), normalisation, numérotation, immuabilité, avoirs, cloisonnement, rôles, devises, exportation, types de client, écart de calcul, coupure réseau, confirmation incertaine, intégrité, hôtel, restaurant, pages HTTP (impression, vérification, export, connexion), régressions de sécurité.

## Avant l'homologation : ce qui reste à faire avec la DGI

Les spécifications officielles (« API e-MCF v1.3 », « Spécifications SFE », jeux de tests) ne sont publiées que sur le portail développeur de la DGI. Le connecteur suit la v1.3 telle que documentée par des intégrations déjà testées sur le bac à sable ; avant le dépôt du dossier :

1. Ouvrir un compte sur **developper.dgirdc.cd**, télécharger le `swagger.json` et les spécifications, et comparer champ par champ (`models/emcf.py`, méthode `_payload`).
2. Obtenir un jeton de test et l'**ISF**, valider la plateforme (bouton « Vérifier »), passer l'établissement de démonstration en « Test DGI » et dérouler les cas de test officiels (vente, avoir, exportation, devise, coupure, double envoi, impression).
3. Confirmer les points non publics : format exact du QR code, liste à jour des groupes de taxation et de leurs taux (bouton de synchronisation), règle officielle en cas de coupure prolongée, durée de conservation (10 ans retenus par prudence, règle OHADA).
4. Déposer la demande d'homologation (lettre au Directeur général des impôts, dossier technique, démonstration). Après toute modification des spécifications par la DGI, une ré-homologation ciblée est exigée.
5. Production : HTTPS, `proxy_mode = True`, `list_db = False`, une base, sauvegardes chiffrées quotidiennes, `web.base.url` figée.
