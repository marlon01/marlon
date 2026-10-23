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

- Lire `/hyperframes` avant toute vidéo. Rendu : `cd film && npm run check && npm run render` (FFmpeg et Chrome headless présents).
- GSAP est servi en local (`film/assets/vendor/gsap.min.js`) : le Chrome de rendu n'atteint pas les CDN derrière le proxy, et un rendu ne doit rien charger du réseau.
- Télémétrie HyperFrames coupée pour le projet (`HYPERFRAMES_NO_TELEMETRY=1` dans `.claude/settings.json`).
- Images réelles des produits : `docs/captures/` (SELECTA fr/en, Liputa) ; nouvelles captures ou enregistrements d'écran avec `playwright`.
- Connecteurs claude.ai déjà reliés : HyperFrames by HeyGen (projets hébergés et rendu cloud), Canva, Figma.
