/* Personnages du film Liputa (illustration vectorielle, dessinés pour le film).
 *
 * LiputaRig.draw(el, { kind: "nadege" | "chantal", id }) dessine le personnage dans `el` ;
 * chaque partie animable porte un id préfixé : `${id}-head`, `${id}-armL`, `${id}-armR`,
 * `${id}-torso`, `${id}-eyes`, `${id}-mouth-<humeur>`, `${id}-brows-<humeur>`, `${id}-eyesclosed`.
 * Les fonctions mood / blinks / talk / breathe ajoutent le jeu d'acteur à une timeline GSAP.
 * Tout est déterministe : aucune horloge, aucun hasard.
 */
(function () {
  const SKIN = { nadege: "#6b3f26", chantal: "#8a5634" };
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
      <path d="M-6 0 Q0 14 8 8" stroke="${skin === SKIN.nadege ? "#4f2c19" : "#6a3f22"}" stroke-width="4" fill="none" stroke-linecap="round"/>
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

  function nadege(id) {
    const skin = SKIN.nadege;
    return `<svg viewBox="0 0 400 620" width="100%" height="100%" overflow="visible">
      <defs>${pattern(`${id}-wax1`, "#1f7a72", "#f2c230", "#e07a2f")}${pattern(`${id}-wax2`, "#e07a2f", "#1f7a72", "#fbe9c8")}</defs>
      <g id="${id}-body" transform="translate(200 620)">
        <g id="${id}-torso" style="transform-origin: 0px 0px">
          <path d="M-150 0 Q-160 -250 -70 -300 L70 -300 Q160 -250 150 0 Z" fill="url(#${id}-wax1)"/>
          <path d="M-36 -300 Q0 -262 36 -300 Z" fill="${skin}"/>
          <!-- mètre ruban autour du cou -->
          <path d="M-58 -298 Q-62 -200 -72 -120" stroke="#f2c230" stroke-width="22" fill="none" stroke-linecap="round"/>
          <path d="M58 -298 Q64 -210 76 -150" stroke="#f2c230" stroke-width="22" fill="none" stroke-linecap="round"/>
          <path d="M-58 -298 Q-62 -200 -72 -120" stroke="#16213e" stroke-width="22" fill="none" stroke-dasharray="2 12" opacity=".55"/>
          <path d="M58 -298 Q64 -210 76 -150" stroke="#16213e" stroke-width="22" fill="none" stroke-dasharray="2 12" opacity=".55"/>
        </g>
        <g id="${id}-armL" style="transform-origin: -120px -250px">
          <path d="M-120 -250 Q-170 -150 -150 -40" stroke="url(#${id}-wax1)" stroke-width="58" fill="none" stroke-linecap="round"/>
          <circle cx="-150" cy="-34" r="26" fill="${skin}"/>
        </g>
        <g id="${id}-armR" style="transform-origin: 120px -250px">
          <path d="M120 -250 Q170 -150 150 -40" stroke="url(#${id}-wax1)" stroke-width="58" fill="none" stroke-linecap="round"/>
          <circle cx="150" cy="-34" r="26" fill="${skin}"/>
        </g>
        <g transform="translate(0 -400)"><g id="${id}-head">
          <rect x="-30" y="40" width="60" height="70" fill="${skin}"/>
          <ellipse cx="-84" cy="0" rx="14" ry="20" fill="${skin}"/><ellipse cx="84" cy="0" rx="14" ry="20" fill="${skin}"/>
          <circle cx="-86" cy="26" r="9" fill="#f2c230"/><circle cx="86" cy="26" r="9" fill="#f2c230"/>
          <ellipse cx="0" cy="0" rx="86" ry="96" fill="${skin}"/>
          <!-- foulard (gele) en wax -->
          <path d="M-96 -30 Q-110 -150 0 -158 Q110 -150 96 -30 Q60 -70 0 -66 Q-60 -70 -96 -30 Z" fill="url(#${id}-wax2)"/>
          <path d="M60 -140 Q140 -170 150 -110 Q120 -120 92 -96 Z" fill="url(#${id}-wax2)"/>
          <path d="M-96 -30 Q0 -84 96 -30" stroke="#c4502a" stroke-width="10" fill="none"/>
          <g stroke="#1b120c" stroke-width="6" fill="none" stroke-linecap="round">${face(id, skin)}</g>
        </g></g>
      </g>
    </svg>`;
  }

  function chantal(id) {
    const skin = SKIN.chantal;
    return `<svg viewBox="0 0 400 620" width="100%" height="100%" overflow="visible">
      <defs>${pattern(`${id}-wax`, "#c4502a", "#f2c230", "#16213e")}</defs>
      <g id="${id}-body" transform="translate(200 620)">
        <g id="${id}-torso" style="transform-origin: 0px 0px">
          <path id="${id}-haut" d="M-140 0 Q-150 -240 -66 -292 L66 -292 Q150 -240 140 0 Z" fill="#f2c230"/>
          <path id="${id}-robe" d="M-140 0 Q-150 -240 -66 -292 L66 -292 Q150 -240 140 0 Z" fill="url(#${id}-wax)" opacity="0"/>
          <path d="M-34 -292 Q0 -250 34 -292 Z" fill="${skin}"/>
          <path d="M-30 -270 Q0 -238 30 -270" stroke="#fbfcfe" stroke-width="5" fill="none" opacity=".9"/>
        </g>
        <g id="${id}-armL" style="transform-origin: -112px -244px">
          <path d="M-112 -244 Q-158 -150 -140 -40" stroke="${skin}" stroke-width="44" fill="none" stroke-linecap="round"/>
          <circle cx="-140" cy="-34" r="24" fill="${skin}"/>
        </g>
        <g id="${id}-armR" style="transform-origin: 112px -244px">
          <path d="M112 -244 Q158 -150 140 -40" stroke="${skin}" stroke-width="44" fill="none" stroke-linecap="round"/>
          <circle cx="140" cy="-34" r="24" fill="${skin}"/>
        </g>
        <g transform="translate(0 -392)"><g id="${id}-head">
          <rect x="-28" y="40" width="56" height="70" fill="${skin}"/>
          <circle cx="-74" cy="-104" r="56" fill="#1e120c"/><circle cx="74" cy="-104" r="56" fill="#1e120c"/>
          <ellipse cx="0" cy="-60" rx="92" ry="64" fill="#1e120c"/>
          <ellipse cx="-82" cy="2" rx="13" ry="19" fill="${skin}"/><ellipse cx="82" cy="2" rx="13" ry="19" fill="${skin}"/>
          <circle cx="-84" cy="30" r="11" fill="none" stroke="#f2c230" stroke-width="4"/><circle cx="84" cy="30" r="11" fill="none" stroke="#f2c230" stroke-width="4"/>
          <ellipse cx="0" cy="4" rx="82" ry="92" fill="${skin}"/>
          <path d="M-82 -30 Q-60 -88 0 -86 Q60 -88 82 -30 Q50 -64 0 -60 Q-50 -64 -82 -30 Z" fill="#1e120c"/>
          <g stroke="#1b120c" stroke-width="6" fill="none" stroke-linecap="round">${face(id, skin)}</g>
        </g></g>
      </g>
    </svg>`;
  }

  function show(tl, sel, on, t, d) {
    tl.to(sel, { opacity: on ? 1 : 0, duration: d, ease: "none" }, t);
  }

  window.LiputaRig = {
    draw(el, { kind, id }) {
      el.innerHTML = kind === "chantal" ? chantal(id) : nadege(id);
      // GSAP ignore le transform-origin CSS des groupes SVG : on fixe chaque pivot
      // (épaule, cou, base du buste) dans le repère parent avec svgOrigin.
      const [sx, sy] = kind === "chantal" ? [112, -244] : [120, -250];
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
