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
| `liputa.payment.secret.<fournisseur>` | secret HMAC du webhook `/liputa/payment/webhook/<fournisseur>` |

5. Inscription publique d'un atelier : `https://votre-domaine/liputa/signup`.

## Tester le moteur de patrons sans Odoo

```bash
python3 tools/demo_patterns.py ./sortie   # 12 patrons SVG 1:1 + métrages
```

## État de validation

- ✅ Moteur de patrons exécuté sur les 12 gabarits, rendus SVG contrôlés visuellement.
- ✅ Chargement des classes et `setup_models` de l'**ORM réel d'Odoo 18** (303 modèles, base + mail + portal + account + liputa) : champs, related et dépendances valides.
- ✅ 26 vues contrôlées contre les champs/méthodes réels ; vues list/search/calendar validées par les schémas RelaxNG d'Odoo 18 ; templates OWL compilés avec l'OWL d'Odoo 18 ; données XML et CSV contrôlés.
- ⚠️ Non fait dans cet environnement (pas de PostgreSQL utilisable) : installation sur une base réelle et tests de bout en bout. **Première étape à faire chez vous** : `odoo-bin -d liputa_test -i liputa_couture --test-enable`.
