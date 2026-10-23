"""Concours de démonstration SELECTA pour le film et les captures d'écran.

Usage (base Odoo avec selecta_saas, les données de démonstration et le français) :
    odoo-bin shell -c odoo.conf -d <base> < tools/selecta_film_seed.py

Part du concours de démonstration livré avec SELECTA, renomme la structure, inscrit 40 candidats
fictifs et les fait composer par le vrai moteur d'épreuve (tirage, correction, scellement) :
30 copies terminées, 6 candidats encore en composition (dont 2 avec avertissement), 1 disqualifié
par la surveillance, 3 pas encore connectés. Le concours reste ouvert pour la capture de la
surveillance en direct ; `CLOSE = True` le clôture et publie le procès-verbal.
"""
import random

CLOSE = globals().get("CLOSE", False)
rng = random.Random(2026)

env = env(context={"lang": "fr_FR"})
admin = env.ref("base.user_admin")
env = env(user=admin)
company = env.company
c = env.ref("selecta_concours.demo_concours")

if not c.candidate_ids.filtered(lambda x: x.reference == "DEMO-040"):
    # Logo fictif : monogramme « GM » (aucune marque réelle).
    import base64, io
    from PIL import Image, ImageDraw, ImageFont
    img = Image.new("RGB", (256, 256), "#0E5E4A")
    draw = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("DejaVuSans-Bold.ttf", 120)
    except OSError:
        font = ImageFont.load_default()
    draw.text((128, 132), "GM", fill="#F4EFE6", font=font, anchor="mm")
    buf = io.BytesIO()
    img.save(buf, "PNG")
    company.sudo().write({"name": "Groupe Mayombe (démonstration)", "city": "Kinshasa",
                          "country_id": env.ref("base.cd").id, "logo": base64.b64encode(buf.getvalue())})
    admin.sudo().write({"name": "Clarisse Mbala"})
    c.sudo().with_context(selecta_engine=True).write({"places": 10})

    FIRST = ["Amani", "Grâce", "Josué", "Sarah", "Daniel", "Esther", "Patrick", "Ruth", "Joël", "Divine",
             "Merveille", "Christian", "Sandra", "Héritier", "Exaucé", "Gloire", "Prisca", "Benjamin",
             "Nadège", "Fiston", "Rachel", "Cédric", "Dorcas", "Jonathan", "Ornella", "Samuel", "Bénédicte",
             "Trésor", "Naomie", "Elie", "Chancelle", "David", "Arlette", "Moïse", "Falonne"]
    LAST = ["Kabeya", "Mukendi", "Ilunga", "Tshibangu", "Kasongo", "Mbuyi", "Lukusa", "Ngalula", "Mutombo",
            "Kapinga", "Mbala", "Kalala", "Nsimba", "Mayala", "Lumbala", "Bokele", "Ngoy", "Mwamba"]
    Cand = c.env["selecta.candidate"].sudo()
    existing = c.candidate_ids
    vals = []
    for i in range(len(existing) + 1, 41):
        vals.append({"concours_id": c.id, "name": f"{rng.choice(FIRST)} {rng.choice(LAST)} {rng.choice(LAST)}",
                     "reference": f"DEMO-{i:03d}", "room": rng.choice(["Salle A", "Salle B", "Salle C"])})
    Cand.create(vals)
    Cand.search([("concours_id", "=", c.id)])._demo_set_codes()
    # Code réaliste du candidat filmé dans l'espace candidat (capture « 33_candidat_code »).
    Cand.search([("reference", "=", "DEMO-003")]).write({"code_hash": Cand._hash_code("K7QP-M4XR-9TBA")})

    Attempt = env["selecta.attempt"].sudo().with_context(selecta_engine=True)
    cands = c.candidate_ids.sorted("reference")
    plan = (["done"] * 30) + (["live"] * 4) + (["warn"] * 2) + ["disq"] + (["absent"] * 3)
    skill = {cand.id: rng.uniform(0.35, 0.95) for cand in cands}
    for cand, what in zip(cands, plan):
        if what == "absent":
            continue
        att = Attempt.create(Attempt._prepare_for(cand))
        att._set_identity([round(rng.uniform(-0.2, 0.2), 5) for _ in range(128)], None)
        att._start()
        pages = att.total_pages if what == "done" else rng.randint(1, max(1, att.total_pages - 1))
        Question = env["selecta.question"].sudo().with_context(active_test=False)
        for page in range(pages):
            answers = {}
            for qid in att._page_question_ids(page):
                q = Question.browse(qid)
                correct = q.choice_ids.filtered("is_correct").ids
                wrong = q.choice_ids.filtered(lambda ch: not ch.is_correct).ids
                answers[qid] = correct if rng.random() < skill[cand.id] or not wrong else [rng.choice(wrong)]
            att._submit_page(page, answers)
        if what == "warn":
            att._apply_event("tab_hidden", "Sortie de la fenêtre d'examen")
        if what == "disq":
            att._apply_event("multiple_faces", "Deux visages détectés")
    env.cr.commit()
    print("Concours rempli :", c.name)

# Battement des postes encore en composition : la surveillance les voit « en ligne ».
if c.state == "open":
    for att in env["selecta.attempt"].sudo().search([("concours_id", "=", c.id), ("state", "=", "in_progress")]):
        att._heartbeat()
    env.cr.commit()

if CLOSE and c.state == "open":
    c.action_close()
    # Compositions simulées instantanément : durées réalistes (9 à 21 min), croissantes avec le rang
    # pour rester cohérentes avec le départage du classement.
    from datetime import timedelta
    for a in env["selecta.attempt"].sudo().with_context(selecta_engine=True).search(
            [("concours_id", "=", c.id), ("state", "in", ("submitted", "expired"))]):
        secs = 540 + (a.rank or 30) * 23 if a.state == "submitted" else 1200
        a.write({"duration_seconds": secs, "start_date": a.end_date - timedelta(seconds=secs)})
    c.action_publish()
    env.cr.commit()

c.invalidate_recordset()
states = {}
for a in env["selecta.attempt"].sudo().search([("concours_id", "=", c.id)]):
    states[a.state] = states.get(a.state, 0) + 1
print("État du concours :", c.state, "| tentatives :", states, "| empreinte :", c.results_hash or "—")
