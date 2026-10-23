# LIPUTA — Architecture, sécurité et feuille de route

## 1. Vision produit

Le couturier africain travaille aujourd'hui avec un carnet de mesures, WhatsApp et sa mémoire. Les retards avant un mariage ou un deuil sont la première cause de conflit avec les clients. Liputa apporte trois choses qu'aucun outil généraliste n'offre :

1. **Le savoir-faire du métier codé** : patron paramétrique depuis les mesures, métrage en mètres *et* en yards / complets de wax, gabarits africains (grand boubou, kaba, liputa, abacost, dashiki…).
2. **Un délai crédible** : calculé sur la charge réelle de l'atelier, pas sur une promesse.
3. **L'effet « waouh » qui fait vendre** : le client se voit porter le modèle avant la coupe (mannequin à ses mensurations, puis rendu IA photoréaliste).

Effet réseau : chaque atelier peut partager ses modèles ; la bibliothèque mondiale s'enrichit et devient l'actif principal de la plateforme.

## 2. Vue d'ensemble

```
 Client (navigateur / WhatsApp / SMS)          Atelier (Odoo backend, OWL)
        │ lien de suivi à jeton                         │
        ▼                                               ▼
 ┌──────────────── Odoo 18 (workers HTTP + cron) ──────────────────┐
 │ portal  │ liputa_couture : SaaS · Catalogue · Commandes ·        │
 │ account │ Planning · Délais · Patrons (lib/pattern) · IA ·       │
 │ mail    │ Notifications · Webhooks paiement                      │
 └──────┬──────────────┬───────────────┬──────────────┬────────────┘
        │              │               │              │
   PostgreSQL     Filestore S3     Fournisseur IA   Passerelles
   (multi-société) (photos, rendus) (LLM / image)   SMS · WhatsApp · Mobile Money
```

## 3. Multi-locataire

**Un atelier = une société Odoo (`res.company`)** dans une base partagée, isolée par des règles d'accès (`security/liputa_rules.xml`) sur chaque modèle métier.

Pourquoi pas une base par atelier ? À 5 000 FC/mois (environ 1,7 à 2 USD selon le taux), le coût d'une base PostgreSQL + workers par client tuerait la marge. Le multi-société mutualise tout.

Montée en charge :
- **Phase 1** (0 → ~2 000 ateliers) : 1 base, workers Odoo horizontaux derrière un load-balancer, PostgreSQL managé, filestore sur stockage objet (S3 compatible), CDN pour les images.
- **Phase 2** : **sharding par région** (une base par zone : Afrique centrale, de l'Ouest, de l'Est, diaspora) ; la bibliothèque publique est synchronisée entre shards par un job.
- Images compressées à la volée (`max_width` sur les champs image) pour les réseaux 3G.

La bibliothèque partagée : `company_id = False` = public. Lecture : public + mon atelier. Écriture : mon atelier seulement ; publication réservée aux administrateurs plateforme (copie modérée).

## 4. Modèle de données

| Modèle | Rôle |
|---|---|
| `liputa.plan`, `liputa.subscription`, `liputa.subscription.payment` | Offre, échéances, grâce, suspension, crédits IA, paiements idempotents |
| `liputa.garment.category` | Arborescence + *silhouette* (pilote le mannequin) |
| `liputa.event.type` | Événements avec **code vestimentaire culturel** (contexte de l'IA) |
| `liputa.garment.model` | Modèle : gabarit de patron, longueurs, manches, aisances, évasement, complexité, heures de base, cycle bibliothèque |
| `liputa.pricing.rule` | Grille tarifaire : la règle la plus spécifique gagne (modèle > événement > catégorie > genre) |
| `liputa.measurement.mixin` | 20 mesures, partagées entre profils et commandes (instantané figé à la commande) |
| `liputa.order` | La commande : client, photo + consentement, tissu, options, montants, délais, santé, facture, rendu IA |
| `liputa.order.task` / `liputa.tailor` | Planning par étape et par couturier, compétences, capacité journalière |
| `liputa.order.stage` | Étapes avec libellé client et notifications |

## 5. Moteurs métier

**Patronage (`lib/pattern`)** — Python pur, sans dépendance, testable hors Odoo. Blocs : corsage (pinces poitrine/taille, extension sous la taille), manche (tête de manche par profondeur d'emmanchure), jupe (évasement), pantalon (enfourchures devant/dos, genou), coupe en T (boubou/kaftan/dashiki, zone de broderie, parementure), pagne portefeuille. Les mesures manquantes sont complétées par des proportions anthropométriques ; la valeur saisie gagne toujours. Sortie : SVG en millimètres (impression 1:1 vérifiable par le carré de 10 cm) + métrage par placement en rangées sur la laize.
*Limite assumée :* c'est un patron de base algorithmique, à valider par une toile ; il ne remplace pas l'œil du modéliste sur les modèles très construits.

**Délai** — `livraison = début de file (heures restantes des commandes en cours ÷ capacité) + jours de production propres (une pièce n'est pas parallélisable à l'infini) + marge d'essayage`, en jours ouvrés de l'atelier. Confiance haute/moyenne/basse selon la longueur de la file. Un cron réévalue la santé des commandes toutes les 2 h et crée des activités pour le chef d'atelier.

**Mannequin (OWL, `mannequin_geometry.js`)** — silhouette vectorielle construite à partir des mesures (repères verticaux, largeurs ≈ tour ÷ 6,3), habillée selon la silhouette du modèle, remplie avec la photo du tissu, visage du client recadrable. Instantané, gratuit, hors-ligne.

**IA (`liputa.ai.service`)** — indépendante du fournisseur ; repli automatique sur un moteur de règles si aucune clé n'est configurée (le produit reste utilisable sans IA).

## 6. Sécurité

| Risque | Mesure |
|---|---|
| Fuite entre ateliers | Règles `company_id in company_ids` sur tous les modèles métier ; `check_access` avant tout RPC/contrôleur sensible |
| Lien de suivi public | Jeton `portal.mixin` vérifié par `_document_check_access` ; la page n'expose **ni mesures ni photo** |
| Données personnelles (mesures, photos) | Champs en pièce jointe, consentement explicite obligatoire pour le rendu IA, accès restreint aux groupes atelier |
| Injection de prompt | Notes client traitées comme données, longueur bornée, réponse JSON stricte, **seuls les identifiants du catalogue fourni sont acceptés** |
| Fraude au paiement | Webhook signé HMAC-SHA256 (comparaison à temps constant), traitement idempotent, secret par fournisseur hors code |
| Inscription abusive | CSRF, validation, mot de passe ≥ 10 caractères, 3 inscriptions/heure/IP (persisté en base, valable multi-workers) — ajouter un captcha (Turnstile) en production |
| SVG téléchargé | `Content-Security-Policy: default-src 'none'`, `nosniff`, libellés échappés |
| Secrets | Uniquement dans `ir.config_parameter` (groupe admin) — jamais dans le dépôt |
| Coûts IA | Crédits mensuels par plan, consommés avant chaque appel |

Production : HTTPS partout, `proxy_mode`, `list_db = False`, sauvegardes chiffrées quotidiennes, journalisation centralisée, conformité aux lois locales de protection des données (par ex. loi sénégalaise 2008-12, loi ivoirienne 2013-450, Nigeria Data Protection Act 2023) — à valider avec un juriste par pays.

## 7. International

- Code source en anglais (convention Odoo), chaînes traduisibles, champs `translate=True` pour la bibliothèque, les événements, les étapes et les plans.
- Langues prioritaires : français, anglais, portugais (Angola, Mozambique), swahili, arabe ; lingala, wolof, haoussa, yoruba à ajouter comme langues personnalisées. L'IA génère les descriptions de modèles dans toutes les langues actives.
- Devise par atelier (franc congolais par défaut, devise du pays à l'inscription) ; unités cm, m et yards.
- Moyens de paiement : Mobile Money via agrégateurs (RDC : FlexPay, MaxiCash ; Afrique de l'Ouest : CinetPay, PayDunya ; panafricain : Flutterwave, Paystack). Le webhook générique est prêt ; un adaptateur par agrégateur reste à écrire selon leur documentation officielle.

## 8. Feuille de route

| Phase | Contenu |
|---|---|
| **0 — Validation (2-3 sem.)** | Installation sur base réelle, tests unitaires (`tests/`), fichiers `.po` fr/pt/sw/ar, 10 ateliers pilotes à Kinshasa, ajustement des proportions du moteur de patrons avec des modélistes |
| **1 — MVP payant** | Adaptateur Mobile Money (FlexPay/CinetPay), WhatsApp Business API, export PDF A4 en mosaïque du patron, reçus imprimables 58/80 mm |
| **2 — Différenciation** | Gradation automatique des tailles (uniformes, commandes familiales « assorti »), export DXF pour traceurs, commande groupée (une famille, un tissu, 20 personnes), application mobile PWA hors-ligne |
| **3 — Écosystème** | Mesures depuis 2 photos (expérimental, à valider en précision), marketplace de tissus, vitrine publique de l'atelier, mannequin 3D (three.js), statistiques sectorielles anonymisées |

## 9. Modèle économique (hypothèses à tester)

Plan Standard 5 000 FC (5 utilisateurs, 100 crédits IA), Plan Pro 15 000 FC (20 utilisateurs, 500 crédits). Revenus complémentaires : crédits IA additionnels, commission sur paiements clients, mise en avant dans la bibliothèque. Le coût IA par atelier doit rester inférieur à ~20 % du prix de l'abonnement : d'où le repli « règles » gratuit et les crédits.
