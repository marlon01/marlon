# -*- coding: utf-8 -*-
{
    'name': "NORMA — Facturation normalisée DGI (RDC)",
    'version': '18.0.1.0.0',
    'summary': "Plateforme SaaS de facture normalisée pour la République démocratique du Congo : "
               "e-MCF de la DGI, établissements, interfaces par métier (supermarché, hôtel, restaurant, services).",
    'description': """
NORMA (by Naxoris)
==================
* Inscription des entreprises en libre-service, avec leur catégorie d'activité ; une interface par métier.
* Établissements (sites) avec leur code et leur dispositif électronique fiscal (e-MCF, API DGI v1.3).
* Calcul fiscal serveur conforme aux Spécifications SFE (groupes de taxation A à S, TVA arrondie au supérieur).
* Normalisation : demande, comparaison des totaux avec la DGI, confirmation, code DEF/DGI, compteurs, QR code.
* Factures d'avoir (COR, RAN, RAM, RRR) plafonnées à la facture d'origine ; aucune facture normalisée ne se modifie.
* Reprise automatique, confirmation incertaine, journal des échanges e-MCF, journal d'audit chaîné.
* Vérification publique de chaque facture, rapports fiscaux, export CSV.
""",
    'author': 'Naxoris',
    'website': 'https://naxoris.com',
    'category': 'Accounting/Localizations',
    'license': 'LGPL-3',
    'depends': ['base', 'web'],
    'external_dependencies': {'python': ['qrcode', 'requests']},
    'data': [
        'security/norma_security.xml',
        'security/ir.model.access.csv',
        'data/norma_data.xml',
        'views/layout.xml',
        'views/landing.xml',
        'views/print.xml',
    ],
    'assets': {
        'norma_facture.assets_public': [
            'web/static/src/polyfills/object.js',
            'web/static/src/polyfills/array.js',
            'web/static/src/module_loader.js',
            'web/static/lib/owl/owl.js',
            'web/static/lib/owl/odoo_module.js',
            'norma_facture/static/src/css/norma_base.css',
            'norma_facture/static/src/css/norma_public.css',
            'norma_facture/static/src/common/**/*.js',
            'norma_facture/static/src/public/**/*.js',
        ],
        'norma_facture.assets_app': [
            'web/static/src/polyfills/object.js',
            'web/static/src/polyfills/array.js',
            'web/static/src/module_loader.js',
            'web/static/lib/owl/owl.js',
            'web/static/lib/owl/odoo_module.js',
            'norma_facture/static/src/css/norma_base.css',
            'norma_facture/static/src/css/norma_app.css',
            'norma_facture/static/src/common/**/*.js',
            'norma_facture/static/src/app/**/*.js',
        ],
        'norma_facture.assets_platform': [
            'web/static/src/polyfills/object.js',
            'web/static/src/polyfills/array.js',
            'web/static/src/module_loader.js',
            'web/static/lib/owl/owl.js',
            'web/static/lib/owl/odoo_module.js',
            'norma_facture/static/src/css/norma_base.css',
            'norma_facture/static/src/css/norma_app.css',
            'norma_facture/static/src/common/**/*.js',
            'norma_facture/static/src/platform/**/*.js',
        ],
    },
    'installable': True,
    'application': True,
}
