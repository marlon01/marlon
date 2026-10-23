# -*- coding: utf-8 -*-
{
    "name": "Liputa - SaaS for Tailoring Workshops",
    "version": "18.0.1.0.0",
    "category": "Manufacturing/Tailoring",
    "summary": "Multi-workshop tailoring SaaS: catalogue, AI styling, parametric patterns, "
               "virtual mannequin, orders, planning, invoicing, client tracking.",
    "description": """
Liputa turns every tailoring workshop (atelier de couture) into a digital business:

* One workshop = one tenant (res.company), monthly subscription (5 000 CDF by default)
* Shared multilingual model library + private models, moderation workflow
* AI assistant: model suggestions per event type, model enrichment, photoreal render
* Parametric pattern drafting (1:1 SVG) and fabric consumption estimate
* Virtual mannequin built from the client's measurements, dressed with the fabric
* Orders with measurements & photo, delivery estimation from real workshop load
* Planning per tailor, health monitoring, notifications (email / SMS / WhatsApp)
* Client invoicing and public order tracking portal
""",
    "author": "Liputa",
    "website": "https://liputa.app",
    "license": "LGPL-3",
    "depends": ["base", "web", "mail", "portal", "account", "contacts"],
    "external_dependencies": {"python": ["requests"]},
    "data": [
        "security/liputa_groups.xml",
        "security/ir.model.access.csv",
        "security/liputa_rules.xml",
        "data/mail_templates.xml",
        "data/base_data.xml",
        "data/catalog_data.xml",
        "views/catalog_views.xml",
        "views/atelier_views.xml",
        "views/order_views.xml",
        "views/saas_views.xml",
        "views/app_templates.xml",
        "views/portal_templates.xml",
        "views/menus.xml",
    ],
    "assets": {
        "web.assets_backend": [
            "liputa_couture/static/src/backend/**/*",
        ],
        "web.assets_frontend": [
            "liputa_couture/static/src/portal/**/*",
        ],
        # Standalone mobile app: no Odoo web client code, only OWL + Liputa.
        "liputa_couture.assets_app": [
            "web/static/src/module_loader.js",
            "web/static/lib/owl/owl.js",
            "web/static/lib/owl/odoo_module.js",
            "liputa_couture/static/src/backend/mannequin/mannequin_geometry.js",
            "liputa_couture/static/src/app/scss/*.scss",
            "liputa_couture/static/src/app/**/*.js",
        ],
    },
    "application": True,
    "installable": True,
}
