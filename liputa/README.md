# LIPUTA — le SaaS des ateliers de couture (Odoo 18 + OWL)

> *Liputa* : « pagne » en lingala. Une plateforme pensée d'abord pour l'Afrique, ouverte au monde.

Chaque couturier crée son **atelier virtuel** (abonnement mensuel, 5 000 FC par défaut) et gère :

| Domaine | Ce que fait Liputa |
|---|---|
| Catalogue | Bibliothèque mondiale partagée (multilingue) + modèles privés de l'atelier, partage/modération, copie d'un modèle de la bibliothèque |
| Événements | Mariage coutumier/dot, matanga, Tabaski, baptême, 8 mars, 30 juin… avec code vestimentaire culturel |
| Assistant IA | Suggestions de modèles selon l'événement, le genre, le budget et les envies du client ; enrichissement d'un modèle depuis sa photo (tags, événements, descriptions traduites) ; rendu photoréaliste du client portant le modèle |
| Commandes | Client, mesures (20 points), photo + consentement, tissu (photo, laize, métrage auto), options (broderie, doublure…), express |
| Patron | **Moteur de patronage paramétrique** : 12 gabarits (robe, kaba, haut, chemise, jupe, pagne portefeuille, pantalon, grand boubou, kaftan, tunique/dashiki, ensemble, costume/abacost) → SVG à l'échelle 1:1 avec valeurs de couture, droit-fil, pliure, pinces, crans + estimation du métrage (m / yards / complets de wax 6 yards) |
| Essayage virtuel | **Mannequin aux mensurations du client**, teint réglable (6 tons), habillé avec la photo réelle du tissu, visage du client (avec consentement), comparaison avec le rendu IA |
| Délai | Estimation à partir de la **charge réelle de l'atelier** (file d'attente, capacité des couturiers, jours ouvrés, marge d'essayage) avec indice de confiance et alerte si trop proche de l'événement |
| Planning | Tâches générées par étape (coupe, broderie, couture, essayage, finitions), affectation au couturier le moins chargé et compétent, calendrier/kanban par couturier, avancement automatique de la commande |
| Suivi | Santé des commandes (dans les temps / à risque / en retard), activités pour le chef d'atelier, tableau de bord OWL |
| Client | Facture Odoo, lien de suivi public sécurisé (jeton), e-mail / SMS / WhatsApp quand la commande change d'étape et quand elle est prête |
| SaaS | Inscription libre d'un atelier, essai 14 j, échéances, période de grâce, suspension, paiements Mobile Money par webhook signé, crédits IA par plan |

## Application mobile Liputa (aucune trace d'Odoo)

Les ateliers n'utilisent jamais l'interface Odoo : Odoo est le moteur invisible, l'interface est **l'application Liputa** servie sur `/app`.

- Application OWL autonome (son propre paquet de ressources, sans le client web Odoo), pensée **mobile d'abord** : barre d'onglets en bas, bouton central « + » pour prendre une commande, cibles tactiles ≥ 44 px, encoches iPhone respectées, mouvements réduits si le téléphone le demande.
- **Installable sur l'écran d'accueil** (PWA) avec fonctionnement dégradé sur réseau faible : coquille, police et images des modèles en cache.
- Identité propre : bleu nuit encre, **jaune mètre-ruban** (avancement, délais et charge affichés comme un ruban gradué), police Bricolage Grotesque embarquée (licence OFL).
- Écrans : connexion, accueil (charge de l'atelier, alertes, tâches du jour), commandes, détail de commande, essayage virtuel, patron, mesures, nouvelle commande en 4 étapes (client, mesures, modèle avec styliste IA, tissu et délai), catalogue, planning par couturier, compte et paiement Mobile Money. Captures dans `docs/captures_mobile/`.
- Masquage d'Odoo : `/web` et `/web/login` redirigent les ateliers vers `/app` (les administrateurs plateforme gardent l'accès via `/web/login?operator=1`), mentions « Powered by Odoo » retirées des e-mails et des pages, pages publiques (suivi client, inscription) aux couleurs de Liputa.
- Langues de l'app : français et anglais (dictionnaire dans `static/src/app/core/i18n.js`, une langue de plus = un dictionnaire de plus).

## Structure

```
liputa/
├── ARCHITECTURE.md            ← vision, choix techniques, sécurité, scalabilité, feuille de route
├── tools/demo_patterns.py     ← démo/test du moteur de patrons sans Odoo
└── liputa_couture/            ← module Odoo 18
    ├── lib/pattern/           ← moteur de patronage (Python pur, testable)
    ├── models/                ← ORM : SaaS, catalogue, atelier, commandes, services IA/délai/SMS
    ├── controllers/           ← portail client, inscription atelier, SVG patron, webhook paiement
    ├── security/              ← groupes, droits, règles d'isolation multi-ateliers
    ├── data/                  ← étapes, plans, événements, bibliothèque de départ, crons, e-mails
    ├── views/                 ← vues backend, portail, menus
    └── static/src/backend/    ← composants OWL : dashboard, ai_assistant, pattern_viewer, mannequin
```

## Installation

1. Odoo **18.0** (Community suffit), Python ≥ 3.10, `requests`.
2. Copier `liputa_couture` dans un dossier d'addons, redémarrer, *Applications › Liputa › Installer*.
3. Activer les langues voulues (*Paramètres › Langues*) : la bibliothèque, les événements et les étapes sont traduisibles.
4. *Liputa › Plateforme › Intégrations* — paramètres (jamais dans le code) :

| Clé | Valeur |
|---|---|
| `liputa.ai_provider` | `anthropic`, `openai_compatible` ou `none` (mode règles hors-ligne) |
| `liputa.ai_api_key`, `liputa.ai_model` | clé et modèle du fournisseur |
| `liputa.image_api_key`, `liputa.image_endpoint`, `liputa.image_model` | rendu photoréaliste (API d'édition d'image) |
| `liputa.sms_provider` | `africastalking`, `twilio_sms`, `twilio_whatsapp` ou `none` |
| `liputa.sms_username`, `liputa.sms_api_key`, `liputa.sms_sender` | identifiants passerelle |
| `liputa.payment.provider` | `auto` (par défaut) : agrégateur choisi selon le pays de l'atelier ; ou `flexpay` / `cinetpay` pour en forcer un. Sans agrégateur configuré : confirmation manuelle par la plateforme |
| `liputa.flexpay.merchant`, `liputa.flexpay.token` | code marchand et jeton (Bearer) fournis par FlexPay |
| `liputa.flexpay.environment` | `prod` (par défaut) ou `dev` (bac à sable `beta-backend.flexpay.cd`) |
| `liputa.cinetpay.site_id`, `liputa.cinetpay.api_key` | identifiants CinetPay (Mobile Money et cartes, Afrique francophone) |
| `liputa.payment.secret.<fournisseur>` | secret HMAC du webhook générique `/liputa/payment/webhook/<fournisseur>` (autres agrégateurs) |

5. Inscription publique d'un atelier : `https://liputa.naxoris.com/liputa/signup` (ou depuis « Créer un compte » › « J'ai un atelier »).
6. Adresse publique : fixer `web.base.url` à `https://liputa.naxoris.com` et `web.base.url.freeze` = `True` (liens de suivi, e-mails, notifications ; FlexPay rappelle `https://liputa.naxoris.com/liputa/payment/flexpay/callback`).

## Mise en ligne sur https://liputa.naxoris.com

Une seule adresse pour tout le monde :

| Adresse | Qui | Contenu |
|---|---|---|
| `/` → `/c` | tout le monde | annuaire des ateliers (classés par note), WhatsApp, installation de l'application |
| `/c/connexion` | tout le monde | connexion unique ; chacun arrive dans son espace |
| `/c/inscription` | clients | compte client gratuit ; « J'ai un atelier » mène à `/liputa/signup` |
| `/c/commandes` | clients | mes commandes, par atelier |
| `/app` | ateliers | mon atelier (application Liputa) |
| `/odoo` | administrateurs plateforme | administration |

Après connexion : administrateur plateforme → `/odoo`, utilisateur d'un atelier → `/app`, client → `/c/commandes`. Les anciennes adresses (`/app/login`, `/web/login`) mènent à `/c/connexion` ; `/web/login?operator=1` reste la porte de secours des opérateurs.

Configuration du serveur :

- **HTTPS obligatoire** (certificat Let's Encrypt sur le proxy) : installation de l'application et notifications push n'existent qu'en HTTPS.
- `odoo.conf` : `proxy_mode = True`, `list_db = False`, `dbfilter = ^liputa$` (une base), `workers` ≥ 2 et le cron actif (`max_cron_threads` ≥ 1 : il envoie les notifications push).
- Proxy (nginx) : `liputa.naxoris.com` vers Odoo (port 8069), `/websocket` vers le port 8072, en-têtes `X-Forwarded-Host`, `X-Forwarded-Proto`, `X-Forwarded-For`.
- Paramètres système : `web.base.url = https://liputa.naxoris.com`, `web.base.url.freeze = True`.
- Notifications push : rien à configurer, les clés VAPID sont créées à la première inscription d'un téléphone. Pour l'administration, autoriser les notifications du navigateur dans Odoo.


### Choix automatique de l'agrégateur selon le pays
| Pays de l'atelier | Agrégateur | Parcours dans l'application |
|---|---|---|
| RDC | **FlexPay** (si configuré, sinon CinetPay) | numéro Mobile Money puis code PIN sur le téléphone, sans quitter l'application |
| Autres pays (Côte d'Ivoire, Sénégal, Cameroun, Guinée…) | **CinetPay** | bouton « Payer (Mobile Money ou carte) » → page CinetPay → retour dans l'application, confirmation automatique |

Dans les deux cas, l'abonnement n'est prolongé qu'après vérification auprès de l'agrégateur (statut, montant, devise) ; une vérification toutes les 10 minutes rattrape les notifications perdues. CinetPay accepte XOF, XAF, CDF, GNF et USD ; notification à déclarer dans le back-office CinetPay : `https://votre-domaine/liputa/payment/cinetpay/notify`.

### Paiement des abonnements par FlexPay (Mobile Money, RDC)
1. Le chef d'atelier choisit M-Pesa, Orange Money ou Airtel Money et saisit son numéro (`+243…` ou `0…`) dans *Compte › Renouveler*.
2. Liputa envoie la demande à FlexPay ; le client valide avec son code PIN sur son téléphone.
3. FlexPay rappelle Liputa ; **le rappel ne valide rien à lui seul** : Liputa interroge FlexPay (`/check/<orderNumber>`) et vérifie statut, montant, devise et référence avant de prolonger l'abonnement. Une vérification automatique toutes les 10 minutes rattrape les rappels perdus (48 h).
4. L'application suit l'état du paiement en direct et confirme le renouvellement dès sa validation.

Devises acceptées par FlexPay : CDF et USD. L'intégration suit les adresses et champs de l'API FlexPay publiés par le SDK communautaire `ngandu-dev/flexpay-php` ; la documentation officielle n'est pas publique : **validez avec votre compte marchand en environnement `dev` avant la mise en production.**

## Tester le moteur de patrons sans Odoo

```bash
python3 tools/demo_patterns.py ./sortie   # 12 patrons SVG 1:1 + métrages
```

## État de validation

- ✅ **Installé sur une base Odoo 18 réelle** (PostgreSQL 16, Community, français chargé), sans erreur ni avertissement propre au module.
- ✅ **Tests automatisés** : `odoo-bin -d <base> -i liputa_couture --test-tags /liputa_couture --stop-after-init` — 22 tests (dont 10 pour les paiements : choix par pays, FlexPay — demande, numéros locaux, validation vérifiée, montant insuffisant, échec, attente, rappel falsifié — et CinetPay — redirection, vérification, retour et notification) : inscription d'un atelier (formulaire réel), cloisonnement (commandes, clients, contacts, extras, modèles), paiements (confirmation réservée à la plateforme, webhook signé HMAC accepté / refusé), quota mensuel de commandes, cycle essai → grâce → suspension, moteur de patrons et estimation du délai.
- ✅ **Parcours vérifié dans le navigateur** (mobile 390 px) : inscription → connexion → application `/app` (accueil, commandes, catalogue, planning, compte, nouvelle commande) sans erreur ; commande d'un nouveau client par l'API de l'application : numérotée par atelier, confirmée, tâches planifiées, délai estimé, lien de suivi et patron SVG générés ; `/web` renvoie l'atelier vers `/app`.
- ✅ Moteur de patrons exécuté sur les 12 gabarits (`tools/demo_patterns.py`).

### Corrections apportées lors de la première installation
| Problème | Correction |
|---|---|
| Installation impossible (vue calendrier : attribut `all_day` invalide) | Attribut retiré |
| Le chef d'atelier ne pouvait pas créer de client : toute commande pour un nouveau client échouait | Droit « création de contacts » accordé au groupe chef d'atelier |
| Les clients d'un atelier étaient visibles par tous les autres (créés sans société, recherche non filtrée, contacts des utilisateurs internes visibles par défaut dans Odoo) | Clients rattachés à leur atelier, API filtrée, règle d'accès sur les contacts (la plateforme garde la vue complète) |
| Un chef d'atelier pouvait confirmer lui-même son paiement en attente et prolonger son abonnement sans payer | Confirmation manuelle réservée aux administrateurs de la plateforme ; création directe de paiements retirée aux ateliers |
| « Adopter » un modèle copiait n'importe quel modèle, y compris le modèle privé d'un autre atelier | Seuls les modèles de la bibliothèque publique, lisibles, peuvent être adoptés |
| Une commande pouvait référencer le client, le modèle ou l'événement d'un autre atelier ; extras sans cloisonnement | Contrôle de société sur ces champs ; règle d'accès sur les extras |
| Quota mensuel de commandes du plan déclaré mais jamais appliqué | Appliqué à la création des commandes |
| Numérotation des commandes commune à tous les ateliers | Séquence propre à chaque atelier |

### Reste à faire
- Valider FlexPay et CinetPay avec des comptes marchands réels (environnements de test), les échanges étant testés par simulation.
- Limite d'utilisateurs du plan (`max_users`) : les ateliers ne créent pas de comptes eux-mêmes aujourd'hui ; à appliquer le jour où ils pourront inviter leurs couturiers.
