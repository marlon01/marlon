# marlon

## Outils Claude Code installés (`.claude/settings.json`)

Plugins du marketplace officiel `anthropics/claude-plugins-official`, activés pour tout le projet :

| Domaine | Plugin | Usage |
|---|---|---|
| UI/UX | `frontend-design` | Interfaces soignées, non génériques |
| UI/UX | `ui-theme-designer` | Thèmes, palettes, tokens de design |
| UI/UX | `modern-web-guidance` | Bonnes pratiques web modernes (perf, a11y, CSS) |
| Workflow | `feature-dev` | `/feature-dev` : agents explorer → architecte → reviewer |
| Workflow | `superpowers` | Brainstorm, plans, TDD, debugging systématique |
| Qualité | `code-review`, `pr-review-toolkit` | Revue de PR multi-agents |
| Qualité | `code-simplifier` | Simplification du code modifié |
| Sécurité | `security-guidance` | Alertes XSS, injection, secrets… |
| Git | `commit-commands` | `/commit`, `/commit-push-pr` |
| Tests | `playwright` | Pilotage navigateur, tests E2E, captures |
| Docs | `context7` | Documentation à jour des librairies |
| Langages | `typescript-lsp`, `pyright-lsp` | Diagnostics TS/JS et Python |
| Maintenance | `claude-md-management` | Tenir ce fichier à jour |

## Production vidéo (projet `film/`)

Skills installés dans `.claude/skills/` par `npx skills add` (versions figées dans `skills-lock.json`, mise à jour : `npx skills update -p`) :

| Source | Skills | Usage |
|---|---|---|
| `heygen-com/hyperframes` | `hyperframes`, `hyperframes-cli`, `hyperframes-registry`, `media-use`, `figma`, `slideshow`, `remotion-to-hyperframes` | Films en HTML rendus en MP4 (moteur du projet `film/`), musique, bruitages, voix, étalonnage |
| `remotion-dev/skills` | `remotion-*` (dont `remotion-saas`, `remotion-captions`, `remotion-render`) | Vidéo programmatique en React, alternative à HyperFrames |

- Un projet HyperFrames par film : `film/liputa/`, `film/selecta/` (chacun : `SCRIPT.md`, `SPEC.md`, `REVIEW.md`, `voix.txt`). Lire `/hyperframes` avant toute vidéo. Rendu : `cd film/<film> && npm run check && npm run render` (FFmpeg et Chrome headless présents).
- GSAP est servi en local (`assets/vendor/gsap.min.js` de chaque film) : le Chrome de rendu n'atteint pas les CDN derrière le proxy, et un rendu ne doit rien charger du réseau.
- Voix off : `tools/voix_off.py` (sherpa-onnx + voix Piper françaises tirées des publications GitHub de `k2-fsa/sherpa-onnx`, Hugging Face étant bloqué). Environnement : `python3 -m venv .venv-voix && .venv-voix/bin/pip install sherpa-onnx soundfile numpy`. Usage : `.venv-voix/bin/python tools/voix_off.py film/<film>/voix.txt -o film/<film>/assets/audio/voix.wav --voix siwis --vitesse 0.88 --prises 4 --verifier --phrases film/<film>/assets/audio/phrases`. Écrire les noms comme ils se prononcent (« Lipouta », « Sélecta », « code Q R »).
- Personnages : dessin vectoriel animé par `assets/rig.js` de chaque film (`LiputaRig`, `SelectaRig` : humeurs, clignements, paroles, respiration). Pivots en `svgOrigin` (GSAP ignore le `transform-origin` CSS des groupes SVG). États de départ en CSS ou `gsap.set` : un `tl.set(…, 0)` seul ne s'affiche pas à la première image d'une scène.
- Musique : aucune source accessible (Hugging Face, Openverse bloqués) ; à fournir ou à autoriser dans le réseau de l'environnement.
- Liputa, atelier de démonstration et captures : `tools/liputa_film_seed.py` puis `tools/liputa_film_capture.mjs`.
- Télémétrie HyperFrames coupée pour le projet (`HYPERFRAMES_NO_TELEMETRY=1` dans `.claude/settings.json`).
- Images réelles des produits : `docs/captures/` (SELECTA fr/en, Liputa) ; nouvelles captures ou enregistrements d'écran avec `playwright`.
- Connecteurs claude.ai déjà reliés : HyperFrames by HeyGen (projets hébergés et rendu cloud), Canva, Figma.
