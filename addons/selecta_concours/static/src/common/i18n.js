/** @odoo-module */
/*
 * Interface bilingue français / anglais.
 *
 * Les écrans sont rédigés en français ; en anglais, chaque texte affiché (nœuds texte, placeholder,
 * title, aria-label, alt, titre du document) est remplacé à la volée par sa traduction dès que
 * l'interface le produit (MutationObserver : avant l'affichage, sans clignotement). Les messages
 * contenant des valeurs (« Import de 3 question(s) ») sont reconnus par des modèles %s / %(nom)s.
 *
 * Langue : choix mémorisé (sélecteur FR | EN, éléments [data-selecta-lang]), sinon langue du
 * navigateur. Les dictionnaires sont générés depuis i18n_ui/en.json (tools/build_ui_i18n.py).
 * Un élément [data-no-i18n] et ses descendants ne sont jamais traduits (saisies, contenus métier).
 */
const STORAGE_KEY = "selecta.lang";
const ATTRIBUTES = ["placeholder", "title", "aria-label", "alt"];
// Contenu jamais traduit ; une zone de saisie (TEXTAREA) garde son texte mais son placeholder est traduit.
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "CODE", "PRE"]);
const exact = new Map();
const patterns = [];
const done = new WeakMap(); // nœud → dernière valeur écrite par la traduction

// Apostrophes typographiques et droites confondues : « l’essai » et « l'essai » partagent leur traduction.
const norm = (s) => s.replace(/\s+/g, " ").replace(/[’‘]/g, "'").trim();

function compile(key, value) {
    const names = [];
    const source = key.replace(/%%/g, "\u0000").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = source.replace(/%\\\((\w+)\\\)s|%(?:\\\.\d)?[sdf]/g, (m, name) => {
        names.push(name || null);
        // %d : nombre uniquement (« 3 sur 10 »), pour ne pas capturer une phrase entière.
        return m === "%d" ? "([\\d\\s.,\u00a0\u202f]+)" : "(.*?)";
    }).replace(/\u0000/g, "%");
    // Le modèle le plus précis (le plus de texte fixe) est essayé en premier : « Catégorie %s activée… »
    // passe avant « Catégorie %s ».
    const weight = key.replace(/%(\(\w+\))?(\.\d)?[sdf]/g, "").length;
    patterns.push({ regex: new RegExp(`^${regex}$`), names, value, weight });
}

/** Ajoute des traductions pour l'anglais (clé : texte français tel qu'affiché). */
export function register(dict) {
    for (const [key, value] of Object.entries(dict)) {
        if (/%(\(\w+\))?(\.\d)?[sdf]/.test(key)) {
            compile(norm(key), value);
        } else {
            exact.set(norm(key), value);
        }
    }
    patterns.sort((a, b) => b.weight - a.weight);
}

export function getLang() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved === "fr" || saved === "en") {
            return saved;
        }
    } catch {
        // Stockage indisponible (navigation privée, kiosque) : langue du navigateur.
    }
    return (navigator.language || "fr").toLowerCase().startsWith("en") ? "en" : "fr";
}

export function setLang(lang) {
    try {
        localStorage.setItem(STORAGE_KEY, lang);
    } catch {
        // Sans stockage, le choix vaut pour cette page seulement.
    }
    location.reload();
}

/** Locale des dates et des nombres. */
export function locale() {
    return getLang() === "en" ? "en-GB" : "fr-FR";
}

/** Traduction d'un texte (français si l'interface est en français ou si le texte est inconnu). */
export function t(text) {
    if (getLang() !== "en" || !text) {
        return text;
    }
    return lookup(norm(String(text)), 0) ?? text;
}

function lookup(key, depth) {
    if (exact.has(key)) {
        return exact.get(key);
    }
    if (key.length < 400 && depth < 2) {
        for (const p of patterns) {
            const m = p.regex.exec(key);
            if (m) {
                const groups = m.slice(1);
                let i = 0;
                return p.value.replace(/%%/g, "\u0000").replace(/%\((\w+)\)s|%(?:\.\d)?[sdf]/g, (all, name) => {
                    const index = name ? p.names.indexOf(name) : i++;
                    // Une valeur connue du dictionnaire (nom de catégorie, « Semaine du 19/10 »…) est traduite elle aussi.
                    return index >= 0 && groups[index] !== undefined ? lookup(groups[index], depth + 1) ?? groups[index] : all;
                }).replace(/\u0000/g, "%");
            }
        }
    }
    return null;
}

function translateText(node) {
    const value = node.nodeValue;
    if (node.parentElement?.tagName === "TEXTAREA" || !value || done.get(node) === value || !/[A-Za-zÀ-ÿ]/.test(value)) {
        return;
    }
    const translated = t(value);
    if (translated !== value) {
        const lead = value.match(/^\s*/)[0];
        const trail = value.match(/\s*$/)[0];
        const next = lead + translated + trail;
        done.set(node, next);
        node.nodeValue = next;
    } else {
        done.set(node, value);
    }
}

function skipped(el) {
    return !el || SKIP_TAGS.has(el.tagName) || el.closest?.("[data-no-i18n], [contenteditable='true']");
}

function translateAttributes(el) {
    for (const name of ATTRIBUTES) {
        const value = el.getAttribute(name);
        if (value) {
            const translated = t(value);
            if (translated !== value) {
                el.setAttribute(name, translated);
            }
        }
    }
}

/** Traduit un arbre DOM, y compris celui d'un autre document (iframe d'impression). */
export function translateTree(root) {
    if (root.nodeType === Node.TEXT_NODE) {
        if (!skipped(root.parentElement)) {
            translateText(root);
        }
        return;
    }
    if (getLang() !== "en" || root.nodeType !== Node.ELEMENT_NODE || skipped(root)) {
        return;
    }
    translateAttributes(root);
    const walker = (root.ownerDocument || document).createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => (n.nodeType === Node.ELEMENT_NODE && skipped(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (n.nodeType === Node.TEXT_NODE) {
            translateText(n);
        } else {
            translateAttributes(n);
        }
    }
}

let started = false;

/** Démarre la traduction de la page (sans effet en français) et branche le sélecteur de langue. */
export function startI18n() {
    if (started) {
        return;
    }
    started = true;
    const lang = getLang();
    document.documentElement.lang = lang;
    document.documentElement.dataset.lang = lang;
    document.addEventListener("click", (ev) => {
        const btn = ev.target.closest?.("[data-selecta-lang]");
        if (btn) {
            ev.preventDefault();
            if (btn.dataset.selectaLang !== getLang()) {
                setLang(btn.dataset.selectaLang);
            }
        }
    });
    if (lang !== "en") {
        return;
    }
    const translateTitle = () => {
        const translated = t(document.title);
        if (translated !== document.title) {
            document.title = translated;
        }
    };
    translateTitle();
    translateTree(document.body);
    new MutationObserver((mutations) => {
        for (const m of mutations) {
            if (m.type === "characterData") {
                if (!skipped(m.target.parentElement)) {
                    translateText(m.target);
                }
            } else if (m.type === "attributes") {
                if (!skipped(m.target)) {
                    translateAttributes(m.target);
                }
            } else {
                m.addedNodes.forEach(translateTree);
            }
        }
    }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRIBUTES });
    const titleEl = document.querySelector("title");
    if (titleEl) {
        new MutationObserver(translateTitle).observe(titleEl, { childList: true, characterData: true, subtree: true });
    }
}

if (typeof document !== "undefined") {
    if (document.body) {
        startI18n();
    } else {
        document.addEventListener("DOMContentLoaded", startI18n);
    }
}
