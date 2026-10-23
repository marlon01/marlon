# Conventions de rédaction des manuels (sources Markdown → .docx et .pdf)

Les sources sont converties par pandoc (Markdown pandoc) en Word, puis en PDF par LibreOffice. Respecter strictement :

1. Fichier en UTF-8, en français soigné (accents, guillemets « », espaces normales). Public : lecteur non développeur pour le manuel de fonctionnement, ingénieur/intégrateur/auditeur pour le manuel technique.
2. Commencer par un bloc YAML :
   ```
   ---
   title: "NORMA — Manuel de fonctionnement"
   subtitle: "Facturation normalisée DGI (RDC) — module norma_facture"
   version: "18.0.1.1.0"
   date: "23 octobre 2026"
   editeur: "Naxoris"
   ---
   ```
   (adapter titre, sous-titre, version du manifeste). Ne pas écrire de titre « # » répétant le titre : la page de garde et la table des matières sont générées automatiquement.
3. Titres : `#` pour les chapitres (numérotés automatiquement : ne pas écrire de numéros dans les titres), `##`, `###` au plus.
4. Tableaux : tableaux pipe (`| a | b |`) avec ligne d'en-tête, cellules courtes (pas de retour à la ligne dans une cellule).
5. Images : uniquement des captures existantes, chemin depuis la racine du dépôt, avec légende :
   `![Caisse rapide en vente](docs/captures/norma/05_pos.png){width=15cm}` — l'image seule dans son paragraphe. Ne jamais référencer un fichier qui n'existe pas.
6. Code, commandes, chemins : blocs ``` ou `code`. Pas de HTML brut, pas de notes de bas de page, pas d'emoji.
7. Encadrés : utiliser une citation commençant par un mot en gras, ex. `> **Important.** …` ou `> **À savoir.** …`.
8. Saut de page voulu : une ligne contenant seulement `\newpage` est interdite ; laisser la mise en page automatique.
9. Exactitude : tout ce qui est décrit doit être vérifié dans le code (routes, rôles, champs, règles, délais, montants). Ne rien inventer. Une information inconnue (n° RCCM de l'éditeur, nom d'un signataire…) s'écrit `[à compléter]`.
