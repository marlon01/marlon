/** @odoo-module */
/* État partagé de la console (session de l'utilisateur, configuration). */
export const store = { session: null, config: {} };

export function hasRole(...roles) {
    const r = store.session?.roles || {};
    return roles.some((x) => r[x]);
}

/**
 * Points d'extension de la console, alimentés par les modules complémentaires (abonnement…) :
 *   nav     : [{ key, label, icon, roles, sequence, href?, visible?(session) }] — entrées ajoutées au menu ;
 *   pages   : { key: Composant } — page affichée pour la route #/key ;
 *   banners : [Composant] — bandeaux affichés en tête de toutes les pages.
 */
export const extensions = { nav: [], pages: {}, banners: [] };

export function navigate(path) {
    location.hash = path;
}
