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

  /* ================= DEVICE ILLUSTRATIONS (SVG) ================= */
  const art = {
    phone: (c) => `
      <svg viewBox="0 0 120 200" style="stroke:none">
        <defs><linearGradient id="g-${c.id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c.a}"/><stop offset="1" stop-color="${c.b}"/></linearGradient></defs>
        <rect x="14" y="4" width="92" height="192" rx="20" fill="#1b1b24"/>
        <rect x="18" y="8" width="84" height="184" rx="17" fill="url(#g-${c.id})"/>
        <rect x="46" y="14" width="28" height="8" rx="4" fill="#0a0a10"/>
        <circle cx="60" cy="110" r="26" fill="rgba(255,255,255,.18)"/>
        <rect x="30" y="160" width="60" height="16" rx="8" fill="rgba(255,255,255,.22)"/>
      </svg>`,
    laptop: (c) => `
      <svg viewBox="0 0 220 150" style="stroke:none">
        <defs><linearGradient id="g-${c.id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c.a}"/><stop offset="1" stop-color="${c.b}"/></linearGradient></defs>
        <rect x="30" y="8" width="160" height="108" rx="10" fill="#1b1b24"/>
        <rect x="36" y="14" width="148" height="96" rx="5" fill="url(#g-${c.id})"/>
        <rect x="46" y="24" width="56" height="76" rx="6" fill="rgba(255,255,255,.18)"/>
        <rect x="110" y="24" width="64" height="34" rx="6" fill="rgba(255,255,255,.14)"/>
        <rect x="110" y="66" width="64" height="34" rx="6" fill="rgba(255,255,255,.22)"/>
        <path d="M8 120h204l-10 16H18z" fill="#c9c9d6"/>
        <rect x="92" y="120" width="36" height="5" rx="2.5" fill="#8d8da3"/>
      </svg>`,
    tablet: (c) => `
      <svg viewBox="0 0 170 210" style="stroke:none">
        <defs><linearGradient id="g-${c.id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c.a}"/><stop offset="1" stop-color="${c.b}"/></linearGradient></defs>
        <rect x="8" y="6" width="154" height="198" rx="18" fill="#1b1b24"/>
        <rect x="15" y="13" width="140" height="184" rx="12" fill="url(#g-${c.id})"/>
        <g fill="rgba(255,255,255,.22)">
          <rect x="28" y="30" width="26" height="26" rx="7"/><rect x="62" y="30" width="26" height="26" rx="7"/><rect x="96" y="30" width="26" height="26" rx="7"/>
          <rect x="28" y="64" width="26" height="26" rx="7"/><rect x="62" y="64" width="26" height="26" rx="7"/>
          <rect x="28" y="150" width="114" height="30" rx="10"/>
        </g>
      </svg>`,
    headphones: (c) => `
      <svg viewBox="0 0 200 200" style="stroke:none">
        <defs><linearGradient id="g-${c.id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c.a}"/><stop offset="1" stop-color="${c.b}"/></linearGradient></defs>
        <path d="M30 120V95a70 70 0 0 1 140 0v25" fill="none" stroke="#2a2a36" stroke-width="16" stroke-linecap="round"/>
        <path d="M30 120V95a70 70 0 0 1 140 0v25" fill="none" stroke="url(#g-${c.id})" stroke-width="8" stroke-linecap="round"/>
        <rect x="14" y="106" width="46" height="74" rx="20" fill="url(#g-${c.id})"/>
        <rect x="140" y="106" width="46" height="74" rx="20" fill="url(#g-${c.id})"/>
        <rect x="24" y="118" width="26" height="50" rx="12" fill="rgba(0,0,0,.25)"/>
        <rect x="150" y="118" width="26" height="50" rx="12" fill="rgba(0,0,0,.25)"/>
      </svg>`,
    watch: (c) => `
      <svg viewBox="0 0 140 210" style="stroke:none">
        <defs><linearGradient id="g-${c.id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c.a}"/><stop offset="1" stop-color="${c.b}"/></linearGradient></defs>
        <rect x="38" y="2" width="64" height="70" rx="16" fill="url(#g-${c.id})" opacity=".8"/>
        <rect x="38" y="138" width="64" height="70" rx="16" fill="url(#g-${c.id})" opacity=".8"/>
        <rect x="22" y="50" width="96" height="110" rx="28" fill="#1b1b24"/>
        <rect x="30" y="58" width="80" height="94" rx="22" fill="#05050a"/>
        <circle cx="70" cy="105" r="30" fill="none" stroke="url(#g-${c.id})" stroke-width="7" stroke-dasharray="140 200" stroke-linecap="round"/>
        <circle cx="70" cy="105" r="18" fill="none" stroke="${c.b}" stroke-width="5" stroke-dasharray="70 200" stroke-linecap="round" opacity=".8"/>
        <rect x="118" y="88" width="8" height="22" rx="4" fill="#3a3a48"/>
      </svg>`,
    gaming: (c) => `
      <svg viewBox="0 0 220 150" style="stroke:none">
        <defs><linearGradient id="g-${c.id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c.a}"/><stop offset="1" stop-color="${c.b}"/></linearGradient></defs>
        <path d="M60 30h100c30 0 46 30 52 70 4 26-18 40-34 26l-22-20H64l-22 20c-16 14-38 0-34-26 6-40 22-70 52-70z" fill="url(#g-${c.id})"/>
        <g fill="rgba(0,0,0,.3)"><rect x="46" y="62" width="34" height="10" rx="4"/><rect x="58" y="50" width="10" height="34" rx="4"/></g>
        <g fill="rgba(255,255,255,.75)"><circle cx="160" cy="56" r="7"/><circle cx="176" cy="70" r="7"/><circle cx="144" cy="70" r="7"/><circle cx="160" cy="84" r="7"/></g>
        <circle cx="90" cy="94" r="12" fill="rgba(0,0,0,.3)"/><circle cx="130" cy="94" r="12" fill="rgba(0,0,0,.3)"/>
      </svg>`,
  };

  /* ================= DATA ================= */
  const categories = [
    { id: "phone", name: "Смартфоны", color: "#7c5cff", a: "#7c5cff", b: "#00d4ff" },
    { id: "laptop", name: "Ноутбуки", color: "#00d4ff", a: "#00d4ff", b: "#2ee59d" },
    { id: "tablet", name: "Планшеты", color: "#ff4fd8", a: "#ff4fd8", b: "#7c5cff" },
    { id: "headphones", name: "Аудио", color: "#ffb347", a: "#ffb347", b: "#ff4fd8" },
    { id: "watch", name: "Часы", color: "#2ee59d", a: "#2ee59d", b: "#00d4ff" },
    { id: "gaming", name: "Игры", color: "#ff5e7e", a: "#ff5e7e", b: "#ffb347" },
  ];

  const products = [
    { id: "nova-x-pro", type: "phone", brand: "Nova", name: "Nova X Pro 256 ГБ", specs: '6.7" OLED · 200 Мп · 5000 мА·ч', price: 109990, old: 124990, rating: 4.9, reviews: 1284, tag: "Хит", a: "#7c5cff", b: "#00d4ff", pop: 99 },
    { id: "pixelon-9", type: "phone", brand: "Pixelon", name: "Pixelon 9 128 ГБ", specs: '6.3" OLED · ИИ-камера · 120 Гц', price: 74990, rating: 4.8, reviews: 842, tag: "Новинка", a: "#2ee59d", b: "#00d4ff", pop: 92 },
    { id: "aura-lite", type: "phone", brand: "Aura", name: "Aura Lite 5G", specs: '6.5" AMOLED · 108 Мп · NFC', price: 32990, old: 37990, rating: 4.6, reviews: 2140, a: "#ff4fd8", b: "#ffb347", pop: 88 },
    { id: "zentrix-book-pro", type: "laptop", brand: "Zentrix", name: "Zentrix Book Pro 16", specs: '16" 3.2K 120 Гц · 32 ГБ · 1 ТБ', price: 149990, old: 199990, rating: 4.9, reviews: 512, tag: "−25%", a: "#00d4ff", b: "#7c5cff", pop: 97 },
    { id: "quanta-air", type: "laptop", brand: "Quanta", name: "Quanta Air 14", specs: '14" 2.8K · 16 ГБ · 512 ГБ · 1.2 кг', price: 89990, rating: 4.7, reviews: 391, a: "#c9c9d6", b: "#7c5cff", pop: 85 },
    { id: "vertex-gamer", type: "laptop", brand: "Vertex", name: "Vertex Strike 17", specs: '17" 240 Гц · RTX · 32 ГБ', price: 179990, rating: 4.8, reviews: 276, tag: "Новинка", a: "#ff5e7e", b: "#7c5cff", pop: 80 },
    { id: "lumen-tab", type: "tablet", brand: "Lumen", name: "Lumen Tab 12", specs: '12.4" OLED · стилус в комплекте', price: 59990, old: 69990, rating: 4.7, reviews: 604, a: "#ff4fd8", b: "#7c5cff", pop: 83 },
    { id: "lumen-tab-mini", type: "tablet", brand: "Lumen", name: "Lumen Tab Mini", specs: '8.7" · 128 ГБ · Wi-Fi', price: 27990, rating: 4.5, reviews: 330, a: "#00d4ff", b: "#2ee59d", pop: 70 },
    { id: "orbita-max", type: "headphones", brand: "Orbita", name: "Orbita Max ANC", specs: "Шумоподавление · 40 ч · Hi-Res", price: 24990, old: 29990, rating: 4.9, reviews: 1890, tag: "Хит", a: "#ffb347", b: "#ff4fd8", pop: 95 },
    { id: "orbita-studio", type: "headphones", brand: "Orbita", name: "Orbita Studio", specs: "Проводные · 50 мм · студийный звук", price: 14990, rating: 4.6, reviews: 412, a: "#7c5cff", b: "#2ee59d", pop: 66 },
    { id: "nova-watch-4", type: "watch", brand: "Nova", name: "Nova Watch 4", specs: "AMOLED · ЭКГ · GPS · 7 дней", price: 29990, rating: 4.8, reviews: 978, tag: "Новинка", a: "#2ee59d", b: "#00d4ff", pop: 90 },
    { id: "aura-band", type: "watch", brand: "Aura", name: "Aura Band 8", specs: "Фитнес-браслет · SpO₂ · 14 дней", price: 4990, old: 5990, rating: 4.5, reviews: 3520, a: "#ff4fd8", b: "#ff5e7e", pop: 86 },
    { id: "vertex-pad", type: "gaming", brand: "Vertex", name: "Vertex Pad Elite", specs: "Беспроводной · haptic · 30 ч", price: 8990, rating: 4.7, reviews: 760, a: "#ff5e7e", b: "#ffb347", pop: 78 },
    { id: "quanta-console", type: "gaming", brand: "Quanta", name: "Quanta Play X", specs: "4K 120 FPS · 1 ТБ SSD", price: 54990, old: 59990, rating: 4.9, reviews: 1420, tag: "Хит", a: "#7c5cff", b: "#ff5e7e", pop: 93 },
  ];
  const byId = Object.fromEntries(products.map((p) => [p.id, p]));

  const reviews = [
    { name: "Анна К.", city: "Москва", text: "Заказала смартфон вечером — утром уже был у меня. Всё оригинальное, упаковка идеальная." },
    { name: "Дмитрий С.", city: "Санкт-Петербург", text: "Взял ноутбук в рассрочку, оформление заняло 5 минут. Цены ниже, чем у конкурентов." },
    { name: "Мария Л.", city: "Казань", text: "Консультант помог выбрать наушники под мои задачи. Звук — космос, спасибо!" },
    { name: "Игорь П.", city: "Екатеринбург", text: "Сдал старый телефон по trade-in и получил хорошую скидку на новый. Очень удобно." },
    { name: "Елена В.", city: "Новосибирск", text: "Красивый и удобный сайт, быстрая доставка. Буду заказывать ещё." },
    { name: "Артём Р.", city: "Краснодар", text: "Купил приставку к дню рождения сына — привезли за 2 часа, курьер вежливый." },
  ];

  /* ================= STATE ================= */
  let cart = store.get("volta-cart", {});
  let favs = new Set(store.get("volta-favs", []));
  let filter = "all";
  let query = "";
  let sortBy = "popular";

  /* ================= THEME ================= */
  const root = document.documentElement;
  const savedTheme = store.get("volta-theme", null);
  if (savedTheme) root.dataset.theme = savedTheme;
  $("#themeBtn").addEventListener("click", () => {
    const next = root.dataset.theme === "light" ? "dark" : "light";
    root.dataset.theme = next;
    store.set("volta-theme", next);
  });

  /* ================= HEADER / NAV ================= */
  const header = $("#header");
  const progress = $(".progress");
  const onScroll = () => {
    const y = scrollY;
    header.classList.toggle("is-scrolled", y > 20);
    const max = document.documentElement.scrollHeight - innerHeight;
    progress.style.transform = `scaleX(${max > 0 ? y / max : 0})`;
  };
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  const burger = $("#burger");
  const nav = $("#nav");
  burger.addEventListener("click", () => {
    burger.classList.toggle("is-open");
    nav.classList.toggle("is-open");
  });
  $$("#nav a").forEach((a) => a.addEventListener("click", () => {
    burger.classList.remove("is-open");
    nav.classList.remove("is-open");
  }));

  const search = $("#search");
  const searchInput = $("#searchInput");
  $("#searchBtn").addEventListener("click", () => {
    search.classList.toggle("is-open");
    if (search.classList.contains("is-open")) setTimeout(() => searchInput.focus(), 200);
  });
  searchInput.addEventListener("input", () => {
    query = searchInput.value.trim().toLowerCase();
    renderProducts();
  });
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("#catalog").scrollIntoView({ behavior: "smooth" });
  });

  /* ================= CATEGORIES ================= */
  const catWrap = $("#categoryCards");
  catWrap.innerHTML = categories.map((c, i) => {
    const count = products.filter((p) => p.type === c.id).length;
    return `
      <a href="#catalog" class="category reveal" style="--c:${c.color};--d:${i * 0.07}s" data-cat="${c.id}">
        <div class="category__icon">${art[c.id]({ id: "cat-" + c.id, a: c.a, b: c.b })}</div>
        <h3>${c.name}</h3>
        <small>${count} ${plural(count, ["товар", "товара", "товаров"])}</small>
      </a>`;
  }).join("");
  $$(".category").forEach((el) => el.addEventListener("click", () => setFilter(el.dataset.cat)));

  function plural(n, forms) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return forms[0];
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return forms[1];
    return forms[2];
  }

  /* ================= FILTERS ================= */
  const filtersEl = $("#filters");
  filtersEl.innerHTML =
    `<span class="filter-pill"></span>` +
    [{ id: "all", name: "Все" }, ...categories]
      .map((c) => `<button class="filter${c.id === "all" ? " is-active" : ""}" data-filter="${c.id}" role="tab">${c.name}</button>`)
      .join("");
  const pill = $(".filter-pill", filtersEl);

  function movePill() {
    const active = $(".filter.is-active", filtersEl);
    if (!active) return;
    pill.style.left = active.offsetLeft + "px";
    pill.style.top = active.offsetTop + "px";
    pill.style.width = active.offsetWidth + "px";
    pill.style.height = active.offsetHeight + "px";
  }
  function setFilter(id) {
    filter = id;
    $$(".filter", filtersEl).forEach((b) => b.classList.toggle("is-active", b.dataset.filter === id));
    movePill();
    renderProducts();
  }
  filtersEl.addEventListener("click", (e) => {
    const b = e.target.closest(".filter");
    if (b) setFilter(b.dataset.filter);
  });
  addEventListener("resize", movePill);
  document.fonts?.ready.then(movePill);
  requestAnimationFrame(movePill);

  $("#sort").addEventListener("change", (e) => {
    sortBy = e.target.value;
    renderProducts();
  });

  /* ================= PRODUCTS ================= */
  const productsEl = $("#products");
  const heartSvg = `<svg viewBox="0 0 24 24"><path d="M12 21s-7.5-4.6-9.5-9.3C1 8 3.4 4 7.2 4c2 0 3.6 1.1 4.8 2.8C13.2 5.1 14.8 4 16.8 4 20.6 4 23 8 21.5 11.7 19.5 16.4 12 21 12 21z"/></svg>`;
  const plusSvg = `<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>`;
  const checkSvg = `<svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg>`;

  function renderProducts() {
    let list = products.filter((p) => filter === "all" || p.type === filter);
    if (query) list = list.filter((p) => `${p.brand} ${p.name} ${p.specs} ${categories.find((c) => c.id === p.type).name}`.toLowerCase().includes(query));
    const sorters = {
      popular: (a, b) => b.pop - a.pop,
      "price-asc": (a, b) => a.price - b.price,
      "price-desc": (a, b) => b.price - a.price,
      rating: (a, b) => b.rating - a.rating,
    };
    list.sort(sorters[sortBy]);

    $("#resultInfo").textContent = `Найдено: ${list.length} ${plural(list.length, ["товар", "товара", "товаров"])}`;
    $("#empty").hidden = list.length > 0;

    productsEl.innerHTML = list.map((p, i) => `
      <article class="card" style="--c:${p.a};--d:${Math.min(i, 8) * 0.06}s" data-id="${p.id}">
        ${p.tag ? `<span class="card__tag${p.tag === "Новинка" ? " card__tag--new" : ""}">${p.tag}</span>` : ""}
        <button class="card__fav${favs.has(p.id) ? " is-active" : ""}" data-fav="${p.id}" aria-label="В избранное">${heartSvg}</button>
        <div class="card__media" data-quick="${p.id}">${art[p.type](p)}</div>
        <div class="card__body">
          <span class="card__brand">${p.brand}</span>
          <h3 class="card__title">${p.name}</h3>
          <span class="card__specs">${p.specs}</span>
          <span class="card__rating"><b>★ ${p.rating}</b> · ${p.reviews.toLocaleString("ru-RU")} отзывов</span>
          <div class="card__bottom">
            <div class="price"><strong>${fmt(p.price)}</strong>${p.old ? `<s>${fmt(p.old)}</s>` : ""}</div>
            <button class="add-btn" data-add="${p.id}" aria-label="Добавить в корзину">${plusSvg}</button>
          </div>
        </div>
      </article>`).join("");
  }
  renderProducts();

  // spotlight that follows the cursor on cards
  productsEl.addEventListener("pointermove", (e) => {
    const card = e.target.closest(".card");
    if (!card) return;
    const r = card.getBoundingClientRect();
    card.style.setProperty("--mx", e.clientX - r.left + "px");
    card.style.setProperty("--my", e.clientY - r.top + "px");
  });

  /* ================= GLOBAL CLICK HANDLING ================= */
  document.addEventListener("click", (e) => {
    const add = e.target.closest("[data-add]");
    if (add) {
      addToCart(add.dataset.add, add);
      return;
    }
    const fav = e.target.closest("[data-fav]");
    if (fav) {
      const id = fav.dataset.fav;
      favs.has(id) ? favs.delete(id) : favs.add(id);
      fav.classList.toggle("is-active", favs.has(id));
      store.set("volta-favs", [...favs]);
      toast(favs.has(id) ? "❤️ Добавлено в избранное" : "Удалено из избранного");
      return;
    }
    const quick = e.target.closest("[data-quick]");
    if (quick) openModal(quick.dataset.quick);
  });

  /* ================= CART ================= */
  const cartEl = $("#cart");
  const overlay = $("#overlay");
  const cartBtn = $("#cartBtn");

  function saveCart() {
    store.set("volta-cart", cart);
    renderCart();
  }

  function addToCart(id, sourceEl) {
    if (!byId[id]) return;
    cart[id] = (cart[id] || 0) + 1;
    saveCart();
    flyToCart(sourceEl);
    toast(`🛒 ${byId[id].name} в корзине`);
    if (sourceEl.classList.contains("add-btn")) {
      sourceEl.classList.add("is-added");
      sourceEl.innerHTML = checkSvg;
      setTimeout(() => {
        sourceEl.classList.remove("is-added");
        sourceEl.innerHTML = plusSvg;
      }, 1400);
    }
  }

  function flyToCart(fromEl) {
    if (reducedMotion || !fromEl) return bumpCart();
    const from = fromEl.getBoundingClientRect();
    const to = cartBtn.getBoundingClientRect();
    const dot = document.createElement("span");
    dot.className = "fly";
    document.body.appendChild(dot);
    const sx = from.left + from.width / 2 - 11, sy = from.top + from.height / 2 - 11;
    const ex = to.left + to.width / 2 - 11, ey = to.top + to.height / 2 - 11;
    dot.animate(
      [
        { transform: `translate(${sx}px, ${sy}px) scale(1)`, opacity: 1 },
        { transform: `translate(${(sx + ex) / 2}px, ${Math.min(sy, ey) - 120}px) scale(1.3)`, opacity: 1, offset: 0.5 },
        { transform: `translate(${ex}px, ${ey}px) scale(0.3)`, opacity: 0.4 },
      ],
      { duration: 800, easing: "cubic-bezier(.5,0,.5,1)" }
    ).onfinish = () => {
      dot.remove();
      bumpCart();
    };
  }
  function bumpCart() {
    cartBtn.classList.remove("bump");
    void cartBtn.offsetWidth;
    cartBtn.classList.add("bump");
  }

  function renderCart() {
    const ids = Object.keys(cart).filter((id) => byId[id] && cart[id] > 0);
    const count = ids.reduce((s, id) => s + cart[id], 0);
    const total = ids.reduce((s, id) => s + cart[id] * byId[id].price, 0);
    const countEl = $("#cartCount");
    countEl.textContent = count;
    countEl.classList.toggle("has-items", count > 0);
    $("#cartTotal").textContent = fmt(total);

    $("#cartItems").innerHTML = ids.length
      ? ids.map((id) => {
          const p = byId[id];
          return `
            <div class="cart-item">
              <div class="cart-item__img">${art[p.type]({ ...p, id: "c-" + p.id })}</div>
              <div>
                <b>${p.name}</b>
                <small>${fmt(p.price)}</small>
                <div class="qty">
                  <button data-qty="${id}" data-d="-1" aria-label="Меньше">−</button>
                  <span>${cart[id]}</span>
                  <button data-qty="${id}" data-d="1" aria-label="Больше">+</button>
                </div>
              </div>
              <button class="remove" data-remove="${id}" aria-label="Удалить">
                <svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>
              </button>
            </div>`;
        }).join("")
      : `<div class="cart__empty"><div>🛍️</div><p>Корзина пока пуста</p></div>`;
    $("#checkout").disabled = !ids.length;
    $("#checkout").style.opacity = ids.length ? 1 : 0.5;
  }
  renderCart();

  $("#cartItems").addEventListener("click", (e) => {
    const q = e.target.closest("[data-qty]");
    if (q) {
      cart[q.dataset.qty] = Math.max(0, (cart[q.dataset.qty] || 0) + Number(q.dataset.d));
      if (!cart[q.dataset.qty]) delete cart[q.dataset.qty];
      saveCart();
    }
    const r = e.target.closest("[data-remove]");
    if (r) {
      delete cart[r.dataset.remove];
      saveCart();
    }
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
    toast("🎉 Спасибо! Заказ оформлен — мы скоро свяжемся с вами");
    confetti();
  });

  /* ================= QUICK VIEW MODAL ================= */
  const modal = $("#modal");
  function openModal(id) {
    const p = byId[id];
    if (!p) return;
    const swatches = [p.a, p.b, "#1b1b24", "#e8e8f0"];
    $("#modalContent").innerHTML = `
      <div class="modal__media" style="--c:${p.a}">${art[p.type]({ ...p, id: "m-" + p.id })}</div>
      <div class="modal__info">
        <span class="card__brand">${p.brand}</span>
        <h3>${p.name}</h3>
        <span class="card__rating"><b>★ ${p.rating}</b> · ${p.reviews.toLocaleString("ru-RU")} отзывов</span>
        <ul>
          ${p.specs.split(" · ").map((s) => `<li>${s}</li>`).join("")}
          <li>Официальная гарантия 1 год</li>
          <li>Бесплатная доставка за 2 часа</li>
        </ul>
        <div class="colors">${swatches.map((s, i) => `<button style="--sw:${s}" class="${i === 0 ? "is-active" : ""}" aria-label="Цвет"></button>`).join("")}</div>
        <div class="price"><strong>${fmt(p.price)}</strong>${p.old ? `<s>${fmt(p.old)}</s>` : ""}</div>
        <button class="btn btn--primary" data-add="${p.id}">Добавить в корзину</button>
      </div>`;
    modal.classList.add("is-open");
  }
  const closeModal = () => modal.classList.remove("is-open");
  $("#modalClose").addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
    const sw = e.target.closest(".colors button");
    if (sw) $$(".colors button", modal).forEach((b) => b.classList.toggle("is-active", b === sw));
  });
  addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeModal(); closeCart(); search.classList.remove("is-open"); }
  });

  /* ================= REVIEWS ================= */
  const reviewHtml = reviews.map((r) => `
    <div class="review">
      <div class="review__stars">★★★★★</div>
      <p>«${r.text}»</p>
      <div class="review__author">
        <span class="review__avatar">${r.name[0]}</span>
        <div><b>${r.name}</b><small>${r.city}</small></div>
      </div>
    </div>`).join("");
  $("#reviewsTrack").innerHTML = reviewHtml + reviewHtml;

  /* ================= REVEAL ON SCROLL ================= */
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      en.target.classList.add("is-visible");
      io.unobserve(en.target);
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
  $$(".reveal").forEach((el, i) => {
    if (!el.style.getPropertyValue("--d") && el.parentElement.classList.contains("features")) {
      el.style.setProperty("--d", (i % 4) * 0.1 + "s");
    }
    io.observe(el);
  });
  // hero elements stagger
  $$(".hero .reveal").forEach((el, i) => el.style.setProperty("--d", i * 0.12 + "s"));

  /* ================= COUNTERS ================= */
  const countIo = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      const el = en.target;
      const target = +el.dataset.count;
      const suffix = el.dataset.suffix || "+";
      const start = performance.now();
      const dur = 2000;
      const step = (t) => {
        const k = Math.min(1, (t - start) / dur);
        const eased = 1 - Math.pow(1 - k, 4);
        el.textContent = Math.round(target * eased).toLocaleString("ru-RU") + suffix;
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
      countIo.unobserve(el);
    });
  }, { threshold: 0.5 });
  $$("[data-count]").forEach((el) => countIo.observe(el));

  /* ================= TYPED WORDS ================= */
  const typed = $("#typed");
  const words = ["вдохновляет", "удивляет", "работает на вас", "меняет всё"];
  let wi = 0, ci = words[0].length, deleting = true;
  function typeLoop() {
    const w = words[wi];
    if (deleting) {
      ci--;
      if (ci === 0) { deleting = false; wi = (wi + 1) % words.length; }
    } else {
      ci++;
      if (ci === words[wi].length) { deleting = true; typed.textContent = words[wi]; return setTimeout(typeLoop, 2200); }
    }
    typed.textContent = (deleting ? w : words[wi]).slice(0, ci) || "​";
    setTimeout(typeLoop, deleting ? 45 : 85);
  }
  if (!reducedMotion) setTimeout(typeLoop, 2600);

  /* ================= PHONE CLOCK ================= */
  const phoneTime = $("#phoneTime");
  const phoneDate = $(".phone__date");
  const tickClock = () => {
    const d = new Date();
    phoneTime.textContent = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    const s = d.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });
    phoneDate.textContent = s[0].toUpperCase() + s.slice(1);
  };
  tickClock();
  setInterval(tickClock, 10000);

  /* ================= COUNTDOWN ================= */
  const dealKey = "volta-deal-end";
  let dealEnd = store.get(dealKey, 0);
  if (!dealEnd || dealEnd < Date.now()) {
    dealEnd = Date.now() + ((3 * 24 + 7) * 3600 + 42 * 60) * 1000;
    store.set(dealKey, dealEnd);
  }
  const units = Object.fromEntries($$("#countdown b").map((b) => [b.dataset.unit, b]));
  const pad = (n) => String(n).padStart(2, "0");
  function tickCountdown() {
    let diff = Math.max(0, dealEnd - Date.now()) / 1000;
    const vals = {
      d: Math.floor(diff / 86400),
      h: Math.floor((diff % 86400) / 3600),
      m: Math.floor((diff % 3600) / 60),
      s: Math.floor(diff % 60),
    };
    for (const k in vals) {
      const v = pad(vals[k]);
      if (units[k].textContent !== v) {
        units[k].textContent = v;
        units[k].classList.remove("tick");
        void units[k].offsetWidth;
        units[k].classList.add("tick");
      }
    }
  }
  tickCountdown();
  setInterval(tickCountdown, 1000);

  /* ================= 3D TILT ================= */
  if (finePointer && !reducedMotion) {
    $$("[data-tilt]").forEach((el) => {
      const area = el.parentElement;
      area.addEventListener("pointermove", (e) => {
        const r = area.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5;
        const y = (e.clientY - r.top) / r.height - 0.5;
        el.style.transform = `rotateY(${x * 24}deg) rotateX(${-y * 24}deg)`;
      });
      area.addEventListener("pointerleave", () => { el.style.transform = ""; });
    });

    // magnetic buttons
    $$(".magnetic").forEach((btn) => {
      btn.addEventListener("pointermove", (e) => {
        const r = btn.getBoundingClientRect();
        const x = e.clientX - r.left - r.width / 2;
        const y = e.clientY - r.top - r.height / 2;
        btn.style.transform = `translate(${x * 0.25}px, ${y * 0.35}px)`;
      });
      btn.addEventListener("pointerleave", () => { btn.style.transform = ""; });
    });

    // cursor glow
    const glow = $(".cursor-glow");
    let gx = innerWidth / 2, gy = innerHeight / 2, tx = gx, ty = gy;
    addEventListener("pointermove", (e) => { tx = e.clientX; ty = e.clientY; }, { passive: true });
    (function loop() {
      gx += (tx - gx) * 0.12;
      gy += (ty - gy) * 0.12;
      glow.style.transform = `translate(${gx - 250}px, ${gy - 250}px)`;
      requestAnimationFrame(loop);
    })();

    // parallax blobs
    const blobs = $$(".blob");
    addEventListener("pointermove", (e) => {
      const x = e.clientX / innerWidth - 0.5, y = e.clientY / innerHeight - 0.5;
      blobs.forEach((b, i) => { b.style.translate = `${x * (i + 1) * 30}px ${y * (i + 1) * 30}px`; });
    }, { passive: true });
  } else {
    $(".cursor-glow").style.display = "none";
  }

  /* ================= RIPPLE ================= */
  document.addEventListener("pointerdown", (e) => {
    const btn = e.target.closest(".btn");
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const size = Math.max(r.width, r.height);
    const s = document.createElement("span");
    s.className = "ripple";
    s.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
    btn.appendChild(s);
    setTimeout(() => s.remove(), 700);
  });

  /* ================= NEWSLETTER ================= */
  $("#newsletter").addEventListener("submit", (e) => {
    e.preventDefault();
    e.target.reset();
    toast("✉️ Готово! Промокод VOLTA10 отправлен на почту");
  });

  /* ================= TOAST ================= */
  const toastEl = $("#toast");
  let toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("is-visible"), 2600);
  }

  /* ================= CONFETTI ================= */
  function confetti() {
    if (reducedMotion) return;
    const colors = ["#7c5cff", "#00d4ff", "#ff4fd8", "#2ee59d", "#ffb347"];
    for (let i = 0; i < 80; i++) {
      const c = document.createElement("span");
      const size = 6 + Math.random() * 8;
      c.style.cssText = `position:fixed;z-index:500;left:50%;top:40%;width:${size}px;height:${size * 0.6}px;background:${colors[i % colors.length]};border-radius:2px;pointer-events:none`;
      document.body.appendChild(c);
      const angle = Math.random() * Math.PI * 2;
      const dist = 150 + Math.random() * 300;
      c.animate(
        [
          { transform: "translate(0,0) rotate(0)", opacity: 1 },
          { transform: `translate(${Math.cos(angle) * dist}px, ${Math.sin(angle) * dist + 300}px) rotate(${Math.random() * 720}deg)`, opacity: 0 },
        ],
        { duration: 1400 + Math.random() * 800, easing: "cubic-bezier(.2,.7,.4,1)" }
      ).onfinish = () => c.remove();
    }
  }

  $("#year").textContent = new Date().getFullYear();
})();
