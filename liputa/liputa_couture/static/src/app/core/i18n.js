/** @odoo-module **/
/**
 * Lightweight i18n for the Liputa app. English source strings; dictionaries per
 * language. Add a language by adding a dictionary (sw, pt, ln, ar...).
 */
const DICT = {
    fr: {
        "Home": "Accueil", "Orders": "Commandes", "New": "Nouvelle", "Planning": "Planning", "Catalogue": "Catalogue",
        "Hello %s": "Bonjour %s", "Workshop load": "Charge de l'atelier",
        "days of work waiting": "jours de travail en attente", "days": "j",
        "%s h of capacity per day": "%s h de capacité par jour", "in progress": "en cours",
        "to watch": "à surveiller", "ready": "prêtes", "To watch": "À surveiller", "See all": "Tout voir",
        "My tasks today": "Mes tâches du jour", "Due this week": "À livrer cette semaine",
        "Nothing to watch: every order is on time.": "Rien à surveiller : toutes les commandes sont dans les temps.",
        "No task planned for you today.": "Aucune tâche prévue pour vous aujourd'hui.",
        "Free trial": "Essai gratuit", "%s days left": "%s jours restants", "Renew": "Renouveler",
        "Subscription due": "Abonnement échu", "Subscription suspended": "Abonnement suspendu",
        "Search a client, a model, a reference": "Client, modèle ou référence",
        "In progress": "En cours", "To watch ": "À surveiller", "Ready": "Prêtes", "All": "Toutes",
        "No order here": "Aucune commande ici", "Orders you take appear in this list.": "Les commandes que vous prenez apparaissent dans cette liste.",
        "Take an order": "Prendre une commande",
        "Renew the subscription": "Renouveler l'abonnement", "Mobile Money number": "Numéro Mobile Money",
        "Pay %s": "Payer %s", "Confirm the payment on your phone": "Validez le paiement sur votre téléphone",
        "Enter your PIN in the %s prompt to pay %s. Your subscription is renewed as soon as the payment is confirmed.":
            "Saisissez votre code PIN dans la demande %s pour payer %s. L'abonnement est renouvelé dès la confirmation du paiement.",
        "Close": "Fermer", "Enter a valid phone number": "Saisissez un numéro de téléphone valide",
        "Payment confirmed: your subscription is renewed.": "Paiement confirmé : votre abonnement est renouvelé.",
        "The payment was not completed. You can try again.": "Le paiement n'a pas abouti. Vous pouvez réessayer.",
        "Waiting for the operator confirmation…": "En attente de la confirmation de l'opérateur…",
        "Opening the payment page…": "Ouverture de la page de paiement…",
        "Pay %s (Mobile Money or card)": "Payer %s (Mobile Money ou carte)",
        "The payment page is not available. Please try again later.": "La page de paiement est indisponible. Réessayez plus tard.",
        "today": "aujourd'hui", "tomorrow": "demain", "in %s d": "dans %s j", "%s d late": "%s j de retard",
        "yesterday": "hier",
        "On time": "Dans les temps", "At risk": "À risque", "Late": "En retard",
        "Delivery planned": "Livraison prévue", "Event on %s": "Événement le %s",
        "Fitting": "Essayage", "Pattern": "Patron", "Measurements": "Mesures",
        "Virtual fitting": "Essayage virtuel", "Cutting pattern": "Patron de coupe",
        "Production": "Production", "Payment": "Paiement", "Making": "Façon", "Fabric": "Tissu", "Extras": "Options",
        "Express": "Express", "Total": "Total", "Deposit": "Acompte", "Left to pay": "Reste à payer",
        "Call": "Appeler", "WhatsApp": "WhatsApp", "Share tracking": "Partager le suivi",
        "Confirm the order": "Confirmer la commande", "Mark as ready": "Marquer prête", "Hand over to client": "Remettre au client",
        "Delivered": "Livrée", "Create the invoice": "Créer la facture",
        "Order confirmed": "Commande confirmée", "Order ready: the client is notified": "Commande prête : le client est prévenu",
        "Order delivered": "Commande remise", "Task done": "Tâche terminée", "Invoice created": "Facture créée",
        "Tracking link copied": "Lien de suivi copié",
        "%s m of fabric": "%s m de tissu", "Pieces to cut": "Pièces à couper",
        "Download (1:1)": "Télécharger (1:1)", "Print": "Imprimer",
        "Base pattern drawn from the measurements. Check it on a toile before cutting the fabric.":
            "Patron de base tracé d'après les mesures. Vérifiez-le sur une toile avant de couper le tissu.",
        "Skin tone": "Teint", "Show measurements": "Afficher les mesures",
        "Photoreal render (AI)": "Rendu photoréaliste (IA)",
        "Add a client photo with consent to get a photoreal render.": "Ajoutez une photo du client avec son accord pour obtenir un rendu photoréaliste.",
        "Upper body": "Haut du corps", "Arms": "Bras", "Lower body": "Bas du corps", "Lengths": "Longueurs",
        "Height": "Taille", "Neck": "Tour de cou", "Shoulders": "Carrure", "Bust / chest": "Tour de poitrine",
        "Under bust": "Sous-poitrine", "Waist": "Tour de taille", "Hip": "Tour de hanches",
        "Back waist length": "Longueur dos", "Front waist length": "Longueur devant", "Arm length": "Longueur bras",
        "Biceps": "Tour de bras", "Wrist": "Tour de poignet", "Hip depth": "Hauteur hanches", "Thigh": "Tour de cuisse",
        "Knee": "Tour de genou", "Trouser hem": "Bas de pantalon", "Inseam": "Entrejambe", "Trouser length": "Longueur pantalon",
        "Skirt length": "Longueur jupe", "Dress length": "Longueur robe",
        "New order": "Nouvelle commande", "Step %s of %s": "Étape %s sur %s",
        "Client": "Client", "Model": "Modèle", "Fabric & delivery": "Tissu et délai",
        "Who is it for?": "Pour qui ?", "Search an existing client": "Chercher un client existant",
        "Or a new client": "Ou un nouveau client", "Full name": "Nom complet", "Phone / WhatsApp": "Téléphone / WhatsApp",
        "Client photo": "Photo du client", "Helps the fitting and the AI render": "Aide l'essayage et le rendu IA",
        "Take or choose a photo": "Prendre ou choisir une photo",
        "The client agrees to the use of this photo": "Le client accepte l'utilisation de cette photo",
        "Woman": "Femme", "Man": "Homme", "Child": "Enfant",
        "Measurements from %s loaded": "Mesures du %s chargées",
        "Save these measurements in the client's file": "Enregistrer ces mesures dans la fiche du client",
        "Event": "Événement", "Wishes (optional)": "Envies (facultatif)",
        "e.g. matching the family, wax, fitted cut": "ex. assorti avec la famille, wax, coupe près du corps",
        "Suggest models": "Suggérer des modèles", "Suggestions": "Suggestions", "Choose this model": "Choisir ce modèle",
        "Fabric brought by": "Tissu apporté par", "The client": "Le client", "The workshop": "L'atelier",
        "Fabric photo": "Photo du tissu", "Dresses the virtual mannequin": "Habille le mannequin virtuel",
        "Fabric description": "Description du tissu", "e.g. Dutch wax, 6 yards": "ex. wax hollandais, 6 yards",
        "Express order": "Commande express", "Surcharge applied, served first": "Supplément appliqué, servie en priorité",
        "Estimated delivery": "Livraison estimée", "Confidence: %s": "Fiabilité : %s",
        "high": "haute", "medium": "moyenne", "low": "faible",
        "Back": "Retour", "Continue": "Continuer", "Create and confirm": "Créer et confirmer",
        "Choose a client to continue": "Choisissez un client pour continuer",
        "Enter at least the bust or the height": "Saisissez au moins le tour de poitrine ou la taille",
        "Choose a model to continue": "Choisissez un modèle pour continuer",
        "Order created": "Commande créée",
        "Library": "Bibliothèque", "My workshop": "Mon atelier", "Women": "Femmes", "Men": "Hommes", "Children": "Enfants",
        "Search a model": "Chercher un modèle", "Made %s times": "Réalisé %s fois", "Use for an order": "Utiliser pour une commande",
        "No model found": "Aucun modèle trouvé", "Change the filters or add your own model.": "Modifiez les filtres ou ajoutez votre propre modèle.",
        "Work of the day": "Travail du jour", "Nothing planned this day.": "Rien de prévu ce jour-là.",
        "%s h planned of %s h": "%s h prévues sur %s h",
        "My account": "Mon compte", "Subscription": "Abonnement", "Plan": "Formule", "Status": "Statut",
        "Price": "Prix", "per month": "par mois", "Pay with Mobile Money": "Payer par Mobile Money",
        "AI credits left this month": "Crédits IA restants ce mois-ci", "Language": "Langue", "Log out": "Se déconnecter", "Notifications": "Notifications", "Alerts on this phone": "Alertes sur ce téléphone",
        "Notifications are blocked in the browser settings.": "Les notifications sont bloquées dans les réglages du navigateur.",
        "Install Liputa on the home screen to receive alerts.": "Installez Liputa sur l'écran d'accueil pour recevoir les alertes.",
        "Late orders, new reviews and payments, even with the app closed.": "Commandes en retard, nouveaux avis et paiements, même application fermée.",
        "trial": "essai", "active": "actif", "grace": "échu", "suspended": "suspendu",
        "Something went wrong. Check your connection and try again.": "Une erreur est survenue. Vérifiez votre connexion et réessayez.",
        "You are offline. Changes will be possible when the connection is back.": "Vous êtes hors ligne. Les modifications seront possibles au retour de la connexion.",
        "Cut": "Coupe", "Embroidery": "Broderie", "Sewing": "Couture", "Finishing": "Finitions",
        "orders": "commandes", "h": "h", "cm": "cm",
        "Order": "Commande", "Stages": "Étapes", "Not invoiced yet": "Pas encore facturée",
        "Open the fitting": "Ouvrir l'essayage", "Ask the AI stylist": "Demander au styliste IA",
        "Based on the event and the wishes": "Selon l'événement et les envies",
        "AI suggestion": "Suggestion IA",
    },
};

let current = "fr";

export function setLang(lang) {
    current = DICT[lang] ? lang : "en";
}

export function getLang() {
    return current;
}

export function t(source, ...args) {
    let out = (DICT[current] && DICT[current][source]) || source;
    for (const a of args) {
        out = out.replace("%s", a);
    }
    return out;
}
