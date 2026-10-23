/* Personnages du film SELECTA (illustration vectorielle ; même mécanique que le rig du film
 * Liputa, film/liputa/assets/rig.js).
 *
 * SelectaRig.draw(el, { kind: "clarisse" | "grace", id }) dessine le personnage dans `el` ;
 * chaque partie animable porte un id préfixé : `${id}-head`, `${id}-armL`, `${id}-armR`,
 * `${id}-torso`, `${id}-eyes`, `${id}-mouth-<humeur>`, `${id}-brows-<humeur>`, `${id}-eyesclosed`.
 * Les fonctions mood / blinks / talk / breathe ajoutent le jeu d'acteur à une timeline GSAP.
 * Tout est déterministe : aucune horloge, aucun hasard.
 */
(function () {
  const SKIN = { clarisse: "#5a3420", grace: "#7a4a2c" };
  const MOODS = ["neutre", "inquiete", "sourire", "soulagee", "espoir", "joie"];

  function pattern(id, bg, a, b) {
    return `<pattern id="${id}" width="26" height="26" patternUnits="userSpaceOnUse" patternTransform="rotate(18)">
      <rect width="26" height="26" fill="${bg}"/>
      <circle cx="7" cy="7" r="5" fill="${a}"/><circle cx="20" cy="20" r="4" fill="${b}"/>
      <path d="M0 13 Q6.5 9 13 13 T26 13" stroke="${a}" stroke-width="2" fill="none" opacity=".6"/>
    </pattern>`;
  }

  function face(id, skin) {
    // Visage centré en (0,0) dans le groupe de la tête.
    return `
      <g id="${id}-brows">
        <g id="${id}-brows-neutre"><path d="M-46 -38 Q-30 -44 -16 -38" /><path d="M16 -38 Q30 -44 46 -38" /></g>
        <g id="${id}-brows-inquiete" opacity="0"><path d="M-46 -34 Q-30 -36 -16 -46" /><path d="M16 -46 Q30 -36 46 -34" /></g>
        <g id="${id}-brows-sourire" opacity="0"><path d="M-46 -40 Q-30 -50 -16 -42" /><path d="M16 -42 Q30 -50 46 -40" /></g>
        <g id="${id}-brows-espoir" opacity="0"><path d="M-46 -42 Q-30 -54 -16 -46" /><path d="M16 -46 Q30 -54 46 -42" /></g>
      </g>
      <g id="${id}-eyes" stroke="none">
        <ellipse cx="-30" cy="-16" rx="12" ry="14" fill="#fff"/><ellipse cx="30" cy="-16" rx="12" ry="14" fill="#fff"/>
        <circle id="${id}-pupL" cx="-28" cy="-14" r="7" fill="#1b120c"/><circle id="${id}-pupR" cx="32" cy="-14" r="7" fill="#1b120c"/>
        <circle cx="-26" cy="-17" r="2.4" fill="#fff"/><circle cx="34" cy="-17" r="2.4" fill="#fff"/>
      </g>
      <g id="${id}-eyesclosed" opacity="0" stroke="#1b120c" stroke-width="5" fill="none" stroke-linecap="round">
        <path d="M-42 -14 Q-30 -4 -18 -14"/><path d="M18 -14 Q30 -4 42 -14"/>
      </g>
      <ellipse cx="-44" cy="14" rx="12" ry="7" fill="#e0785a" opacity=".35" stroke="none"/><ellipse cx="44" cy="14" rx="12" ry="7" fill="#e0785a" opacity=".35" stroke="none"/>
      <path d="M-6 0 Q0 14 8 8" stroke="${skin === SKIN.clarisse ? "#43261a" : "#5e3820"}" stroke-width="4" fill="none" stroke-linecap="round"/>
      <g id="${id}-mouth" stroke-linecap="round" stroke-linejoin="round">
        <path id="${id}-mouth-neutre" d="M-16 30 Q0 34 16 30" stroke="#3b1d10" stroke-width="5" fill="none"/>
        <path id="${id}-mouth-inquiete" d="M-16 36 Q0 26 16 36" stroke="#3b1d10" stroke-width="5" fill="none" opacity="0"/>
        <path id="${id}-mouth-sourire" d="M-22 26 Q0 46 22 26" stroke="#3b1d10" stroke-width="5" fill="none" opacity="0"/>
        <path id="${id}-mouth-soulagee" d="M-18 28 Q0 40 18 28" stroke="#3b1d10" stroke-width="5" fill="none" opacity="0"/>
        <path id="${id}-mouth-espoir" d="M-14 30 Q0 38 14 30" stroke="#3b1d10" stroke-width="5" fill="none" opacity="0"/>
        <path id="${id}-mouth-joie" d="M-24 24 Q0 56 24 24 Z" fill="#3b1d10" stroke="#3b1d10" stroke-width="3" opacity="0"/>
        <ellipse id="${id}-mouth-parle" cx="0" cy="32" rx="11" ry="9" fill="#3b1d10" opacity="0"/>
      </g>`;
  }

  function clarisse(id) {
    // Clarisse, DRH : tailleur bleu nuit, chemisier blanc, badge, cheveux courts, lunettes.
    const skin = SKIN.clarisse;
    return `<svg viewBox="0 0 400 620" width="100%" height="100%" overflow="visible">
      <g id="${id}-body" transform="translate(200 620)">
        <g id="${id}-torso">
          <path d="M-140 0 Q-150 -240 -66 -292 L66 -292 Q150 -240 140 0 Z" fill="#16213e"/>
          <path d="M-40 -292 L0 -200 L40 -292 Z" fill="#fbfcfe"/>
          <path d="M-34 -292 Q0 -258 34 -292 Z" fill="${skin}"/>
          <path d="M-66 -292 L-8 -150 L-40 -110 Z M66 -292 L8 -150 L40 -110 Z" fill="#24335a"/>
          <rect x="-96" y="-170" width="34" height="46" rx="6" fill="#fbfcfe"/><rect x="-90" y="-160" width="22" height="6" rx="3" fill="#138a5e"/>
        </g>
        <g id="${id}-armL">
          <path d="M-112 -244 Q-158 -150 -140 -40" stroke="#16213e" stroke-width="46" fill="none" stroke-linecap="round"/>
          <circle cx="-140" cy="-34" r="22" fill="${skin}"/>
        </g>
        <g id="${id}-armR">
          <path d="M112 -244 Q158 -150 140 -40" stroke="#16213e" stroke-width="46" fill="none" stroke-linecap="round"/>
          <circle cx="140" cy="-34" r="22" fill="${skin}"/>
        </g>
        <g transform="translate(0 -392)"><g id="${id}-head">
          <rect x="-28" y="40" width="56" height="70" fill="${skin}"/>
          <ellipse cx="0" cy="-42" rx="94" ry="76" fill="#1e120c"/>
          <ellipse cx="-82" cy="2" rx="13" ry="19" fill="${skin}"/><ellipse cx="82" cy="2" rx="13" ry="19" fill="${skin}"/>
          <circle cx="-84" cy="26" r="7" fill="#e9eef7"/><circle cx="84" cy="26" r="7" fill="#e9eef7"/>
          <ellipse cx="0" cy="6" rx="80" ry="90" fill="${skin}"/>
          <path d="M-80 -24 Q-70 -84 0 -86 Q70 -84 80 -24 Q40 -60 0 -58 Q-40 -60 -80 -24 Z" fill="#1e120c"/>
          <g stroke="#1b120c" stroke-width="6" fill="none" stroke-linecap="round">${face(id, skin)}</g>
          <g id="${id}-lunettes" fill="none" stroke="#c4502a" stroke-width="5"><circle cx="-30" cy="-13" r="19"/><circle cx="30" cy="-13" r="19"/><path d="M-9 -18 Q0 -24 9 -18"/></g>
        </g></g>
      </g>
    </svg>`;
  }

  function grace(id) {
    // Grâce, candidate : tresses longues, chignon, haut violet.
    const skin = SKIN.grace;
    return `<svg viewBox="0 0 400 620" width="100%" height="100%" overflow="visible">
      <g id="${id}-body" transform="translate(200 620)">
        <g id="${id}-torso">
          <path d="M-140 0 Q-150 -240 -66 -292 L66 -292 Q150 -240 140 0 Z" fill="#6a4c9c"/>
          <path d="M-34 -292 Q0 -250 34 -292 Z" fill="${skin}"/>
          <path d="M-120 -40 L120 -40" stroke="#f2c230" stroke-width="10" opacity=".9"/>
        </g>
        <g id="${id}-armL">
          <path d="M-112 -244 Q-158 -150 -140 -40" stroke="${skin}" stroke-width="42" fill="none" stroke-linecap="round"/>
          <circle cx="-140" cy="-34" r="22" fill="${skin}"/>
        </g>
        <g id="${id}-armR">
          <path d="M112 -244 Q158 -150 140 -40" stroke="${skin}" stroke-width="42" fill="none" stroke-linecap="round"/>
          <circle cx="140" cy="-34" r="22" fill="${skin}"/>
        </g>
        <g transform="translate(0 -392)"><g id="${id}-head">
          <rect x="-28" y="40" width="56" height="70" fill="${skin}"/>
          <g stroke="#1e120c" stroke-width="16" stroke-linecap="round" fill="none">
            <path d="M-78 -20 Q-96 80 -86 190"/><path d="M-60 -10 Q-76 90 -66 200"/>
            <path d="M78 -20 Q96 80 86 190"/><path d="M60 -10 Q76 90 66 200"/>
          </g>
          <circle cx="0" cy="-118" r="40" fill="#1e120c"/>
          <ellipse cx="0" cy="-40" rx="90" ry="70" fill="#1e120c"/>
          <ellipse cx="-80" cy="4" rx="12" ry="18" fill="${skin}"/><ellipse cx="80" cy="4" rx="12" ry="18" fill="${skin}"/>
          <ellipse cx="0" cy="6" rx="78" ry="90" fill="${skin}"/>
          <path d="M-78 -24 Q-60 -86 0 -84 Q60 -86 78 -24 Q44 -62 0 -58 Q-44 -62 -78 -24 Z" fill="#1e120c"/>
          <g stroke="#1b120c" stroke-width="6" fill="none" stroke-linecap="round">${face(id, skin)}</g>
        </g></g>
      </g>
    </svg>`;
  }

  function show(tl, sel, on, t, d) {
    tl.to(sel, { opacity: on ? 1 : 0, duration: d, ease: "none" }, t);
  }

  window.SelectaRig = {
    draw(el, { kind, id }) {
      el.innerHTML = kind === "grace" ? grace(id) : clarisse(id);
      // GSAP ignore le transform-origin CSS des groupes SVG : on fixe chaque pivot
      // (épaule, cou, base du buste) dans le repère parent avec svgOrigin.
      const [sx, sy] = [112, -244];
      gsap.set(`#${id}-armL`, { svgOrigin: `${-sx} ${sy}` });
      gsap.set(`#${id}-armR`, { svgOrigin: `${sx} ${sy}` });
      gsap.set(`#${id}-head`, { svgOrigin: "0 90" });
      gsap.set(`#${id}-torso`, { svgOrigin: "0 0" });
    },
    /** Changement d'humeur : anticipation (la tête se tasse), nouveau visage, retour. */
    mood(tl, id, mood, t) {
      const d = 0.12;
      tl.to(`#${id}-head`, { scaleY: 0.96, duration: 0.08, ease: "power2.in" }, t - 0.08);
      tl.to(`#${id}-head`, { scaleY: 1, duration: 0.25, ease: "back.out(2)" }, t);
      MOODS.forEach((m) => show(tl, `#${id}-mouth-${m}`, m === mood, t, d));
      ["neutre", "inquiete", "sourire", "espoir"].forEach((m) => {
        const want = mood === "soulagee" || mood === "joie" ? "sourire" : mood;
        show(tl, `#${id}-brows-${m}`, m === want || (!["neutre", "inquiete", "sourire", "espoir"].includes(want) && m === "neutre"), t, d);
      });
      const closed = mood === "soulagee";
      show(tl, `#${id}-eyes`, !closed, t, d);
      show(tl, `#${id}-eyesclosed`, closed, t, d);
    },
    blinks(tl, id, times) {
      times.forEach((t) => {
        tl.to(`#${id}-eyes`, { scaleY: 0.1, transformOrigin: "50% 50%", duration: 0.06, ease: "power2.in" }, t);
        tl.to(`#${id}-eyes`, { scaleY: 1, duration: 0.08, ease: "power2.out" }, t + 0.06);
      });
    },
    /** La bouche bat à 7–8 Hz pendant une réplique, avec un rythme qui varie (pas un métronome). */
    talk(tl, id, start, end, base = "neutre") {
      const steps = [0.13, 0.11, 0.16, 0.12, 0.1, 0.15, 0.12];
      let t = start, i = 0;
      while (t < end - 0.05) {
        tl.set(`#${id}-mouth-parle`, { opacity: i % 2 ? 0 : 1 }, t);
        tl.set(`#${id}-mouth-${base}`, { opacity: i % 2 ? 1 : 0 }, t);
        t += steps[i % steps.length]; i++;
      }
      tl.set(`#${id}-mouth-parle`, { opacity: 0 }, end);
      tl.set(`#${id}-mouth-${base}`, { opacity: 1 }, end);
    },
    /** Respiration : une montée et une descente du buste toutes les 3,2 s environ. */
    breathe(tl, id, from, to, amp = 0.012) {
      for (let t = from; t < to - 1.6; t += 3.2) {
        tl.to(`#${id}-torso`, { scaleY: 1 + amp, duration: 1.6, ease: "sine.inOut" }, t);
        tl.to(`#${id}-torso`, { scaleY: 1, duration: 1.6, ease: "sine.inOut" }, t + 1.6);
      }
    },
    /** Regard : les pupilles se déplacent (x, y en pixels du dessin). */
    look(tl, id, x, y, t) {
      tl.to([`#${id}-pupL`, `#${id}-pupR`], { x, y, duration: 0.18, ease: "power2.out" }, t);
    },
  };
})();
