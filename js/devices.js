/* Device renders: hand-drawn SVG models recoloured per product colour. */
(() => {
  "use strict";

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
      <circle cx="${x - r * 0.22}" cy="${y - r * 0.26}" r="${r * 0.14}" fill="#fff" opacity=".55"/>
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

  // фото товара: строка — одно фото на все цвета, массив — фото по индексу цвета
  function photoFor(p, colorIdx) {
    if (!p.photo) return null;
    return Array.isArray(p.photo) ? p.photo[colorIdx] || p.photo[0] : p.photo;
  }

  function render(p, colorIdx = 0, withSheen = false) {
    const src = photoFor(p, colorIdx);
    if (src) {
      const alt = p.colors.length > 1 ? `${p.name}, ${p.colors[colorIdx].name.toLowerCase()}` : p.name;
      return `<img class="photo" src="${src}" alt="${alt}" loading="lazy" decoding="async">`;
    }
    const c = p.colors[colorIdx].hex;
    const u = "r" + uidSeed++;
    let svg;
    if (p.kind === "laptop") svg = renders.laptop(c, u, p.wall);
    else if (p.kind === "tablet" || p.kind === "tabletPro") svg = renders.tablet(c, u, p.kind === "tabletPro");
    else svg = renders[p.kind](c, u);
    const sh = SHEEN[p.kind];
    return sh && withSheen ? svg.replace(/<\/svg>\s*$/, sheen(u, sh) + "</svg>") : svg;
  }

  window.VoltaDevices = { render, shade, isLight };
})();
