"""Atelier de démonstration Liputa pour le film et les captures d'écran.

Usage (base Odoo avec liputa_couture installé et le français chargé) :
    odoo-bin shell -c odoo.conf -d <base> < tools/liputa_film_seed.py

Crée « Atelier Nadège Couture » (Kinshasa), quatre tailleurs et une dizaine de commandes à
différentes étapes, confirmées par le vrai flux (estimation de livraison, tâches planifiées).
Toutes les personnes et commandes sont fictives. Relancer le script ne recrée rien si l'atelier
existe déjà.
"""
from datetime import timedelta

from odoo import fields

LOGIN = "nadege@demo.cd"
PASSWORD = "Liputa-demo-2026"

Users = env["res.users"].sudo()
if Users.search([("login", "=", LOGIN)]):
    print("Atelier déjà créé : rien à faire.")
else:
    company = env["res.company"].sudo()._liputa_create_workshop(
        {"atelier": "Atelier Nadège Couture", "name": "Nadège Mbuyi", "email": LOGIN,
         "phone": "+243 810 000 101", "password": PASSWORD},
        env.ref("base.cd"), "127.0.0.1", lang="fr_FR")
    user = Users.search([("login", "=", LOGIN)])
    uenv = env(user=user, context={"lang": "fr_FR", "allowed_company_ids": [company.id]})
    company.sudo().write({"atelier_slogan": "Le sur-mesure de Kinshasa"})

    Tailor = uenv["liputa.tailor"]
    Tailor.search([]).write({"can_embroider": True})
    for name, vals in [("Papy Kalala", {"can_sew": False, "can_finish": False}),
                       ("Sarah Lukusa", {}),
                       ("Junior Bokele", {"can_cut": False, "can_embroider": True})]:
        Tailor.create(dict({"name": name, "company_id": company.id}, **vals))

    def ref(xmlid):
        return env.ref("liputa_couture." + xmlid)

    def event(name_part):
        return uenv["liputa.event.type"].search([("name", "ilike", name_part)], limit=1)

    today = fields.Date.context_today(uenv["liputa.order"])
    # (cliente, téléphone, modèle, événement, jours avant l'événement, mesures, montant façon, étape visée)
    ORDERS = [
        ("Chantal Kabeya", "+243 812 345 601", "lib_mermaid_wax", "gala", 10,
         {"bust": 94, "waist": 74, "hip": 102, "height": 168}, 45000, "draft"),
        ("Grâce Mukendi", "+243 812 345 602", "lib_liputa_trio", "Mariage coutumier", 21,
         {"bust": 98, "waist": 80, "hip": 108, "height": 162}, 60000, "confirmed"),
        ("Esther Ilunga", "+243 812 345 603", "lib_kaba_ngondo", "Culte", 14,
         {"bust": 104, "waist": 90, "hip": 116, "height": 158}, 35000, "cutting"),
        ("Patrick Tshibangu", "+243 812 345 604", "lib_abacost", "Bureau", 12,
         {"bust": 100, "waist": 86, "hip": 100, "height": 176}, 70000, "sewing"),
        ("Ruth Kasongo", "+243 812 345 605", "lib_pencil_set", "Bureau", 9,
         {"bust": 90, "waist": 70, "hip": 98, "height": 165}, 40000, "sewing"),
        ("Joël Mbala", "+243 812 345 606", "lib_senator", "Mariage civil", 8,
         {"bust": 102, "waist": 88, "hip": 102, "height": 180}, 55000, "fitting"),
        ("Divine Lumbala", "+243 812 345 607", "lib_girl_dress", "Baptême", 6,
         {"bust": 64, "waist": 58, "hip": 68, "height": 122}, 20000, "finishing"),
        ("Merveille Ngalula", "+243 812 345 608", "lib_kaftan_women", "Noël", 30,
         {"bust": 96, "waist": 82, "hip": 106, "height": 166}, 38000, "confirmed"),
        ("Christian Mutombo", "+243 812 345 609", "lib_wax_shirt", "Fête nationale", 5,
         {"bust": 98, "waist": 84, "hip": 98, "height": 174}, 18000, "ready"),
        ("Sandra Kapinga", "+243 812 345 610", "lib_grand_boubou", "Mariage civil", 18,
         {"bust": 100, "waist": 84, "hip": 110, "height": 170}, 90000, "cutting"),
    ]
    ORDER_OF_STEPS = ["cutting", "embroidery", "sewing", "fitting", "finishing"]
    TARGET_DONE = {"confirmed": 0, "cutting": 0, "sewing": 1, "fitting": 2, "finishing": 3, "ready": 99}

    Order = uenv["liputa.order"]
    Partner = uenv["res.partner"]
    for client, phone, model, ev, days, meas, making, target in ORDERS:
        partner = Partner.create({"name": client, "phone": phone, "company_id": company.id})
        vals = dict(meas, partner_id=partner.id, garment_model_id=ref(model).id,
                    gender="men" if model in ("lib_abacost", "lib_senator", "lib_wax_shirt") else "women",
                    event_type_id=event(ev).id, event_date=today + timedelta(days=days),
                    amount_making=making)
        order = Order.create(vals)
        if target == "draft":
            order.action_estimate_delivery()
            continue
        order.action_confirm()
        tasks = order.task_ids.sorted("sequence")
        done = TARGET_DONE[target]
        if target == "cutting":
            tasks[:1].action_start()
        for task in tasks[:done]:
            task.action_done()
        if done and done < len(tasks):
            tasks[done:done + 1].action_start()
        order._liputa_sync_stage_from_tasks()
        order.deposit_amount = order.amount_total / 2

    env.cr.commit()
    print("Atelier créé :", company.name, "| connexion :", LOGIN, "/", PASSWORD)
    for o in Order.search([]):
        print(" ", o.name, o.partner_id.name, "|", o.stage_id.name, "| livraison", o.delivery_date_promised,
              "| suivi", o.sudo()._liputa_tracking_url())
