"""Portail client Liputa pour le film : annuaire d'ateliers notés, cliente Chantal.

Usage (après tools/liputa_film_seed.py, même base) :
    odoo-bin shell -c odoo.conf -d <base> < tools/liputa_portal_seed.py

Crée cinq autres ateliers de Kinshasa, des comptes clients et leurs avis (Atelier Nadège
Couture arrive en tête), et le compte de Chantal (chantal@demo.cd / Liputa-demo-2026) qui
suit sa robe sirène. Personnes, ateliers et avis fictifs. Relancer ne recrée rien.
"""
import base64
import io

from PIL import Image, ImageDraw, ImageFont

PASSWORD = "Liputa-demo-2026"
FONT = "/home/user/marlon/film/liputa/assets/fonts/BricolageGrotesque.ttf"


def logo(initials, bg, fg="#FFFFFF"):
    img = Image.new("RGB", (256, 256), bg)
    draw = ImageDraw.Draw(img)
    font = ImageFont.truetype(FONT, 104)
    box = draw.textbbox((0, 0), initials, font=font)
    draw.text(((256 - box[2] - box[0]) / 2, (256 - box[3] - box[1]) / 2), initials, font=font, fill=fg)
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return base64.b64encode(buf.getvalue())


Users = env["res.users"].sudo()
Company = env["res.company"].sudo()
Review = env["liputa.review"]
main = env.ref("base.main_company")
portal = env.ref("base.group_portal")


def client(login, name, phone=""):
    user = Users.search([("login", "=", login)])
    if not user:
        user = Users.with_context(no_reset_password=True).create({
            "name": name, "login": login, "email": login, "password": PASSWORD, "lang": "fr_FR",
            "groups_id": [(6, 0, [portal.id])], "company_id": main.id, "company_ids": [(6, 0, [main.id])]})
        user.partner_id.write({"company_id": main.id, "mobile": phone})
    return user


nadege = Company.search([("name", "=", "Atelier Nadège Couture")], limit=1)
assert nadege, "lancer d'abord tools/liputa_film_seed.py"
nadege.write({
    "city": "Kinshasa · Lingwala", "atelier_whatsapp": "+243 810 000 101", "logo": logo("NC", "#16213E", "#F2C230"),
    "atelier_description": "Robes de mariée, tenues de dot et de deuil, uniformes. Mesures enregistrées, date tenue.",
})

OTHERS = [
    ("Couture Kin Élégance", "Maman Solange", "solange@demo.cd", "Kinshasa · Gombe", "Le chic de la capitale", "KE", "#C4502A",
     [4, 5, 4, 4, 3, 5, 4, 4, 5, 4, 4, 3]),
    ("Atelier Bazin Royal", "Papa Didier", "bazin@demo.cd", "Kinshasa · Bandalungwa", "Bazin riche et broderies", "BR", "#1F7A72",
     [5, 4, 4, 5, 4, 4, 4, 3, 4]),
    ("Mode Liputa Matonge", "Maman Thérèse", "therese@demo.cd", "Kinshasa · Matonge", "Le pagne qui vous ressemble", "ML", "#6A4C9C",
     [4, 4, 3, 4, 5, 4, 3]),
    ("Tailleur Le Prestige", "Papa Jean-Marie", "prestige@demo.cd", "Kinshasa · Limete", "Costumes et abacosts sur mesure", "TP", "#14213D",
     [4, 3, 4, 4, 3]),
    ("Couture Grâce Divine", "Maman Grâce", "gracedivine@demo.cd", "Kinshasa · Ngaliema", "Robes de cérémonie", "GD", "#E07A2F",
     [3, 4]),
]
for name, owner, login, city, slogan, initials, color, _ratings in OTHERS:
    if not Company.search([("name", "=", name)]):
        company = Company._liputa_create_workshop(
            {"atelier": name, "name": owner, "email": login, "phone": "+243 810 000 2%02d" % len(name),
             "password": PASSWORD}, env.ref("base.cd"), "127.0.0.1", lang="fr_FR")
        company.write({"city": city, "atelier_slogan": slogan, "logo": logo(initials, color),
                       "atelier_whatsapp": "+243 810 000 2%02d" % len(name)})

FIRST = ["Ruth", "Esther", "Patrick", "Merveille", "Divine", "Sarah", "Josué", "Christian", "Joël", "Arlette",
         "Benjamin", "Sandra", "Trésor", "Amani", "Rachel", "David", "Grâce", "Olive", "Fiston", "Nathalie",
         "Bienvenu", "Carine", "Prisca", "Dieudonné"]
LAST = ["Kanku", "Ilunga", "Tshibangu", "Ngalula", "Mbala", "Lukusa", "Kalala", "Bokele", "Mukendi", "Kabeya"]
clients = [client("client%02d@demo.cd" % i, "%s %s" % (FIRST[i], LAST[i % len(LAST)])) for i in range(len(FIRST))]

COMMENTS = {
    5: ["Robe livrée à la date promise, finitions impeccables.", "Je suis ma commande sur le téléphone, plus besoin d'appeler.",
        "Mesures prises une fois, parfaites à chaque commande.", "Accueil chaleureux et travail soigné."],
    4: ["Très beau travail, un petit retard sur l'ourlet.", "Bon atelier, je recommande."],
    3: ["Correct, mais j'ai dû rappeler deux fois."],
}
NADEGE = [5] * 19 + [4] * 4 + [5]
for company_name, ratings in [("Atelier Nadège Couture", NADEGE)] + [(o[0], o[7]) for o in OTHERS]:
    company = Company.search([("name", "=", company_name)], limit=1)
    for i, rating in enumerate(ratings):
        texts = COMMENTS.get(rating, [""])
        Review._liputa_rate(company, clients[i], rating, texts[i % len(texts)] if i % 3 != 2 else "")

# Chantal suit sa robe sirène (commande de l'atelier de Nadège pour « Chantal Kabeya »).
chantal = client("chantal@demo.cd", "Chantal Kabeya", "+243 810 000 300")
orders = env["liputa.order"].sudo().search([("company_id", "=", nadege.id), ("partner_id.name", "=", "Chantal Kabeya")])
orders.write({"client_partner_ids": [(4, chantal.partner_id.id)]})
Review._liputa_rate(nadege, chantal, 5, "Ma robe sirène est magnifique, et je savais quand venir la chercher !")
env["liputa.push.message"].sudo().search([]).unlink()  # pas d'envoi réel depuis la base de démonstration
env.cr.commit()
print("Annuaire :", [(c.name, round(c.liputa_rating_avg, 2), c.liputa_rating_count)
                     for c in Company._liputa_directory()])
