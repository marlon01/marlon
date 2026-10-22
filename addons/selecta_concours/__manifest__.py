# -*- coding: utf-8 -*-
{
    'name': 'SELECTA — La culture de l\'excellence',
    'version': '18.0.1.1.0',
    'summary': "Plateforme autonome de concours : QCM chronométrés, surveillance IA par webcam, "
               "résultats instantanés, anti-fraude, analyse psychométrique, fonctionnement hors-ligne.",
    'description': """
SELECTA — La culture de l'excellence (by Naxoris)
=================================================
* Applications OWL autonomes (aucune vue native Odoo) : espace candidat, back-office, page de connexion.
* Code d'accès secret par candidat (haché HMAC, jamais stocké en clair).
* QCM paramétrables, tirage et mélange par candidat, navigation strictement avant.
* Chronomètre serveur inviolable, clôture automatique à expiration.
* Surveillance IA par webcam 100 % locale (détection visage, multi-visages, regard, identité).
* Résultat (pourcentage + admis/non admis) affiché immédiatement, liste des admis générée en temps réel.
* Journal d'audit chaîné (SHA-256) et procès-verbal scellé vérifiable par QR code.
* Analyse IA : psychométrie (KR-20, difficulté, discrimination), détection de collusion et d'anomalies.
* Mode résilience : fonctionnement sans Internet, tolérance aux micro-coupures réseau (PWA).
""",
    'author': 'Naxoris',
    'website': 'https://naxoris.com',
    'maintainer': 'Naxoris — contact@naxoris.com — +243 828 317 540 / +243 831 509 420',
    'category': 'Human Resources/Recruitment',
    'license': 'LGPL-3',
    'depends': ['base', 'web'],
    'data': [
        'security/selecta_security.xml',
        'security/ir.model.access.csv',
        'data/selecta_data.xml',
        'views/selecta_templates.xml',
        'views/selecta_menus.xml',
    ],
    'demo': [
        'demo/selecta_demo.xml',
    ],
    'assets': {
        # --- Application candidat (autonome, PWA) -------------------------
        'selecta_concours.assets_exam': [
            'web/static/src/polyfills/object.js',
            'web/static/src/polyfills/array.js',
            'web/static/src/module_loader.js',
            'web/static/lib/owl/owl.js',
            'web/static/lib/owl/odoo_module.js',
            'selecta_concours/static/src/css/selecta_base.css',
            'selecta_concours/static/src/css/selecta_exam.css',
            'selecta_concours/static/src/common/**/*.js',
            'selecta_concours/static/src/exam/**/*.js',
        ],
        # --- Back-office (autonome) ----------------------------------------
        'selecta_concours.assets_admin': [
            'web/static/src/polyfills/object.js',
            'web/static/src/polyfills/array.js',
            'web/static/src/module_loader.js',
            'web/static/lib/owl/owl.js',
            'web/static/lib/owl/odoo_module.js',
            'selecta_concours/static/src/css/selecta_base.css',
            'selecta_concours/static/src/css/selecta_admin.css',
            'selecta_concours/static/src/common/**/*.js',
            'selecta_concours/static/src/admin/**/*.js',
        ],
        # --- Page de connexion du personnel --------------------------------
        'selecta_concours.assets_login': [
            'web/static/src/polyfills/object.js',
            'web/static/src/polyfills/array.js',
            'web/static/src/module_loader.js',
            'web/static/lib/owl/owl.js',
            'web/static/lib/owl/odoo_module.js',
            'selecta_concours/static/src/css/selecta_base.css',
            'selecta_concours/static/src/css/selecta_login.css',
            'selecta_concours/static/src/common/**/*.js',
            'selecta_concours/static/src/login/**/*.js',
        ],
    },
    'application': True,
    'installable': True,
    'post_init_hook': '_selecta_post_init',
}
