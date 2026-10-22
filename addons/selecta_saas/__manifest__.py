# -*- coding: utf-8 -*-
{
    'name': "SELECTA SaaS — abonnements et administration centrale",
    'version': '18.0.1.1.0',
    'summary': "Transforme SELECTA en plateforme SaaS : inscription en libre-service, essai gratuit de 14 jours, "
               "abonnements par catégorie, quotas, paiements et administration centrale.",
    'description': """
SELECTA SaaS (by Naxoris)
=========================
* Page de présentation et grille tarifaire publiques, inscription en libre-service.
* Chaque structure dispose de son espace cloisonné (société Odoo dédiée) et de son administrateur.
* Essai gratuit (14 jours par défaut), puis abonnement mensuel ou annuel selon la catégorie.
* Quotas par catégorie : concours actifs, candidats par mois, comptes du personnel, fonctions IA.
* Échéance dépassée : console en consultation seule (les résultats restent accessibles).
* Paiement Mobile Money, virement ou lien en ligne : déclaration avec justificatif, validation centrale.
* Administration centrale : structures, essais, abonnements, encaissements, tarifs, intégrité des journaux.
""",
    'author': 'Naxoris',
    'website': 'https://naxoris.com',
    'category': 'Human Resources/Recruitment',
    'license': 'LGPL-3',
    'depends': ['selecta_concours'],
    'data': [
        'security/saas_security.xml',
        'security/ir.model.access.csv',
        'data/saas_data.xml',
        'views/saas_templates.xml',
        'views/mail_templates.xml',
        'views/legal_templates.xml',
    ],
    'assets': {
        # Espace « Abonnement » et bandeau d'échéance, ajoutés à la console de chaque structure.
        'selecta_concours.assets_admin': [
            'selecta_saas/static/src/css/saas_tenant.css',
            'selecta_saas/static/src/tenant/**/*.js',
        ],
        # Formulaire d'inscription (application OWL autonome).
        'selecta_saas.assets_signup': [
            'web/static/src/polyfills/object.js',
            'web/static/src/polyfills/array.js',
            'web/static/src/module_loader.js',
            'web/static/lib/owl/owl.js',
            'web/static/lib/owl/odoo_module.js',
            'selecta_concours/static/src/css/selecta_base.css',
            'selecta_saas/static/src/css/saas_signup.css',
            'selecta_concours/static/src/common/**/*.js',
            'selecta_saas/static/src/signup/**/*.js',
        ],
        # Console de l'administration centrale (application OWL autonome).
        'selecta_saas.assets_platform': [
            'web/static/src/polyfills/object.js',
            'web/static/src/polyfills/array.js',
            'web/static/src/module_loader.js',
            'web/static/lib/owl/owl.js',
            'web/static/lib/owl/odoo_module.js',
            'selecta_concours/static/src/css/selecta_base.css',
            'selecta_concours/static/src/css/selecta_admin.css',
            'selecta_saas/static/src/css/saas_platform.css',
            'selecta_concours/static/src/common/**/*.js',
            'selecta_saas/static/src/platform/**/*.js',
        ],
    },
    'post_init_hook': '_selecta_saas_post_init',
    'installable': True,
    'application': False,
}
