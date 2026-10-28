(() => {
  "use strict";

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const fmt = (n) => n.toLocaleString("ru-RU") + " ₽";
  const store = {
    get(key, fallback) {
      try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
    },
  };
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = matchMedia("(pointer: fine)").matches;

  // the motion layer swaps in its smooth scroller when it is active
  const scrollToEl = (el) => (window.VOLTA?.scrollTo ? window.VOLTA.scrollTo(el) : el.scrollIntoView({ behavior: "smooth" }));

  /* ================= COLOR HELPERS ================= */
  const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const rgbToHex = (rgb) => "#" + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
  // amt > 0 mixes with white, amt < 0 mixes with black
  const shade = (hex, amt) => {
    const t = amt > 0 ? 255 : 0;
    return rgbToHex(hexToRgb(hex).map((v) => v + (t - v) * Math.abs(amt)));
  };
  const isLight = (hex) => {
    const [r, g, b] = hexToRgb(hex);
    return 0.299 * r + 0.587 * g + 0.114 * b > 150;
  };

  /* ================= DEVICE RENDERS (SVG) ================= */
  let uidSeed = 0;
  function defs(u, c) {
    return `<defs>
      <linearGradient id="${u}b" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${shade(c, 0.22)}"/><stop offset=".45" stop-color="${c}"/><stop offset="1" stop-color="${shade(c, -0.18)}"/>
      </linearGradient>
      <linearGradient id="${u}e" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="${shade(c, -0.35)}"/><stop offset=".08" stop-color="${shade(c, 0.35)}"/>
        <stop offset=".5" stop-color="${shade(c, -0.05)}"/><stop offset=".92" stop-color="${shade(c, 0.3)}"/><stop offset="1" stop-color="${shade(c, -0.35)}"/>
      </linearGradient>
      <linearGradient id="${u}s" x1="0" y1="0" x2="1" y2="0.6">
        <stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset=".35" stop-color="#fff" stop-opacity="0"/>
      </linearGradient>
      <radialGradient id="${u}l" cx=".4" cy=".35" r=".7">
        <stop offset="0" stop-color="#3d4a7a"/><stop offset=".45" stop-color="#151a2e"/><stop offset="1" stop-color="#05060a"/>
      </radialGradient>
      <linearGradient id="${u}d" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${shade(c, 0.55)}"/><stop offset=".5" stop-color="${shade(c, 0.15)}"/><stop offset="1" stop-color="${shade(c, -0.3)}"/>
      </linearGradient>
    </defs>`;
  }
  function lens(u, x, y, r, ring) {
    return `<g>
      <circle cx="${x}" cy="${y}" r="${r}" fill="${ring}"/>
      <circle cx="${x}" cy="${y}" r="${r * 0.86}" fill="#0a0b0f"/>
      <circle cx="${x}" cy="${y}" r="${r * 0.62}" fill="url(#${u}l)"/>
      <circle cx="${x}" cy="${y}" r="${r * 0.3}" fill="#05060a"/>
      <circle cx="${x - r * 0.22}" cy="${y - r * 0.26}" r="${r * 0.14}" fill="#fff" opacity=".55">
        <animate attributeName="opacity" values=".35;.9;.35" dur="${(3 + Math.random() * 2).toFixed(1)}s" repeatCount="indefinite"/>
      </circle>
    </g>`;
  }
  const flash = (x, y, r) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#f4ecd6" stroke="rgba(0,0,0,.25)" stroke-width="1"/>`;
  const phoneBody = (u, rx = 36) => `
    <rect x="8" y="8" width="184" height="384" rx="${rx}" fill="url(#${u}e)"/>
    <rect x="13" y="13" width="174" height="374" rx="${rx - 5}" fill="url(#${u}b)"/>
    <rect x="13" y="13" width="174" height="374" rx="${rx - 5}" fill="url(#${u}s)"/>`;

  const renders = {
    iphonePro(c, u) {
      const ring = shade(c, -0.3);
      return `<svg viewBox="0 0 200 400">${defs(u, c)}${phoneBody(u)}
        <path d="M13 44a31 31 0 0 1 31-31h112a31 31 0 0 1 31 31v96H13z" fill="${shade(c, 0.08)}"/>
        <path d="M13 140h174" stroke="${shade(c, -0.2)}" stroke-width="1.5"/>
        <rect x="22" y="22" width="110" height="108" rx="30" fill="${shade(c, -0.12)}"/>
        ${lens(u, 52, 52, 21, ring)}${lens(u, 52, 102, 21, ring)}${lens(u, 100, 77, 21, ring)}
        ${flash(156, 50, 8)}<circle cx="156" cy="102" r="8" fill="#15161a"/><circle cx="156" cy="76" r="3" fill="#15161a"/>
      </svg>`;
    },
    iphoneAir(c, u) {
      return `<svg viewBox="0 0 200 400">${defs(u, c)}${phoneBody(u)}
        <rect x="22" y="24" width="156" height="56" rx="28" fill="${shade(c, -0.08)}"/>
        <rect x="22" y="24" width="156" height="56" rx="28" fill="url(#${u}s)"/>
        ${lens(u, 52, 52, 20, shade(c, -0.3))}
        <circle cx="104" cy="52" r="7" fill="#0a0b0f"/>${flash(146, 52, 6)}
      </svg>`;
    },
    iphone(c, u) {
      return `<svg viewBox="0 0 200 400">${defs(u, c)}${phoneBody(u)}
        <rect x="24" y="24" width="56" height="110" rx="28" fill="${shade(c, 0.12)}" stroke="${shade(c, -0.15)}" stroke-width="1.5"/>
        ${lens(u, 52, 52, 21, shade(c, -0.25))}${lens(u, 52, 106, 21, shade(c, -0.25))}
        ${flash(98, 44, 7)}
      </svg>`;
    },
    galaxyUltra(c, u) {
      const ring = shade(c, -0.25);
      return `<svg viewBox="0 0 200 400">${defs(u, c)}${phoneBody(u, 22)}
        ${lens(u, 46, 50, 20, ring)}${lens(u, 46, 100, 20, ring)}${lens(u, 46, 150, 20, ring)}
        ${lens(u, 92, 62, 14, ring)}${flash(92, 100, 6)}<circle cx="92" cy="126" r="4" fill="#0a0b0f"/>
      </svg>`;
    },
    galaxyFold(c, u) {
      const ring = shade(c, -0.25);
      return `<svg viewBox="0 0 200 400">${defs(u, c)}${phoneBody(u, 20)}
        <rect x="13" y="13" width="10" height="374" fill="${shade(c, -0.2)}" opacity=".6"/>
        <rect x="32" y="26" width="52" height="150" rx="26" fill="${shade(c, -0.1)}"/>
        ${lens(u, 58, 54, 19, ring)}${lens(u, 58, 100, 19, ring)}${lens(u, 58, 146, 19, ring)}
        ${flash(102, 48, 6)}
      </svg>`;
    },
    galaxyFlip(c, u) {
      const ring = shade(c, -0.25);
      return `<svg viewBox="0 0 200 400">${defs(u, c)}${phoneBody(u, 30)}
        <rect x="18" y="18" width="164" height="172" rx="26" fill="#0b0c10"/>
        <rect x="18" y="18" width="164" height="172" rx="26" fill="url(#${u}s)" opacity=".5"/>
        <text x="100" y="80" text-anchor="middle" font-family="Onest, sans-serif" font-size="34" font-weight="500" fill="#fff">12:30</text>
        <text x="100" y="104" text-anchor="middle" font-family="Onest, sans-serif" font-size="12" fill="#9aa">ср, 28 окт.</text>
        ${lens(u, 44, 160, 17, ring)}${lens(u, 86, 160, 17, ring)}
        <rect x="13" y="196" width="174" height="10" fill="${shade(c, -0.25)}"/>
      </svg>`;
    },
    pixel(c, u) {
      const band = isLight(c) ? shade(c, -0.12) : shade(c, 0.12);
      return `<svg viewBox="0 0 200 400">${defs(u, c)}${phoneBody(u, 40)}
        <rect x="8" y="64" width="184" height="64" rx="32" fill="${band}"/>
        <rect x="22" y="72" width="156" height="48" rx="24" fill="#0b0c10"/>
        ${lens(u, 50, 96, 17, "#2a2b30")}${lens(u, 92, 96, 17, "#2a2b30")}${lens(u, 134, 96, 13, "#2a2b30")}
        ${flash(164, 96, 5)}
      </svg>`;
    },
    xiaomi(c, u) {
      const ring = shade(c, -0.25);
      return `<svg viewBox="0 0 200 400">${defs(u, c)}${phoneBody(u, 30)}
        <circle cx="100" cy="104" r="74" fill="${shade(c, -0.3)}"/>
        <circle cx="100" cy="104" r="68" fill="#0e0f13"/>
        <circle cx="100" cy="104" r="68" fill="url(#${u}s)"/>
        ${lens(u, 72, 76, 22, ring)}${lens(u, 128, 76, 22, ring)}${lens(u, 72, 132, 22, ring)}${lens(u, 128, 132, 22, ring)}
        ${flash(100, 104, 5)}
      </svg>`;
    },
    laptop(c, u, wall) {
      const w = wall || c;
      return `<svg viewBox="0 0 320 210">${defs(u, w)}
        <defs><linearGradient id="${u}k" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${shade(c, 0.2)}"/><stop offset="1" stop-color="${shade(c, -0.25)}"/></linearGradient>
          <clipPath id="${u}c"><rect x="44" y="16" width="232" height="148" rx="4"/></clipPath></defs>
        <rect x="34" y="6" width="252" height="168" rx="12" fill="${shade(c, -0.45)}"/>
        <rect x="38" y="10" width="244" height="160" rx="9" fill="#08090c"/>
        <rect x="44" y="16" width="232" height="148" rx="4" fill="url(#${u}d)"/>
        <g clip-path="url(#${u}c)">
          <circle cx="110" cy="70" r="70" fill="${shade(w, 0.4)}" opacity=".55">
            <animate attributeName="cx" values="110;190;110" dur="11s" repeatCount="indefinite"/>
            <animate attributeName="cy" values="70;110;70" dur="13s" repeatCount="indefinite"/>
          </circle>
          <circle cx="230" cy="140" r="60" fill="${shade(w, -0.35)}" opacity=".45">
            <animate attributeName="cx" values="230;120;230" dur="12s" repeatCount="indefinite"/>
          </circle>
        </g>
        <rect x="44" y="16" width="232" height="10" fill="rgba(0,0,0,.25)"/>
        <rect x="146" y="16" width="28" height="7" rx="3.5" fill="#08090c"/>
        <path d="M10 176h300l-8 14a10 10 0 0 1-8.7 5H26.7a10 10 0 0 1-8.7-5z" fill="url(#${u}k)"/>
        <path d="M10 176h300" stroke="${shade(c, 0.4)}" stroke-width="1.5"/>
        <rect x="134" y="176" width="52" height="5" rx="2.5" fill="${shade(c, -0.3)}"/>
      </svg>`;
    },
    tablet(c, u, pro) {
      const ring = shade(c, -0.25);
      return `<svg viewBox="0 0 280 380">${defs(u, c)}
        <rect x="8" y="8" width="264" height="364" rx="28" fill="url(#${u}e)"/>
        <rect x="12" y="12" width="256" height="356" rx="24" fill="url(#${u}b)"/>
        <rect x="12" y="12" width="256" height="356" rx="24" fill="url(#${u}s)"/>
        ${pro
          ? `<rect x="24" y="24" width="58" height="82" rx="22" fill="${shade(c, -0.1)}"/>${lens(u, 53, 50, 15, ring)}<circle cx="53" cy="86" r="9" fill="#111"/>${flash(72, 68, 4)}`
          : `${lens(u, 44, 44, 15, ring)}`}
      </svg>`;
    },
    earbuds(c, u) {
      return `<svg viewBox="0 0 240 240">${defs(u, c)}
        <rect x="34" y="52" width="172" height="146" rx="52" fill="url(#${u}b)"/>
        <rect x="34" y="52" width="172" height="146" rx="52" fill="url(#${u}s)"/>
        <path d="M36 104h168" stroke="${shade(c, -0.18)}" stroke-width="2"/>
        <circle cx="120" cy="134" r="3.5" fill="#2ecc71"><animate attributeName="opacity" values="1;.15;1" dur="2.2s" repeatCount="indefinite"/></circle>
        <rect x="104" y="186" width="32" height="6" rx="3" fill="${shade(c, -0.3)}"/>
      </svg>`;
    },
    headphones(c, u) {
      const dark = shade(c, -0.3);
      return `<svg viewBox="0 0 240 260">${defs(u, c)}
        <path d="M44 150V112a76 76 0 0 1 152 0v38" fill="none" stroke="${dark}" stroke-width="18" stroke-linecap="round"/>
        <path d="M44 150V112a76 76 0 0 1 152 0v38" fill="none" stroke="url(#${u}b)" stroke-width="12" stroke-linecap="round"/>
        <rect x="18" y="128" width="62" height="104" rx="30" fill="url(#${u}b)"/>
        <rect x="160" y="128" width="62" height="104" rx="30" fill="url(#${u}b)"/>
        <rect x="18" y="128" width="62" height="104" rx="30" fill="url(#${u}s)"/>
        <rect x="160" y="128" width="62" height="104" rx="30" fill="url(#${u}s)"/>
        <rect x="60" y="140" width="18" height="80" rx="9" fill="${dark}" opacity=".7"/>
        <rect x="162" y="140" width="18" height="80" rx="9" fill="${dark}" opacity=".7"/>
        ${[0, 1, 2, 3].map((i) => `<rect x="${188 + i * 7}" y="160" width="4" height="40" rx="2" fill="${isLight(c) ? "#2a2c33" : "#fff"}" opacity=".55">
          <animate attributeName="height" values="10;40;16;30;10" dur="${1 + i * 0.17}s" repeatCount="indefinite"/>
          <animate attributeName="y" values="175;160;172;165;175" dur="${1 + i * 0.17}s" repeatCount="indefinite"/>
        </rect>`).join("")}
      </svg>`;
    },
    watchSquare(c, u) {
      return `<svg viewBox="0 0 160 260">${defs(u, c)}
        <rect x="42" y="0" width="76" height="80" rx="14" fill="${shade(c, -0.15)}"/>
        <rect x="42" y="180" width="76" height="80" rx="14" fill="${shade(c, -0.15)}"/>
        <rect x="20" y="54" width="120" height="152" rx="38" fill="url(#${u}e)"/>
        <rect x="27" y="61" width="106" height="138" rx="32" fill="#050608"/>
        <text x="80" y="122" text-anchor="middle" font-family="Onest, sans-serif" font-size="30" font-weight="600" fill="#fff">10:09</text>
        <circle cx="80" cy="156" r="16" fill="none" stroke="#ff375f" stroke-opacity=".25" stroke-width="5"/>
        <circle cx="80" cy="156" r="16" fill="none" stroke="#ff375f" stroke-width="5" stroke-linecap="round" stroke-dasharray="70 120" transform="rotate(-90 80 156)">
          <animate attributeName="stroke-dasharray" values="0 120;80 120;80 120" keyTimes="0;.45;1" dur="5s" repeatCount="indefinite"/>
        </circle>
        <circle cx="80" cy="156" r="9" fill="none" stroke="#9cff3a" stroke-opacity=".25" stroke-width="4"/>
        <circle cx="80" cy="156" r="9" fill="none" stroke="#9cff3a" stroke-width="4" stroke-linecap="round" stroke-dasharray="38 80" transform="rotate(-90 80 156)">
          <animate attributeName="stroke-dasharray" values="0 80;42 80;42 80" keyTimes="0;.55;1" dur="5s" repeatCount="indefinite"/>
        </circle>
        <rect x="138" y="96" width="9" height="26" rx="4" fill="${shade(c, -0.2)}"/>
      </svg>`;
    },
    watchRound(c, u) {
      return `<svg viewBox="0 0 180 260">${defs(u, c)}
        <rect x="52" y="0" width="76" height="80" rx="14" fill="${shade(c, -0.2)}"/>
        <rect x="52" y="180" width="76" height="80" rx="14" fill="${shade(c, -0.2)}"/>
        <circle cx="90" cy="130" r="74" fill="url(#${u}e)"/>
        <circle cx="90" cy="130" r="64" fill="#050608"/>
        <text x="90" y="138" text-anchor="middle" font-family="Onest, sans-serif" font-size="30" font-weight="600" fill="#fff">10:09</text>
        <circle cx="90" cy="130" r="56" fill="none" stroke="#3aa0ff" stroke-width="3" stroke-linecap="round" stroke-dasharray="120 400">
          <animateTransform attributeName="transform" type="rotate" from="-90 90 130" to="270 90 130" dur="6s" repeatCount="indefinite"/>
        </circle>
        <rect x="160" y="104" width="10" height="20" rx="4" fill="${shade(c, -0.2)}"/>
        <rect x="160" y="136" width="10" height="20" rx="4" fill="${shade(c, -0.2)}"/>
      </svg>`;
    },
    ps5(c, u) {
      return `<svg viewBox="0 0 220 380">${defs(u, c)}
        <path d="M86 40h48v320H86z" fill="#121318"/>
        <path d="M86 30C60 30 30 60 26 120l-6 220c0 12 8 20 20 20h46z" fill="url(#${u}b)"/>
        <path d="M134 30c26 0 56 30 60 90l6 220c0 12-8 20-20 20h-46z" fill="url(#${u}b)"/>
        <path d="M86 30C60 30 30 60 26 120l-6 220c0 12 8 20 20 20h46z" fill="url(#${u}s)"/>
        <rect x="22" y="168" width="64" height="7" fill="#121318"/><rect x="22" y="186" width="64" height="7" fill="#121318"/>
        <rect x="134" y="168" width="64" height="7" fill="#121318"/><rect x="134" y="186" width="64" height="7" fill="#121318"/>
        <rect x="84" y="40" width="3" height="320" fill="#5aa8ff"><animate attributeName="opacity" values=".15;.9;.15" dur="3s" repeatCount="indefinite"/></rect>
        <rect x="133" y="40" width="3" height="320" fill="#5aa8ff"><animate attributeName="opacity" values=".15;.9;.15" dur="3s" repeatCount="indefinite"/></rect>
        <rect x="104" y="60" width="12" height="4" rx="2" fill="#5aa8ff"/>
      </svg>`;
    },
    switch2(c, u) {
      return `<svg viewBox="0 0 360 200">${defs(u, "#7b6cff")}
        <rect x="6" y="20" width="62" height="160" rx="28" fill="#2a2c33"/>
        <rect x="292" y="20" width="62" height="160" rx="28" fill="#2a2c33"/>
        <rect x="62" y="24" width="6" height="152" fill="#4aa8ff"/><rect x="292" y="24" width="6" height="152" fill="#ff5a5f"/>
        <rect x="68" y="20" width="224" height="160" rx="8" fill="#111216"/>
        <rect x="78" y="30" width="204" height="140" rx="4" fill="url(#${u}d)"/>
        <circle cx="140" cy="90" r="46" fill="#ffd166" opacity=".5"><animate attributeName="cx" values="140;220;140" dur="7s" repeatCount="indefinite"/></circle>
        <circle cx="230" cy="130" r="40" fill="#06d6a0" opacity=".45"><animate attributeName="cy" values="130;70;130" dur="6s" repeatCount="indefinite"/></circle>
        <circle cx="36" cy="60" r="13" fill="#15161a"/><circle cx="36" cy="60" r="9" fill="#33353d"/>
        <g fill="#15161a"><circle cx="36" cy="112" r="6"/><circle cx="36" cy="136" r="6"/><circle cx="24" cy="124" r="6"/><circle cx="48" cy="124" r="6"/></g>
        <circle cx="324" cy="126" r="13" fill="#15161a"/><circle cx="324" cy="126" r="9" fill="#33353d"/>
        <g fill="#15161a"><circle cx="324" cy="52" r="6"/><circle cx="324" cy="78" r="6"/><circle cx="311" cy="65" r="6"/><circle cx="337" cy="65" r="6"/></g>
      </svg>`;
    },
  };

  // light sweep across the body: [x, y, w, h, rx, viewBox width]
  const SHEEN = {
    iphonePro: [8, 8, 184, 384, 36, 200], iphoneAir: [8, 8, 184, 384, 36, 200], iphone: [8, 8, 184, 384, 36, 200],
    galaxyUltra: [8, 8, 184, 384, 22, 200], galaxyFold: [8, 8, 184, 384, 20, 200], galaxyFlip: [8, 8, 184, 384, 30, 200],
    pixel: [8, 8, 184, 384, 40, 200], xiaomi: [8, 8, 184, 384, 30, 200],
    tablet: [8, 8, 264, 364, 28, 280], tabletPro: [8, 8, 264, 364, 28, 280],
    laptop: [44, 16, 232, 148, 4, 320], earbuds: [34, 52, 172, 146, 52, 240],
    watchSquare: [27, 61, 106, 138, 32, 160], ps5: [20, 30, 180, 330, 20, 220], switch2: [78, 30, 204, 140, 4, 360],
  };
  function sheen(u, [x, y, w, h, rx, vw]) {
    const delay = (Math.random() * 5).toFixed(2);
    return `<defs>
        <clipPath id="${u}cp"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}"/></clipPath>
        <linearGradient id="${u}sh" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".42"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <g clip-path="url(#${u}cp)" pointer-events="none">
        <rect x="-90" y="${y - 40}" width="${w * 0.35}" height="${h + 80}" fill="url(#${u}sh)" transform="skewX(-16)">
          <animateTransform attributeName="transform" type="translate" additive="sum" values="0 0;${vw + 260} 0;${vw + 260} 0" keyTimes="0;.32;1" dur="6s" begin="${delay}s" repeatCount="indefinite"/>
        </rect>
      </g>`;
  }

  function render(p, colorIdx = 0) {
    const c = p.colors[colorIdx].hex;
    const u = "r" + uidSeed++;
    let svg;
    if (p.kind === "laptop") svg = renders.laptop(c, u, p.wall);
    else if (p.kind === "tablet" || p.kind === "tabletPro") svg = renders.tablet(c, u, p.kind === "tabletPro");
    else svg = renders[p.kind](c, u);
    const sh = SHEEN[p.kind];
    return sh ? svg.replace(/<\/svg>\s*$/, sheen(u, sh) + "</svg>") : svg;
  }

  /* ================= 3D PHONES ================= */
  const D3_RADIUS = { iphonePro: 36, iphoneAir: 36, iphone: 36, galaxyUltra: 22, pixel: 40, xiaomi: 30 };
  const nowTime = () => new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  const nowDate = () => {
    const s = new Date().toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });
    return s[0].toUpperCase() + s.slice(1);
  };
  function screenSvg(p, colorIdx) {
    const c = p.colors[colorIdx].hex;
    const u = "s" + uidSeed++;
    const rx = D3_RADIUS[p.kind];
    const island = p.kind.startsWith("iphone")
      ? `<rect x="72" y="26" width="56" height="16" rx="8" fill="#000"/>`
      : `<circle cx="100" cy="32" r="6" fill="#000"/>`;
    return `<svg viewBox="0 0 200 400">${defs(u, c)}
      <defs>
        <clipPath id="${u}sc"><rect x="16" y="16" width="168" height="368" rx="${rx - 9}"/></clipPath>
        <filter id="${u}bl" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="22"/></filter>
      </defs>
      <rect x="8" y="8" width="184" height="384" rx="${rx}" fill="url(#${u}e)"/>
      <rect x="11" y="11" width="178" height="378" rx="${rx - 3}" fill="#050507"/>
      <g clip-path="url(#${u}sc)">
        <rect x="16" y="16" width="168" height="368" fill="${shade(c, -0.7)}"/>
        <g filter="url(#${u}bl)">
          <circle cx="60" cy="90" r="70" fill="${shade(c, 0.2)}"><animate attributeName="cy" values="90;300;90" dur="14s" repeatCount="indefinite"/></circle>
          <circle cx="150" cy="300" r="80" fill="${c}"><animate attributeName="cx" values="150;50;150" dur="11s" repeatCount="indefinite"/></circle>
          <circle cx="160" cy="120" r="50" fill="#7a5cff" opacity=".7"><animate attributeName="cy" values="120;220;120" dur="9s" repeatCount="indefinite"/></circle>
        </g>
        <text class="d3-date" x="100" y="78" text-anchor="middle" font-family="Onest, sans-serif" font-size="11" fill="#fff" opacity=".85">${nowDate()}</text>
        <text class="d3-time" x="100" y="128" text-anchor="middle" font-family="Onest, sans-serif" font-size="52" font-weight="600" fill="#fff">${nowTime()}</text>
        <rect x="28" y="286" width="68" height="68" rx="18" fill="#fff" fill-opacity=".16"/>
        <rect x="104" y="286" width="68" height="68" rx="18" fill="#fff" fill-opacity=".16"/>
        <rect x="40" y="326" width="44" height="5" rx="2.5" fill="#fff" fill-opacity=".35"/>
        <rect x="40" y="326" width="0" height="5" rx="2.5" fill="#3ccf8a"><animate attributeName="width" values="0;44;44" keyTimes="0;.6;1" dur="4s" repeatCount="indefinite"/></rect>
        <text x="40" y="314" font-family="Onest, sans-serif" font-size="13" font-weight="600" fill="#fff">100%</text>
        <text x="116" y="314" font-family="Onest, sans-serif" font-size="13" font-weight="600" fill="#fff">+14°</text>
        <text x="116" y="334" font-family="Onest, sans-serif" font-size="9" fill="#fff" opacity=".8">Москва</text>
        <rect x="70" y="370" width="60" height="4" rx="2" fill="#fff" opacity=".7"/>
      </g>
      ${island}
      <rect x="11" y="11" width="178" height="378" rx="${rx - 3}" fill="url(#${u}s)" opacity=".5"/>
    </svg>`;
  }
  function device3d(p, colorIdx) {
    const c = p.colors[colorIdx].hex;
    const rx = D3_RADIUS[p.kind];
    const layers = [-5, -3.5, -2, -0.5, 1, 2.5, 4].map((z) => `<i style="--z:${z}px"></i>`).join("");
    return `<div class="d3" style="--r:${(rx / 184) * 100}% / ${(rx / 384) * 100}%;--edge:${shade(c, -0.25)};--edge2:${shade(c, 0.25)}">
      <div class="d3__spin">
        ${layers}
        <div class="d3__face d3__back">${render(p, colorIdx)}</div>
        <div class="d3__face d3__front">${screenSvg(p, colorIdx)}</div>
      </div>
    </div>`;
  }
  // 3D model where we have one, flat render otherwise
  const visual = (p, colorIdx = 0) => (D3_RADIUS[p.kind] ? device3d(p, colorIdx) : render(p, colorIdx));
  setInterval(() => {
    $$(".d3-time").forEach((t) => (t.textContent = nowTime()));
    $$(".d3-date").forEach((t) => (t.textContent = nowDate()));
  }, 15000);

  /* ================= DATA ================= */
  const categories = [
    { id: "all", name: "Все" },
    { id: "phone", name: "Смартфоны" },
    { id: "laptop", name: "Ноутбуки" },
    { id: "tablet", name: "Планшеты" },
    { id: "audio", name: "Аудио" },
    { id: "watch", name: "Часы" },
    { id: "gaming", name: "Игры" },
  ];

  const C = (name, hex) => ({ name, hex });
  const products = [
    { id: "iphone-17-pro", brand: "Apple", name: "iPhone 17 Pro", cat: "phone", kind: "iphonePro", year: 2025, pop: 100, tag: "Новинка",
      colors: [C("Космический оранжевый", "#d9773f"), C("Глубокий синий", "#33415c"), C("Серебристый", "#dcdde0")],
      opts: [["256 ГБ", 119990], ["512 ГБ", 144990], ["1 ТБ", 169990]],
      short: '6,3" · A19 Pro · 3 камеры 48 Мп',
      specs: ['Дисплей 6,3" Super Retina XDR, ProMotion 120 Гц', "Чип A19 Pro", "Три камеры 48 Мп с телеобъективом", "Алюминиевый корпус"] },
    { id: "iphone-17-pro-max", brand: "Apple", name: "iPhone 17 Pro Max", cat: "phone", kind: "iphonePro", year: 2025, pop: 98,
      colors: [C("Космический оранжевый", "#d9773f"), C("Глубокий синий", "#33415c"), C("Серебристый", "#dcdde0")],
      opts: [["256 ГБ", 139990], ["512 ГБ", 164990], ["1 ТБ", 189990], ["2 ТБ", 239990]],
      short: '6,9" · A19 Pro · 3 камеры 48 Мп',
      specs: ['Дисплей 6,9" Super Retina XDR, ProMotion 120 Гц', "Чип A19 Pro", "Три камеры 48 Мп с телеобъективом", "Самая большая батарея среди iPhone"] },
    { id: "iphone-air", brand: "Apple", name: "iPhone Air", cat: "phone", kind: "iphoneAir", year: 2025, pop: 90, tag: "Новинка",
      colors: [C("Небесно-голубой", "#c8d9e8"), C("Светлое золото", "#e9dcc2"), C("Облачно-белый", "#f1f0ec"), C("Космический чёрный", "#2a2a2c")],
      opts: [["256 ГБ", 109990], ["512 ГБ", 129990], ["1 ТБ", 149990]],
      short: '6,5" · A19 Pro · толщина 5,6 мм',
      specs: ['Дисплей 6,5" ProMotion 120 Гц', "Чип A19 Pro", "Титановый корпус толщиной 5,6 мм", "Камера Fusion 48 Мп"] },
    { id: "iphone-17", brand: "Apple", name: "iPhone 17", cat: "phone", kind: "iphone", year: 2025, pop: 96,
      colors: [C("Лавандовый", "#d8cbe8"), C("Шалфей", "#b7c6ac"), C("Туманно-синий", "#9fb4c9"), C("Белый", "#f2f2f0"), C("Чёрный", "#2b2b2d")],
      opts: [["256 ГБ", 84990], ["512 ГБ", 104990]],
      short: '6,3" · A19 · 120 Гц',
      specs: ['Дисплей 6,3" ProMotion 120 Гц', "Чип A19", "Две камеры 48 Мп", "Фронтальная камера Center Stage"] },
    { id: "galaxy-s25-ultra", brand: "Samsung", name: "Galaxy S25 Ultra", cat: "phone", kind: "galaxyUltra", year: 2025, pop: 95, old: 129990, tag: "−19%",
      colors: [C("Titanium Silverblue", "#a9b7c7"), C("Titanium Black", "#2c2d30"), C("Titanium Gray", "#8e8f92"), C("Titanium Whitesilver", "#e5e5e2")],
      opts: [["256 ГБ", 104990], ["512 ГБ", 119990], ["1 ТБ", 144990]],
      short: '6,9" · Snapdragon 8 Elite · 200 Мп',
      specs: ['Дисплей 6,9" Dynamic AMOLED 2X, 120 Гц', "Snapdragon 8 Elite for Galaxy", "Основная камера 200 Мп", "Стилус S Pen в комплекте"] },
    { id: "galaxy-z-fold7", brand: "Samsung", name: "Galaxy Z Fold7", cat: "phone", kind: "galaxyFold", year: 2025, pop: 84,
      colors: [C("Blue Shadow", "#3c4b66"), C("Silver Shadow", "#b9bcc3"), C("Jetblack", "#1d1e21")],
      opts: [["256 ГБ", 179990], ["512 ГБ", 199990]],
      short: '8" складной · 200 Мп',
      specs: ['Внутренний дисплей 8", внешний 6,5"', "Snapdragon 8 Elite for Galaxy", "Основная камера 200 Мп", "Самый тонкий Fold от Samsung"] },
    { id: "galaxy-z-flip7", brand: "Samsung", name: "Galaxy Z Flip7", cat: "phone", kind: "galaxyFlip", year: 2025, pop: 82,
      colors: [C("Coralred", "#e0625b"), C("Blue Shadow", "#3c4b66"), C("Jetblack", "#1d1e21")],
      opts: [["256 ГБ", 109990], ["512 ГБ", 124990]],
      short: '6,9" складной · внешний экран 4,1"',
      specs: ['Внутренний дисплей 6,9", внешний 4,1" на всю крышку', "Exynos 2500", "Камера 50 Мп", "Компактный в сложенном виде"] },
    { id: "pixel-10-pro", brand: "Google", name: "Pixel 10 Pro", cat: "phone", kind: "pixel", year: 2025, pop: 80,
      colors: [C("Obsidian", "#2a2b2e"), C("Moonstone", "#7c8896"), C("Jade", "#c8dbcb"), C("Porcelain", "#ece6dc")],
      opts: [["256 ГБ", 99990], ["512 ГБ", 114990]],
      short: '6,3" · Tensor G5 · 50 Мп',
      specs: ['Дисплей 6,3" Super Actua', "Чип Google Tensor G5", "Три камеры, телеобъектив 5×", "Семь лет обновлений Android"] },
    { id: "xiaomi-15-ultra", brand: "Xiaomi", name: "Xiaomi 15 Ultra", cat: "phone", kind: "xiaomi", year: 2025, pop: 78, old: 119990, tag: "−8%",
      colors: [C("Чёрный", "#232427"), C("Белый", "#efeeea"), C("Серебристый хром", "#c3c5c9")],
      opts: [["512 ГБ", 109990], ["1 ТБ", 129990]],
      short: '6,73" · Snapdragon 8 Elite · Leica',
      specs: ['Дисплей 6,73" AMOLED, 120 Гц', "Snapdragon 8 Elite", "Четыре камеры Leica, сенсор 1 дюйм", "Батарея 5410 мА·ч"] },
    { id: "macbook-air-13-m4", brand: "Apple", name: "MacBook Air 13 M4", cat: "laptop", kind: "laptop", year: 2025, pop: 94,
      colors: [C("Небесно-голубой", "#c5d5e3"), C("Серебристый", "#e2e3e5"), C("Сияющая звезда", "#e5dbca"), C("Полночь", "#2f3743")],
      opts: [["16 ГБ / 256 ГБ", 109990], ["16 ГБ / 512 ГБ", 129990], ["24 ГБ / 512 ГБ", 149990]],
      short: '13,6" · M4 · до 18 часов',
      specs: ['Дисплей Liquid Retina 13,6"', "Чип Apple M4", "До 18 часов работы", "Вес 1,24 кг"] },
    { id: "macbook-pro-14-m5", brand: "Apple", name: "MacBook Pro 14 M5", cat: "laptop", kind: "laptop", year: 2025, pop: 88, tag: "Новинка",
      colors: [C("Чёрный космос", "#2c2c2f"), C("Серебристый", "#e2e3e5")],
      opts: [["16 ГБ / 512 ГБ", 179990], ["16 ГБ / 1 ТБ", 199990], ["24 ГБ / 1 ТБ", 224990]],
      short: '14,2" XDR · M5',
      specs: ['Дисплей Liquid Retina XDR 14,2"', "Чип Apple M5", "До 24 часов работы", "HDMI, SDXC, три Thunderbolt"] },
    { id: "rog-zephyrus-g16", brand: "ASUS", name: "ROG Zephyrus G16", cat: "laptop", kind: "laptop", year: 2025, pop: 74, wall: "#7a3cff",
      colors: [C("Eclipse Gray", "#3a3c41"), C("Platinum White", "#dcdcdc")],
      opts: [["RTX 5070 Ti / 32 ГБ", 219990], ["RTX 5080 / 32 ГБ", 279990]],
      short: '16" OLED 240 Гц · RTX 50',
      specs: ['Дисплей 16" OLED 2,5K, 240 Гц', "Intel Core Ultra 9", "Видеокарта GeForce RTX 50-й серии", "Алюминиевый корпус"] },
    { id: "ipad-pro-11-m5", brand: "Apple", name: "iPad Pro 11 M5", cat: "tablet", kind: "tabletPro", year: 2025, pop: 83, tag: "Новинка",
      colors: [C("Чёрный космос", "#2c2c2f"), C("Серебристый", "#e2e3e5")],
      opts: [["256 ГБ", 109990], ["512 ГБ", 129990], ["1 ТБ", 169990]],
      short: '11" Tandem OLED · M5',
      specs: ['Дисплей Ultra Retina XDR 11"', "Чип Apple M5", "Поддержка Apple Pencil Pro", "Толщина 5,3 мм"] },
    { id: "ipad-air-11-m3", brand: "Apple", name: "iPad Air 11 M3", cat: "tablet", kind: "tablet", year: 2025, pop: 86,
      colors: [C("Серый космос", "#6d6f74"), C("Синий", "#a9bdd1"), C("Фиолетовый", "#c9bedc"), C("Сияющая звезда", "#e5dbca")],
      opts: [["128 ГБ", 64990], ["256 ГБ", 74990], ["512 ГБ", 94990]],
      short: '11" Liquid Retina · M3',
      specs: ['Дисплей Liquid Retina 11"', "Чип Apple M3", "Поддержка Apple Pencil Pro", "Touch ID в кнопке питания"] },
    { id: "airpods-pro-3", brand: "Apple", name: "AirPods Pro 3", cat: "audio", kind: "earbuds", year: 2025, pop: 97, tag: "Хит",
      colors: [C("Белый", "#f4f4f2")],
      opts: [["", 27990]],
      short: "Шумоподавление · пульсометр",
      specs: ["Активное шумоподавление", "Датчик пульса во время тренировок", "Живой перевод", "Защита IP57"] },
    { id: "sony-wh-1000xm6", brand: "Sony", name: "WH-1000XM6", cat: "audio", kind: "headphones", year: 2025, pop: 87, old: 44990, tag: "−11%",
      colors: [C("Чёрный", "#25262a"), C("Платиновый серебристый", "#d8d6d1"), C("Полуночный синий", "#2f3b50")],
      opts: [["", 39990]],
      short: "Шумоподавление · 30 часов",
      specs: ["Процессор шумоподавления QN3", "До 30 часов с шумоподавлением", "12 микрофонов для звонков", "Складная конструкция"] },
    { id: "apple-watch-s11", brand: "Apple", name: "Apple Watch Series 11", cat: "watch", kind: "watchSquare", year: 2025, pop: 89,
      colors: [C("Угольно-чёрный", "#1f1f21"), C("Розовое золото", "#e6c3b3"), C("Серебристый", "#dfe0e2"), C("Серый космос", "#5d6065")],
      opts: [["42 мм", 41990], ["46 мм", 44990]],
      short: "Always-On · ЭКГ · сон",
      specs: ["Дисплей Always-On Retina", "ЭКГ, пульс, оценка сна", "До 24 часов работы", "Защита от воды до 50 м"] },
    { id: "galaxy-watch8", brand: "Samsung", name: "Galaxy Watch8", cat: "watch", kind: "watchRound", year: 2025, pop: 76,
      colors: [C("Graphite", "#3b3c3f"), C("Silver", "#c8c9cc")],
      opts: [["40 мм", 26990], ["44 мм", 29990]],
      short: "AMOLED · индекс антиоксидантов",
      specs: ["Дисплей Super AMOLED", "Мониторинг сна и стресса", "Gemini на запястье", "Защита IP68 и 5ATM"] },
    { id: "ps5-pro", brand: "Sony", name: "PlayStation 5 Pro", cat: "gaming", kind: "ps5", year: 2024, pop: 91,
      colors: [C("Белый", "#f3f3f1")],
      opts: [["2 ТБ", 79990]],
      short: "2 ТБ SSD · PSSR · Wi-Fi 7",
      specs: ["Улучшенный графический процессор", "Масштабирование PSSR", "SSD 2 ТБ", "Wi-Fi 7"] },
    { id: "nintendo-switch-2", brand: "Nintendo", name: "Nintendo Switch 2", cat: "gaming", kind: "switch2", year: 2025, pop: 93, tag: "Хит",
      colors: [C("Тёмно-серый", "#2a2c33")],
      opts: [["256 ГБ", 49990]],
      short: '7,9" 120 Гц · 4K на ТВ',
      specs: ['Экран 7,9" Full HD, 120 Гц', "До 4K при подключении к ТВ", "Магнитные Joy-Con 2", "Память 256 ГБ"] },
  ];
  const byId = Object.fromEntries(products.map((p) => [p.id, p]));
  const DEAL = { id: "macbook-air-13-m4", price: 93490 };
  const optLabel = (p, i) => p.opts[i][0];
  const priceOf = (p, optIdx, deal) => (deal ? DEAL.price : p.opts[optIdx][1]);

  /* ================= STATE ================= */
  let cart = store.get("volta-cart-v2", {});
  const favs = new Set(store.get("volta-favs-v2", []));
  const cardColor = {}; // selected colour per product card
  let filter = "all";
  let brand = "";
  let query = "";
  let sortBy = "popular";

  /* ================= THEME ================= */
  const root = document.documentElement;
  const savedTheme = store.get("volta-theme-v2", null);
  if (savedTheme) root.dataset.theme = savedTheme;
  $("#themeBtn").addEventListener("click", () => {
    const current = root.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = current === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    store.set("volta-theme-v2", next);
  });

  /* ================= HEADER ================= */
  const header = $("#header");
  addEventListener("scroll", () => header.classList.toggle("is-scrolled", scrollY > 8), { passive: true });
  const burger = $("#burger");
  const nav = $("#nav");
  burger.addEventListener("click", () => { burger.classList.toggle("is-open"); nav.classList.toggle("is-open"); });
  $$("#nav a").forEach((a) => a.addEventListener("click", () => { burger.classList.remove("is-open"); nav.classList.remove("is-open"); }));

  const search = $("#search");
  const searchInput = $("#searchInput");
  $("#searchBtn").addEventListener("click", () => {
    search.classList.toggle("is-open");
    if (search.classList.contains("is-open")) setTimeout(() => searchInput.focus(), 150);
  });
  searchInput.addEventListener("input", () => { query = searchInput.value.trim().toLowerCase(); renderProducts(); });
  searchInput.addEventListener("keydown", (e) => { if (e.key === "Enter") scrollToEl($("#catalog")); });

  /* ================= HERO ================= */
  const hero = byId["iphone-17-pro"];
  let heroColor = 0;
  const heroStage = $("#heroStage");
  function paintHero(animate) {
    heroStage.innerHTML = visual(hero, heroColor);
    $("#heroVisual").style.setProperty("--tint", hero.colors[heroColor].hex);
    $("#heroColorName").textContent = hero.colors[heroColor].name;
    if (animate) { heroStage.classList.remove("swap"); void heroStage.offsetWidth; heroStage.classList.add("swap"); }
  }
  $("#heroColors").innerHTML = hero.colors
    .map((c, i) => `<button class="swatch${i === 0 ? " is-active" : ""}" style="--sw:${c.hex}" data-hero-color="${i}" role="radio" aria-checked="${i === 0}" aria-label="${c.name}"></button>`)
    .join("");
  function setHeroColor(i, animate = true) {
    if (i === heroColor) return;
    heroColor = i;
    $$("[data-hero-color]").forEach((s, k) => { s.classList.toggle("is-active", k === i); s.setAttribute("aria-checked", k === i); });
    paintHero(animate);
  }
  $("#heroColors").addEventListener("click", (e) => {
    const b = e.target.closest("[data-hero-color]");
    if (b) setHeroColor(+b.dataset.heroColor);
  });
  $("#heroPrice").textContent = fmt(hero.opts[0][1]);
  $("#heroAdd").addEventListener("click", (e) => addToCart(hero.id, heroColor, 0, false, e.currentTarget));
  $("#heroMore").addEventListener("click", () => openModal(hero.id, heroColor));
  paintHero(false);

  if (finePointer && !reducedMotion) {
    const vis = $("#heroVisual");
    vis.addEventListener("pointermove", (e) => {
      const r = vis.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      heroStage.style.transform = `rotateY(${x * 28}deg) rotateX(${-y * 14}deg)`;
    });
    vis.addEventListener("pointerleave", () => { heroStage.style.transform = ""; });
  }

  /* ================= BRANDS ================= */
  const brandNames = [...new Set(products.map((p) => p.brand))];
  $("#brands").innerHTML = brandNames.map((b) => `<button data-brand="${b}">${b}</button>`).join("");
  $("#brands").addEventListener("click", (e) => {
    const b = e.target.closest("[data-brand]");
    if (!b) return;
    brand = brand === b.dataset.brand ? "" : b.dataset.brand;
    $$("[data-brand]").forEach((x) => x.classList.toggle("is-active", x.dataset.brand === brand));
    renderProducts();
    scrollToEl($("#catalog"));
  });

  /* ================= FILTERS ================= */
  const filtersEl = $("#filters");
  filtersEl.innerHTML = `<span class="filter-pill"></span>` +
    categories.map((c) => `<button class="filter${c.id === "all" ? " is-active" : ""}" data-filter="${c.id}" role="tab">${c.name}</button>`).join("");
  const pill = $(".filter-pill", filtersEl);
  function movePill() {
    const a = $(".filter.is-active", filtersEl);
    if (!a) return;
    Object.assign(pill.style, { left: a.offsetLeft + "px", top: a.offsetTop + "px", width: a.offsetWidth + "px", height: a.offsetHeight + "px" });
  }
  function setFilter(id) {
    filter = id;
    $$(".filter", filtersEl).forEach((b) => b.classList.toggle("is-active", b.dataset.filter === id));
    movePill();
    renderProducts();
  }
  filtersEl.addEventListener("click", (e) => { const b = e.target.closest(".filter"); if (b) setFilter(b.dataset.filter); });
  $$("[data-goto]").forEach((a) => a.addEventListener("click", () => setFilter(a.dataset.goto)));
  addEventListener("resize", movePill);
  document.fonts?.ready.then(movePill);
  requestAnimationFrame(movePill);
  $("#sort").addEventListener("change", (e) => { sortBy = e.target.value; renderProducts(); });

  /* ================= PRODUCTS ================= */
  const productsEl = $("#products");
  const heartSvg = `<svg viewBox="0 0 24 24"><path d="M12 20s-7-4.4-8.7-8.8C2 7.9 4.2 4.5 7.6 4.5c1.9 0 3.3 1 4.4 2.5 1.1-1.5 2.5-2.5 4.4-2.5 3.4 0 5.6 3.4 4.3 6.7C19 15.6 12 20 12 20z"/></svg>`;
  const plusSvg = `<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>`;
  const checkSvg = `<svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg>`;
  const plural = (n, f) => {
    const a = n % 10, b = n % 100;
    return a === 1 && b !== 11 ? f[0] : a >= 2 && a <= 4 && (b < 12 || b > 14) ? f[1] : f[2];
  };

  function renderProducts() {
    let list = products.filter((p) => (filter === "all" || p.cat === filter) && (!brand || p.brand === brand));
    if (query) list = list.filter((p) => `${p.brand} ${p.name} ${p.short}`.toLowerCase().includes(query));
    const sorters = {
      popular: (a, b) => b.pop - a.pop,
      "price-asc": (a, b) => a.opts[0][1] - b.opts[0][1],
      "price-desc": (a, b) => b.opts[0][1] - a.opts[0][1],
      new: (a, b) => b.year - a.year || b.pop - a.pop,
    };
    list.sort(sorters[sortBy]);

    $("#resultInfo").textContent = `${list.length} ${plural(list.length, ["товар", "товара", "товаров"])}` + (brand ? ` · ${brand}` : "");
    $("#empty").hidden = list.length > 0;

    productsEl.innerHTML = list.map((p, i) => {
      const ci = cardColor[p.id] || 0;
      const tagCls = p.tag?.startsWith("−") ? " tag--sale" : p.tag === "Новинка" ? " tag--new" : "";
      return `
      <article class="card" style="--d:${Math.min(i, 8) * 0.04}s;--tint:${p.colors[ci].hex}" data-id="${p.id}">
        ${p.tag ? `<span class="tag${tagCls}">${p.tag}</span>` : ""}
        <button class="fav${favs.has(p.id) ? " is-active" : ""}" data-fav="${p.id}" aria-label="В избранное">${heartSvg}</button>
        <div class="card__media" data-open="${p.id}"><div class="render">${render(p, ci)}</div></div>
        <div class="card__body">
          <div class="card__swatches">${p.colors.length > 1 ? p.colors.map((c, k) =>
            `<button class="swatch swatch--sm${k === ci ? " is-active" : ""}" style="--sw:${c.hex}" data-card-color="${p.id}" data-k="${k}" aria-label="${c.name}" title="${c.name}"></button>`).join("") : ""}</div>
          <span class="card__brand">${p.brand}</span>
          <h3 class="card__title">${p.name}</h3>
          <span class="card__specs">${p.short}</span>
          <div class="card__bottom">
            <div class="price"><strong>${p.opts.length > 1 ? "от " : ""}${fmt(p.opts[0][1])}</strong>${p.old ? `<s>${fmt(p.old)}</s>` : ""}</div>
            <button class="add" data-add="${p.id}" aria-label="Добавить в корзину">${plusSvg}</button>
          </div>
        </div>
      </article>`;
    }).join("");
  }
  renderProducts();

  /* ================= CLICK HANDLING ================= */
  document.addEventListener("click", (e) => {
    const sw = e.target.closest("[data-card-color]");
    if (sw) {
      const id = sw.dataset.cardColor;
      cardColor[id] = +sw.dataset.k;
      const card = sw.closest(".card");
      $$(".swatch", card).forEach((s) => s.classList.toggle("is-active", s === sw));
      const box = $(".render", card);
      box.innerHTML = render(byId[id], cardColor[id]);
      card.style.setProperty("--tint", byId[id].colors[cardColor[id]].hex);
      box.classList.remove("swap"); void box.offsetWidth; box.classList.add("swap");
      return;
    }
    const add = e.target.closest("[data-add]");
    if (add) {
      const id = add.dataset.add;
      if (add.dataset.deal) return addToCart(id, 0, 0, true, add);
      if (add.dataset.modal) return addToCart(id, modalState.color, modalState.opt, false, add);
      return addToCart(id, cardColor[id] || 0, 0, false, add);
    }
    const fav = e.target.closest("[data-fav]");
    if (fav) {
      const id = fav.dataset.fav;
      favs.has(id) ? favs.delete(id) : favs.add(id);
      fav.classList.toggle("is-active", favs.has(id));
      store.set("volta-favs-v2", [...favs]);
      toast(favs.has(id) ? "Добавлено в избранное" : "Удалено из избранного");
      return;
    }
    const open = e.target.closest("[data-open]");
    if (open) openModal(open.dataset.open, cardColor[open.dataset.open] || 0);
  });

  /* ================= CART ================= */
  const cartEl = $("#cart");
  const overlay = $("#overlay");
  const cartBtn = $("#cartBtn");
  const keyOf = (id, c, o, deal) => [id, c, o, deal ? 1 : 0].join("|");
  const parseKey = (k) => { const [id, c, o, d] = k.split("|"); return { id, c: +c, o: +o, deal: d === "1" }; };

  function saveCart() { store.set("volta-cart-v2", cart); renderCart(); }

  function addToCart(id, colorIdx, optIdx, deal, el) {
    const p = byId[id];
    if (!p) return;
    const k = keyOf(id, colorIdx, optIdx, deal);
    cart[k] = (cart[k] || 0) + 1;
    saveCart();
    flyToCart(el);
    toast(`${p.name} — в корзине`);
    if (el?.classList.contains("add")) {
      el.classList.add("is-added");
      el.innerHTML = checkSvg;
      setTimeout(() => { el.classList.remove("is-added"); el.innerHTML = plusSvg; }, 1300);
    }
  }

  function flyToCart(fromEl) {
    if (reducedMotion || !fromEl) return bumpCart();
    const a = fromEl.getBoundingClientRect();
    const b = cartBtn.getBoundingClientRect();
    const dot = document.createElement("span");
    dot.className = "fly";
    document.body.appendChild(dot);
    const sx = a.left + a.width / 2 - 7, sy = a.top + a.height / 2 - 7;
    const ex = b.left + b.width / 2 - 7, ey = b.top + b.height / 2 - 7;
    dot.animate([
      { transform: `translate(${sx}px,${sy}px) scale(1)` },
      { transform: `translate(${(sx + ex) / 2}px,${Math.min(sy, ey) - 90}px) scale(1.2)`, offset: 0.5 },
      { transform: `translate(${ex}px,${ey}px) scale(.4)`, opacity: 0.5 },
    ], { duration: 700, easing: "cubic-bezier(.5,0,.5,1)" }).onfinish = () => { dot.remove(); bumpCart(); };
  }
  function bumpCart() { cartBtn.classList.remove("bump"); void cartBtn.offsetWidth; cartBtn.classList.add("bump"); }

  function renderCart() {
    const keys = Object.keys(cart).filter((k) => byId[parseKey(k).id] && cart[k] > 0);
    let count = 0, total = 0;
    const html = keys.map((k) => {
      const { id, c, o, deal } = parseKey(k);
      const p = byId[id];
      const colour = p.colors[c] || p.colors[0];
      const price = priceOf(p, Math.min(o, p.opts.length - 1), deal);
      count += cart[k];
      total += cart[k] * price;
      const meta = [p.colors.length > 1 ? colour.name : "", optLabel(p, Math.min(o, p.opts.length - 1)), deal ? "по акции" : ""].filter(Boolean).join(" · ");
      return `
        <div class="cart-item">
          <div class="cart-item__img">${render(p, Math.min(c, p.colors.length - 1))}</div>
          <div>
            <b>${p.name}</b>
            <small>${meta}</small>
            <small>${fmt(price)}</small>
            <div class="qty">
              <button data-qty="${k}" data-d="-1" aria-label="Меньше">−</button>
              <span>${cart[k]}</span>
              <button data-qty="${k}" data-d="1" aria-label="Больше">+</button>
            </div>
          </div>
          <button class="remove" data-remove="${k}" aria-label="Удалить">
            <svg viewBox="0 0 24 24"><path d="M5 7h14M10 11v6M14 11v6M7 7l1 12h8l1-12M9 7V4h6v3"/></svg>
          </button>
        </div>`;
    }).join("");
    $("#cartItems").innerHTML = keys.length ? html : `<div class="cart__empty"><p>В корзине пока пусто</p></div>`;
    const countEl = $("#cartCount");
    countEl.textContent = count;
    countEl.classList.toggle("has-items", count > 0);
    $("#cartTotal").textContent = fmt(total);
    $("#checkout").disabled = !keys.length;
  }
  renderCart();

  $("#cartItems").addEventListener("click", (e) => {
    const q = e.target.closest("[data-qty]");
    if (q) {
      const k = q.dataset.qty;
      cart[k] = (cart[k] || 0) + Number(q.dataset.d);
      if (cart[k] <= 0) delete cart[k];
      saveCart();
    }
    const r = e.target.closest("[data-remove]");
    if (r) { delete cart[r.dataset.remove]; saveCart(); }
  });
  const openCart = () => { cartEl.classList.add("is-open"); overlay.classList.add("is-open"); };
  const closeCart = () => { cartEl.classList.remove("is-open"); overlay.classList.remove("is-open"); };
  cartBtn.addEventListener("click", openCart);
  $("#cartClose").addEventListener("click", closeCart);
  overlay.addEventListener("click", closeCart);
  $("#checkout").addEventListener("click", () => {
    cart = {};
    saveCart();
    closeCart();
    toast("Заказ оформлен. Мы позвоним для подтверждения");
  });

  /* ================= PRODUCT MODAL ================= */
  const modal = $("#modal");
  const modalState = { id: null, color: 0, opt: 0 };
  function openModal(id, colorIdx = 0) {
    const p = byId[id];
    if (!p) return;
    Object.assign(modalState, { id, color: colorIdx, opt: 0 });
    $("#modalContent").innerHTML = `
      <div class="modal__media"><div class="render" id="modalRender">${visual(p, colorIdx)}</div></div>
      <div class="modal__info">
        <span class="card__brand">${p.brand}</span>
        <h3>${p.name}</h3>
        ${p.colors.length > 1 ? `
          <div class="modal__label">Цвет: <b id="modalColorName">${p.colors[colorIdx].name}</b></div>
          <div class="modal__swatches">${p.colors.map((c, k) =>
            `<button class="swatch${k === colorIdx ? " is-active" : ""}" style="--sw:${c.hex}" data-m-color="${k}" aria-label="${c.name}"></button>`).join("")}</div>` : ""}
        ${p.opts.length > 1 ? `
          <div class="modal__label">Конфигурация</div>
          <div class="options">${p.opts.map((o, k) => `<button class="${k === 0 ? "is-active" : ""}" data-m-opt="${k}">${o[0]}</button>`).join("")}</div>` : ""}
        <ul class="spec-list">${p.specs.map((s) => `<li>${s}</li>`).join("")}</ul>
        <div class="price price--lg"><strong id="modalPrice">${fmt(p.opts[0][1])}</strong>${p.old ? `<s>${fmt(p.old)}</s>` : ""}</div>
        <button class="btn btn--primary" data-add="${p.id}" data-modal="1">Добавить в корзину</button>
      </div>`;
    modal.classList.add("is-open");
    if (finePointer && !reducedMotion) {
      const media = $(".modal__media", modal);
      const r3d = $("#modalRender");
      media.addEventListener("pointermove", (e) => {
        const r = media.getBoundingClientRect();
        r3d.style.transform = `rotateY(${((e.clientX - r.left) / r.width - 0.5) * 30}deg) rotateX(${-((e.clientY - r.top) / r.height - 0.5) * 14}deg)`;
      });
      media.addEventListener("pointerleave", () => { r3d.style.transform = ""; });
    }
  }
  const closeModal = () => modal.classList.remove("is-open");
  $("#modalClose").addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) return closeModal();
    const p = byId[modalState.id];
    const mc = e.target.closest("[data-m-color]");
    if (mc) {
      modalState.color = +mc.dataset.mColor;
      $$("[data-m-color]", modal).forEach((s) => s.classList.toggle("is-active", s === mc));
      $("#modalColorName").textContent = p.colors[modalState.color].name;
      const box = $("#modalRender");
      box.innerHTML = visual(p, modalState.color);
      box.classList.remove("swap"); void box.offsetWidth; box.classList.add("swap");
    }
    const mo = e.target.closest("[data-m-opt]");
    if (mo) {
      modalState.opt = +mo.dataset.mOpt;
      $$("[data-m-opt]", modal).forEach((s) => s.classList.toggle("is-active", s === mo));
      $("#modalPrice").textContent = fmt(p.opts[modalState.opt][1]);
    }
  });
  addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeModal(); closeCart(); search.classList.remove("is-open"); }
  });

  /* ================= DEAL ================= */
  $("#dealVisual").innerHTML = render(byId[DEAL.id], 0);
  const dealKey = "volta-deal-end-v2";
  let dealEnd = store.get(dealKey, 0);
  if (!dealEnd || dealEnd < Date.now()) {
    dealEnd = Date.now() + ((2 * 24 + 9) * 3600 + 25 * 60) * 1000;
    store.set(dealKey, dealEnd);
  }
  const units = Object.fromEntries($$("#countdown b").map((b) => [b.dataset.unit, b]));
  const pad = (n) => String(n).padStart(2, "0");
  function tickCountdown() {
    const s = Math.max(0, dealEnd - Date.now()) / 1000;
    const vals = { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: Math.floor(s % 60) };
    for (const k in vals) {
      const v = pad(vals[k]);
      if (units[k].textContent !== v) {
        units[k].textContent = v;
        units[k].classList.remove("tick"); void units[k].offsetWidth; units[k].classList.add("tick");
      }
    }
  }
  tickCountdown();
  setInterval(tickCountdown, 1000);

  /* ================= SHOWCASE ================= */
  const showcase = [
    ["iphone-17-pro-max", 0, "Камерофон года"],
    ["galaxy-s25-ultra", 0, "Android-флагман"],
    ["macbook-pro-14-m5", 0, "Для работы"],
    ["galaxy-z-flip7", 0, "Складной"],
    ["pixel-10-pro", 2, "Чистый Android"],
    ["sony-wh-1000xm6", 0, "Тишина"],
  ];
  $("#showcaseTrack").innerHTML = showcase.map(([id, ci, label]) => {
    const p = byId[id];
    return `
      <article class="slide" style="--tint:${p.colors[ci].hex}">
        <div class="slide__media" data-open="${id}"><div class="slide__render${p.kind === "laptop" || p.kind === "headphones" ? " slide__render--wide" : ""}">${visual(p, ci)}</div></div>
        <div class="slide__info">
          <span class="slide__label">${label}</span>
          <h3>${p.name}</h3>
          <p class="muted">${p.short}</p>
          <div class="slide__buy">
            <span class="price"><strong>${p.opts.length > 1 ? "от " : ""}${fmt(p.opts[0][1])}</strong></span>
            <button class="btn btn--primary" data-add="${id}">В корзину</button>
          </div>
        </div>
      </article>`;
  }).join("");

  window.VOLTA = { setHeroColor, heroColorCount: hero.colors.length };

  /* ================= SCROLL REVEAL ================= */
  $$(".section__head, .deal, .service__item, .newsletter").forEach((el) => el.classList.add("reveal"));

  /* ================= NEWSLETTER / TOAST ================= */
  $("#newsletter").addEventListener("submit", (e) => {
    e.preventDefault();
    e.target.reset();
    toast("Готово. Промокод VOLTA10 придёт на почту");
  });
  const toastEl = $("#toast");
  let toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("is-visible"), 2400);
  }

  $("#year").textContent = new Date().getFullYear();
})();
