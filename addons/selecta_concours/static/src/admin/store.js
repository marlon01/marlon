/** @odoo-module */
/* État partagé de la console (session de l'utilisateur, configuration). */
export const store = { session: null, config: {} };

export function hasRole(...roles) {
    const r = store.session?.roles || {};
    return roles.some((x) => r[x]);
}

export function navigate(path) {
    location.hash = path;
}
