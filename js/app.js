(() => {
  "use strict";

  const { render } = window.VoltaDevices;
  const { categories, products } = window.VoltaData;
  const byId = Object.fromEntries(products.map((p) => [p.id, p]));

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const fmt = (n) => Math.round(n).toLocaleString("ru-RU") + " ₽";
  const monthly = (price, term = 24) => Math.ceil(price / term / 10) * 10;
  const plural = (n, f) => {
    const a = n % 10, b = n % 100;
    return a === 1 && b !== 11 ? f[0] : a >= 2 && a <= 4 && (b < 12 || b > 14) ? f[1] : f[2];
  };
  const store = {
    get(key, fallback) {
      try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
    },
  };
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const ICON = {
    heart: `<svg viewBox="0 0 24 24"><path d="M12 20s-7-4.4-8.7-8.8C2 7.9 4.2 4.5 7.6 4.5c1.9 0 3.3 1 4.4 2.5 1.1-1.5 2.5-2.5 4.4-2.5 3.4 0 5.6 3.4 4.3 6.7C19 15.6 12 20 12 20z"/></svg>`,
    back: `<svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>`,
  };

  /* ================= STATE ================= */
  let cart = store.get("volta-cart-v3", {});
  const favs = new Set(store.get("volta-favs-v3", []));
  const seenStories = new Set(store.get("volta-stories", []));
  let filter = "all";
  let query = "";
  let sortBy = "popular";
  let payMode = "full";

  /* ================= THEME ================= */
  const root = document.documentElement;
  const savedTheme = store.get("volta-theme-v3", null);
  if (savedTheme) root.dataset.theme = savedTheme;
  $("#themeBtn").addEventListener("click", () => {
    const current = root.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    root.dataset.theme = current === "dark" ? "light" : "dark";
    store.set("volta-theme-v3", root.dataset.theme);
  });

  /* ================= SCROLL LOCK ================= */
  let locks = 0;
  function lockScroll(on) {
    locks = Math.max(0, locks + (on ? 1 : -1));
    const gap = innerWidth - document.documentElement.clientWidth;
    if (locks && !root.classList.contains("is-locked")) {
      root.style.paddingRight = gap + "px";
      root.classList.add("is-locked");
    } else if (!locks) {
      root.classList.remove("is-locked");
      root.style.paddingRight = "";
    }
  }

  /* ================= PAUSE OFF-SCREEN SVG ANIMATIONS ================= */
  const offscreen = new IntersectionObserver((entries) => {
    entries.forEach(({ target, isIntersecting }) => {
      if (target.pauseAnimations) isIntersecting ? target.unpauseAnimations() : target.pauseAnimations();
    });
  });
  const watch = (el) => $$("svg", el).forEach((svg) => offscreen.observe(svg));

  /* ================= TOAST ================= */
  const toastEl = $("#toast");
  let toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("is-visible"), 2200);
  }

  /* ================= STORIES ================= */
  const stories = [
    { id: "new-iphone", label: "Новые iPhone", tile: "var(--t-orange)", product: "iphone-17-pro", color: 0,
      bg: "linear-gradient(160deg, #ff9a5a, #d9773f 55%, #6b2d12)", title: "iPhone 17 Pro уже в продаже", text: "Три камеры 48 Мп, чип A19 Pro и новый цвет «Космический оранжевый».", cta: "Смотреть" },
    { id: "parts", label: "Рассрочка 0%", tile: "var(--t-violet)", product: "galaxy-s25-ultra", color: 2,
      bg: "linear-gradient(160deg, #8b6bff, #5a2fe0 60%, #2a1470)", title: "0–0–24 на всю технику", text: "Без переплат и первого взноса. Решение за 5 минут.", cta: "Рассчитать", anchor: "#installment" },
    { id: "trade-in", label: "Trade-in", tile: "var(--t-green)", product: "pixel-10-pro", color: 2,
      bg: "linear-gradient(160deg, #3ccf8a, #16a35e 60%, #0b4d2c)", title: "Старый телефон — в скидку", text: "Оценим устройство за 2 минуты и вычтем до 40% из цены нового.", cta: "Подробнее", anchor: "#service" },
    { id: "macbook", label: "MacBook −15%", tile: "var(--t-blue)", product: "macbook-air-13-m4", color: 0,
      bg: "linear-gradient(160deg, #6fb2ff, #2f6fe0 60%, #13306b)", title: "MacBook Air M4 со скидкой", text: "Только на этой неделе — минус 15% на все конфигурации.", cta: "К товару" },
    { id: "audio", label: "Звук", tile: "var(--t-pink)", product: "sony-wh-1000xm6", color: 0,
      bg: "linear-gradient(160deg, #ff7aa8, #e0457b 60%, #5e1430)", title: "Тишина на 30 часов", text: "Sony WH-1000XM6 с лучшим шумоподавлением в классе.", cta: "К товару" },
    { id: "gaming", label: "Игры", tile: "var(--t-yellow)", product: "nintendo-switch-2", color: 0,
      bg: "linear-gradient(160deg, #ffcf5a, #f29a1f 60%, #6b3b05)", title: "Switch 2 и PS5 Pro", text: "Консоли нового поколения в наличии, доставим сегодня.", cta: "В каталог", cat: "gaming" },
  ];
  const storiesEl = $("#stories");
  function renderStoryChips() {
    storiesEl.innerHTML = stories.map((s, i) => {
      const p = byId[s.product];
      return `<button class="story-chip${seenStories.has(s.id) ? " is-seen" : ""}" data-story="${i}">
        <span class="story-chip__ring"><span class="story-chip__inner" style="--tile:${s.tile}">${render(p, s.color)}</span></span>
        ${s.label}
      </button>`;
    }).join("");
    watch(storiesEl);
  }
  renderStoryChips();

  const storyEl = $("#story");
  let storyIdx = 0, storyTimer = null, storyStart = 0, storyLeft = 0;
  const STORY_MS = 5000;
  function showStory(i) {
    if (i < 0) i = 0;
    if (i >= stories.length) return closeStory();
    storyIdx = i;
    const s = stories[i];
    seenStories.add(s.id);
    store.set("volta-stories", [...seenStories]);
    $("#storyBars").innerHTML = stories.map((_, k) => `<span class="${k < i ? "is-done" : k === i ? "is-active" : ""}"><i></i></span>`).join("");
    const slide = $("#storySlide");
    slide.style.setProperty("--bgc", s.bg);
    slide.innerHTML = `
      <h3>${s.title}</h3>
      <p>${s.text}</p>
      <div class="story__art">${render(byId[s.product], s.color)}</div>
      <button class="btn" data-story-cta>${s.cta}</button>`;
    slide.style.animation = "none"; void slide.offsetWidth; slide.style.animation = "";
    storyLeft = STORY_MS;
    runStoryTimer();
  }
  function runStoryTimer() {
    clearTimeout(storyTimer);
    storyStart = Date.now();
    storyTimer = setTimeout(() => showStory(storyIdx + 1), storyLeft);
  }
  function openStory(i) {
    storyEl.hidden = false;
    lockScroll(true);
    showStory(i);
  }
  function closeStory() {
    if (storyEl.hidden) return;
    clearTimeout(storyTimer);
    storyEl.hidden = true;
    lockScroll(false);
    renderStoryChips();
  }
  storiesEl.addEventListener("click", (e) => {
    const b = e.target.closest("[data-story]");
    if (b) openStory(+b.dataset.story);
  });
  $("#storyClose").addEventListener("click", closeStory);
  $("#storyPrev").addEventListener("click", () => showStory(storyIdx - 1));
  $("#storyNext").addEventListener("click", () => showStory(storyIdx + 1));
  // hold to pause
  storyEl.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button:not(.story__nav)")) return;
    clearTimeout(storyTimer);
    storyLeft -= Date.now() - storyStart;
    storyEl.classList.add("is-paused");
  });
  const resumeStory = () => {
    if (!storyEl.classList.contains("is-paused")) return;
    storyEl.classList.remove("is-paused");
    runStoryTimer();
  };
  storyEl.addEventListener("pointerup", resumeStory);
  storyEl.addEventListener("pointercancel", resumeStory);
  $("#storySlide").addEventListener("click", (e) => {
    if (!e.target.closest("[data-story-cta]")) return;
    const s = stories[storyIdx];
    closeStory();
    if (s.anchor) goHome(s.anchor);
    else if (s.cat) { setFilter(s.cat); goHome("#catalog"); }
    else openProduct(s.product);
  });

  /* ================= PROMO BANNERS ================= */
  const promos = [
    { title: "iPhone 17 Pro", text: `От ${fmt(monthly(byId["iphone-17-pro"].opts[0][1]))} в месяц без переплат`, cta: "Купить", product: "iphone-17-pro", color: 1, bg: "linear-gradient(135deg, #1d2a44, #33415c 60%, #5a6c8f)" },
    { title: "MacBook Air M4 −15%", text: "Предложение недели на все конфигурации", cta: "Смотреть", product: "macbook-air-13-m4", color: 0, bg: "linear-gradient(135deg, #2f6fe0, #6fb2ff)" },
    { title: "Galaxy S25 Ultra", text: "Скидка 25 000 ₽ и стилус в комплекте", cta: "Купить", product: "galaxy-s25-ultra", color: 1, bg: "linear-gradient(135deg, #5a2fe0, #8b6bff)" },
    { title: "Trade-in до −40%", text: "Сдайте старое устройство при покупке нового", cta: "Подробнее", product: "pixel-10-pro", color: 3, bg: "linear-gradient(135deg, #0f7a46, #3ccf8a)", anchor: "#service" },
  ];
  const promosEl = $("#promos");
  promosEl.innerHTML = promos.map((pr, i) => `
    <article class="promo" style="--bgc:${pr.bg}" data-promo="${i}">
      <h3>${pr.title}</h3>
      <p>${pr.text}</p>
      <button class="btn">${pr.cta}</button>
      <div class="promo__art">${render(byId[pr.product], pr.color)}</div>
    </article>`).join("");
  watch(promosEl);
  promosEl.addEventListener("click", (e) => {
    const card = e.target.closest("[data-promo]");
    if (!card) return;
    const pr = promos[+card.dataset.promo];
    pr.anchor ? goHome(pr.anchor) : openProduct(pr.product);
  });
  const dotsEl = $("#promoDots");
  function syncDots() {
    const per = Math.max(1, Math.round(promosEl.clientWidth / promosEl.firstElementChild.clientWidth));
    const pages = Math.max(1, promos.length - per + 1);
    const page = Math.round(promosEl.scrollLeft / (promosEl.firstElementChild.clientWidth + 16));
    dotsEl.innerHTML = Array.from({ length: pages }, (_, k) => `<button class="${k === Math.min(page, pages - 1) ? "is-active" : ""}" data-dot="${k}" aria-label="Баннер ${k + 1}"></button>`).join("");
  }
  promosEl.addEventListener("scroll", () => requestAnimationFrame(syncDots), { passive: true });
  addEventListener("resize", syncDots);
  syncDots();
  const scrollPromo = (k) => promosEl.scrollTo({ left: k * (promosEl.firstElementChild.clientWidth + 16), behavior: "smooth" });
  dotsEl.addEventListener("click", (e) => { const d = e.target.closest("[data-dot]"); if (d) scrollPromo(+d.dataset.dot); });
  let promoPaused = false;
  promosEl.addEventListener("pointerenter", () => (promoPaused = true));
  promosEl.addEventListener("pointerleave", () => (promoPaused = false));
  if (!reducedMotion) {
    setInterval(() => {
      if (promoPaused || document.hidden || !$("#home").offsetParent) return;
      const pages = dotsEl.children.length;
      const cur = [...dotsEl.children].findIndex((d) => d.classList.contains("is-active"));
      scrollPromo((cur + 1) % pages);
    }, 6000);
  }

  /* ================= CATEGORY TILES ================= */
  const TILE = {
    phone: ["var(--t-blue)", "iphone-17", 2],
    laptop: ["var(--t-violet)", "macbook-air-13-m4", 3],
    tablet: ["var(--t-pink)", "ipad-air-11-m3", 2],
    audio: ["var(--t-orange)", "sony-wh-1000xm6", 0],
    watch: ["var(--t-green)", "apple-watch-s11", 1],
    gaming: ["var(--t-yellow)", "nintendo-switch-2", 0],
  };
  const tilesEl = $("#tiles");
  tilesEl.innerHTML = categories.filter((c) => c.id !== "all").map((c) => {
    const [tile, pid, ci] = TILE[c.id];
    const n = products.filter((p) => p.cat === c.id).length;
    return `<button class="tile" style="--tile:${tile}" data-cat="${c.id}">
      <b>${c.name}</b><small>${n} ${plural(n, ["товар", "товара", "товаров"])}</small>
      <span class="tile__art">${render(byId[pid], ci)}</span>
    </button>`;
  }).join("");
  watch(tilesEl);
  tilesEl.addEventListener("click", (e) => {
    const t = e.target.closest("[data-cat]");
    if (!t) return;
    setFilter(t.dataset.cat);
    $("#catalog").scrollIntoView({ behavior: "smooth" });
  });

  /* ================= CATALOG ================= */
  const chipsEl = $("#chips");
  const productsEl = $("#products");
  function renderChips() {
    const list = [...categories];
    if (favs.size || filter === "fav") list.push({ id: "fav", name: `Избранное · ${favs.size}` });
    chipsEl.innerHTML = list.map((c) => `<button class="chip${c.id === filter ? " is-active" : ""}" data-filter="${c.id}" role="tab">${c.name}</button>`).join("");
  }
  function setFilter(id) {
    filter = id;
    renderChips();
    renderProducts();
  }
  chipsEl.addEventListener("click", (e) => { const b = e.target.closest("[data-filter]"); if (b) setFilter(b.dataset.filter); });
  $("#sort").addEventListener("change", (e) => { sortBy = e.target.value; renderProducts(); });
  $("#resetFilters").addEventListener("click", () => {
    query = ""; $("#searchInput").value = ""; setFilter("all");
  });

  const searchInput = $("#searchInput");
  searchInput.addEventListener("input", () => {
    query = searchInput.value.trim().toLowerCase();
    if (!$("#product").hidden) goHome();
    renderProducts();
  });
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { goHome(); $("#catalog").scrollIntoView({ behavior: "smooth" }); }
  });

  function card(p) {
    const tag = p.tag === "Новинка" ? `<span class="tag tag--new">Новинка</span>`
      : p.tag === "Хит" ? `<span class="tag tag--hit">Хит</span>`
      : p.tag ? `<span class="tag">${p.tag}</span>` : "";
    const price = p.opts[0][1];
    return `<article class="pcard" data-open="${p.id}">
      <div class="pcard__media">
        ${tag}
        <button class="fav${favs.has(p.id) ? " is-active" : ""}" data-fav="${p.id}" aria-label="В избранное">${ICON.heart}</button>
        <div class="render">${render(p, 0)}</div>
      </div>
      <div class="pcard__body">
        <div class="price-row"><strong>${p.opts.length > 1 ? "от " : ""}${fmt(price)}</strong>${p.old ? `<s>${fmt(p.old)}</s>` : ""}</div>
        <span class="monthly">${fmt(monthly(price))} × 24 мес</span>
        <span class="pcard__name">${p.name}</span>
        <span class="pcard__rating"><b>★ ${(4.5 + (p.pop % 5) / 10).toFixed(1)}</b> · ${p.pop * 37} отзывов</span>
        ${p.colors.length > 1 ? `<span class="swatches">${p.colors.map((c) => `<span style="--sw:${c.hex}" title="${c.name}"></span>`).join("")}</span>` : ""}
        <div class="pcard__buy"><button class="btn btn--soft" data-add="${p.id}">В корзину</button></div>
      </div>
    </article>`;
  }

  function renderProducts() {
    let list = products.filter((p) => filter === "all" || (filter === "fav" ? favs.has(p.id) : p.cat === filter));
    if (query) list = list.filter((p) => `${p.brand} ${p.name} ${p.short}`.toLowerCase().includes(query));
    const sorters = {
      popular: (a, b) => b.pop - a.pop,
      "price-asc": (a, b) => a.opts[0][1] - b.opts[0][1],
      "price-desc": (a, b) => b.opts[0][1] - a.opts[0][1],
      new: (a, b) => b.year - a.year || b.pop - a.pop,
    };
    list.sort(sorters[sortBy]);
    const cat = categories.find((c) => c.id === filter);
    $("#catalogTitle").textContent = query ? `Поиск: «${searchInput.value.trim()}»` : filter === "fav" ? "Избранное" : filter === "all" ? "Хиты продаж" : cat.name;
    $("#empty").hidden = list.length > 0;
    productsEl.innerHTML = list.map(card).join("");
    watch(productsEl);
  }
  renderChips();
  renderProducts();

  /* ================= FAVOURITES ================= */
  function toggleFav(id) {
    favs.has(id) ? favs.delete(id) : favs.add(id);
    store.set("volta-favs-v3", [...favs]);
    $$(`[data-fav="${id}"]`).forEach((b) => b.classList.toggle("is-active", favs.has(id)));
    updateBadges();
    renderChips();
    if (filter === "fav") renderProducts();
    toast(favs.has(id) ? "Добавлено в избранное" : "Удалено из избранного");
  }
  $$("[data-show-favs]").forEach((b) => b.addEventListener("click", () => {
    if (!favs.size) return toast("В избранном пока пусто — нажмите ♥ на товаре");
    setFilter("fav");
    goHome("#catalog");
  }));

  /* ================= CART ================= */
  const keyOf = (id, c, o) => `${id}|${c}|${o}`;
  const parseKey = (k) => { const [id, c, o] = k.split("|"); return { id, c: +c, o: +o }; };
  const cartKeys = () => Object.keys(cart).filter((k) => byId[parseKey(k).id] && cart[k] > 0);
  function saveCart() {
    store.set("volta-cart-v3", cart);
    renderCart();
    updateBadges();
  }
  function addToCart(id, c = 0, o = 0, btn) {
    const k = keyOf(id, c, o);
    cart[k] = (cart[k] || 0) + 1;
    saveCart();
    toast(`${byId[id].name} — в корзине`);
    if (btn) {
      const label = btn.textContent;
      btn.classList.add("is-added");
      btn.textContent = "Добавлено ✓";
      setTimeout(() => { btn.classList.remove("is-added"); btn.textContent = label; }, 1200);
    }
  }
  function updateBadges() {
    const count = cartKeys().reduce((s, k) => s + cart[k], 0);
    $$("[data-cart-count]").forEach((b) => { b.textContent = count; b.hidden = !count; });
    $$("[data-fav-count]").forEach((b) => { b.textContent = favs.size; b.hidden = !favs.size; });
  }
  function renderCart() {
    const keys = cartKeys();
    let total = 0;
    $("#cartItems").innerHTML = keys.length ? keys.map((k) => {
      const { id, c, o } = parseKey(k);
      const p = byId[id];
      const ci = Math.min(c, p.colors.length - 1), oi = Math.min(o, p.opts.length - 1);
      const price = p.opts[oi][1];
      total += price * cart[k];
      const meta = [p.colors.length > 1 ? p.colors[ci].name : "", p.opts[oi][0]].filter(Boolean).join(" · ");
      return `<div class="citem">
        <div class="citem__img">${render(p, ci)}</div>
        <div>
          <b>${p.name}</b>
          ${meta ? `<small>${meta}</small>` : ""}
          <div class="qty">
            <button data-qty="${k}" data-d="-1" aria-label="Меньше">−</button>
            <span>${cart[k]}</span>
            <button data-qty="${k}" data-d="1" aria-label="Больше">+</button>
          </div>
        </div>
        <div>
          <div class="citem__price">${fmt(price * cart[k])}</div>
          <button class="citem__remove" data-remove="${k}">Удалить</button>
        </div>
      </div>`;
    }).join("") : `<div class="sheet__empty"><b>В корзине пусто</b><span>Добавьте что-нибудь из каталога</span></div>`;
    $("#totalLabel").textContent = payMode === "parts" ? "Платёж в месяц × 24" : "Итого";
    $("#cartTotal").textContent = fmt(payMode === "parts" ? monthly(total) : total);
    $("#checkout").disabled = !keys.length;
  }
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
  $("#payMode").addEventListener("click", (e) => {
    const b = e.target.closest("[data-pay]");
    if (!b) return;
    payMode = b.dataset.pay;
    $$("#payMode button").forEach((x) => x.classList.toggle("is-active", x === b));
    renderCart();
  });
  const cartEl = $("#cart"), scrim = $("#scrim");
  function openCart() {
    if (cartEl.classList.contains("is-open")) return;
    cartEl.classList.add("is-open"); scrim.classList.add("is-open");
    cartEl.setAttribute("aria-hidden", "false");
    lockScroll(true);
  }
  function closeCart() {
    if (!cartEl.classList.contains("is-open")) return;
    cartEl.classList.remove("is-open"); scrim.classList.remove("is-open");
    cartEl.setAttribute("aria-hidden", "true");
    lockScroll(false);
  }
  $$("[data-open-cart]").forEach((b) => b.addEventListener("click", openCart));
  $$("[data-close-cart]").forEach((b) => b.addEventListener("click", closeCart));
  scrim.addEventListener("click", closeCart);
  $("#checkout").addEventListener("click", () => {
    cart = {};
    saveCart();
    closeCart();
    toast(payMode === "parts" ? "Заявка на рассрочку отправлена" : "Заказ оформлен. Мы позвоним для подтверждения");
  });
  renderCart();
  updateBadges();

  /* ================= INSTALLMENT CALCULATOR ================= */
  const amount = $("#calcAmount");
  let term = 24;
  function calc() {
    $("#calcAmountOut").textContent = fmt(+amount.value);
    $("#calcMonthly").textContent = fmt(monthly(+amount.value, term));
  }
  amount.addEventListener("input", calc);
  $("#calcTerm").addEventListener("click", (e) => {
    const b = e.target.closest("[data-term]");
    if (!b) return;
    term = +b.dataset.term;
    $$("#calcTerm button").forEach((x) => x.classList.toggle("is-active", x === b));
    calc();
  });
  calc();

  /* ================= PRODUCT PAGE ================= */
  const homeEl = $("#home");
  const productEl = $("#product");
  const ps = { id: null, color: 0, opt: 0, pay: "full" };
  let homeScroll = 0;
  let cameFromHome = false;

  function productHTML(p) {
    const cat = categories.find((c) => c.id === p.cat);
    const related = products.filter((x) => x.cat === p.cat && x.id !== p.id).concat(products.filter((x) => x.cat !== p.cat && x.pop > 90)).slice(0, 6);
    return `
      <div class="container">
        <nav class="crumbs" aria-label="Навигация">
          <button class="back" data-back>${ICON.back}Назад</button>
          <a href="#" data-home>Главная</a><span>/</span>
          <a href="#catalog" data-cat-link="${p.cat}">${cat.name}</a><span>/</span>
          <span>${p.name}</span>
        </nav>
        <h1 class="product__title">${p.name}</h1>
        <div class="product__meta">
          <span><b>★ ${(4.5 + (p.pop % 5) / 10).toFixed(1)}</b> · ${p.pop * 37} отзывов</span>
          <span>Код товара: ${String(p.pop * 1031).padStart(6, "0")}</span>
          <span style="color:var(--ok)">В наличии</span>
        </div>
        <div class="product__layout">
          <div class="gallery card">
            <div class="gallery__stage"><div class="render" id="pRender">${render(p, ps.color, true)}</div></div>
            ${p.colors.length > 1 ? `<div class="thumbs">${p.colors.map((c, k) => `<button class="${k === ps.color ? "is-active" : ""}" data-p-color="${k}" aria-label="${c.name}">${render(p, k)}</button>`).join("")}</div>` : ""}
          </div>
          <div class="opts card">
            ${p.colors.length > 1 ? `<div>
              <div class="opt-label">Цвет: <b id="pColorName">${p.colors[ps.color].name}</b></div>
              <div class="color-row">${p.colors.map((c, k) => `<button class="${k === ps.color ? "is-active" : ""}" style="--sw:${c.hex}" data-p-color="${k}" aria-label="${c.name}"></button>`).join("")}</div>
            </div>` : ""}
            ${p.opts.length > 1 ? `<div>
              <div class="opt-label">Конфигурация</div>
              <div class="choice-row">${p.opts.map((o, k) => `<button class="${k === ps.opt ? "is-active" : ""}" data-p-opt="${k}">${o[0]}<small>${fmt(o[1])}</small></button>`).join("")}</div>
            </div>` : ""}
            <div>
              <div class="opt-label">Главное</div>
              <ul class="features">${p.specs.map((s) => `<li>${s}</li>`).join("")}</ul>
            </div>
          </div>
          <aside class="buybox card">
            <div class="segmented" id="pPay">
              <button data-p-pay="full" class="${ps.pay === "full" ? "is-active" : ""}">Сразу</button>
              <button data-p-pay="parts" class="${ps.pay === "parts" ? "is-active" : ""}">Частями</button>
            </div>
            <div class="buybox__price" id="pPrice"></div>
            <div class="buybox__note" id="pNote"></div>
            <div class="buybox__actions">
              <button class="btn btn--primary" data-p-add>В корзину</button>
              <button class="fav${favs.has(p.id) ? " is-active" : ""}" data-fav="${p.id}" aria-label="В избранное">${ICON.heart}</button>
            </div>
            <div class="delivery">
              <div><span>Курьером, сегодня</span><span>Бесплатно</span></div>
              <div><span>Самовывоз, через 1 час</span><span>Бесплатно</span></div>
              <div><span>Гарантия</span><span>1 год</span></div>
            </div>
          </aside>
        </div>
        <section class="specs card">
          <h2>Характеристики</h2>
          <table>
            <tr><th>Бренд</th><td>${p.brand}</td></tr>
            <tr><th>Модель</th><td>${p.name}</td></tr>
            <tr><th>Категория</th><td>${cat.name}</td></tr>
            <tr><th>Цвета</th><td>${p.colors.map((c) => c.name).join(", ")}</td></tr>
            ${p.opts[0][0] ? `<tr><th>Конфигурации</th><td>${p.opts.map((o) => o[0]).join(", ")}</td></tr>` : ""}
            <tr><th>Год выхода</th><td>${p.year}</td></tr>
            ${p.specs.map((s, k) => `<tr><th>${k === 0 ? "Особенности" : ""}</th><td>${s}</td></tr>`).join("")}
          </table>
        </section>
        <section class="related">
          <div class="section__head"><h2>Похожие товары</h2></div>
          <div class="grid">${related.map(card).join("")}</div>
        </section>
      </div>
      <div class="buybar">
        <div><strong id="pBarPrice"></strong><small id="pBarNote"></small></div>
        <button class="btn btn--primary" data-p-add>В корзину</button>
      </div>`;
  }
  function paintPrice() {
    const p = byId[ps.id];
    const price = p.opts[ps.opt][1];
    const parts = ps.pay === "parts";
    $("#pPrice").innerHTML = parts
      ? `<strong>${fmt(monthly(price))}</strong><span class="muted">× 24 мес</span>`
      : `<strong>${fmt(price)}</strong>${p.old && ps.opt === 0 ? `<s>${fmt(p.old)}</s><span class="tag">−${Math.round((1 - price / p.old) * 100)}%</span>` : ""}`;
    $("#pNote").textContent = parts ? `Переплата 0 ₽ · итого ${fmt(price)}` : `или ${fmt(monthly(price))} в месяц в рассрочку`;
    $("#pBarPrice").textContent = parts ? `${fmt(monthly(price))}/мес` : fmt(price);
    $("#pBarNote").textContent = parts ? "Рассрочка 0–0–24" : `${fmt(monthly(price))} × 24 мес`;
  }
  function showProduct(id) {
    const p = byId[id];
    if (!p) return;
    if (homeEl.hidden === false) homeScroll = scrollY;
    Object.assign(ps, { id, color: ps.id === id ? ps.color : 0, opt: ps.id === id ? ps.opt : 0 });
    productEl.innerHTML = productHTML(p);
    paintPrice();
    watch(productEl);
    homeEl.hidden = true;
    productEl.hidden = false;
    productEl.style.animation = "none"; void productEl.offsetWidth; productEl.style.animation = "";
    document.title = `${p.name} — VOLTA`;
    scrollTo({ top: 0, behavior: "instant" });
    $$(".tabbar [data-tab]").forEach((t) => t.classList.remove("is-active"));
  }
  function showHome(anchor) {
    const wasProduct = !productEl.hidden;
    productEl.hidden = true;
    productEl.innerHTML = "";
    homeEl.hidden = false;
    document.title = "Магазин VOLTA";
    $$(".tabbar [data-tab]").forEach((t) => t.classList.toggle("is-active", t.dataset.tab === "home"));
    const target = anchor && $(anchor);
    if (target) requestAnimationFrame(() => target.scrollIntoView({ behavior: wasProduct ? "instant" : "smooth" }));
    else if (wasProduct) scrollTo({ top: homeScroll, behavior: "instant" });
  }
  function openProduct(id) {
    cameFromHome = !homeEl.hidden || cameFromHome;
    if (location.hash === "#" + id) showProduct(id);
    else location.hash = id;
  }
  function goHome(anchor = "") {
    const cur = location.hash.length > 1 ? location.hash : "";
    if (cur === anchor) return showHome(anchor);
    location.hash = anchor ? anchor.slice(1) : "";
  }
  function route() {
    const id = decodeURIComponent(location.hash.slice(1));
    if (byId[id]) showProduct(id);
    else showHome(id ? "#" + id : "");
  }
  addEventListener("hashchange", route);

  productEl.addEventListener("click", (e) => {
    const p = byId[ps.id];
    if (e.target.closest("[data-back]")) {
      if (cameFromHome && history.length > 1) history.back();
      else goHome();
      return;
    }
    const cl = e.target.closest("[data-cat-link]");
    if (cl) { e.preventDefault(); setFilter(cl.dataset.catLink); goHome("#catalog"); return; }
    const pc = e.target.closest("[data-p-color]");
    if (pc) {
      ps.color = +pc.dataset.pColor;
      $$("[data-p-color]", productEl).forEach((b) => b.classList.toggle("is-active", +b.dataset.pColor === ps.color));
      const nameEl = $("#pColorName");
      if (nameEl) nameEl.textContent = p.colors[ps.color].name;
      const box = $("#pRender");
      box.innerHTML = render(p, ps.color, true);
      box.classList.remove("swap"); void box.offsetWidth; box.classList.add("swap");
      return;
    }
    const po = e.target.closest("[data-p-opt]");
    if (po) {
      ps.opt = +po.dataset.pOpt;
      $$("[data-p-opt]", productEl).forEach((b) => b.classList.toggle("is-active", b === po));
      paintPrice();
      return;
    }
    const pp = e.target.closest("[data-p-pay]");
    if (pp) {
      ps.pay = pp.dataset.pPay;
      $$("[data-p-pay]", productEl).forEach((b) => b.classList.toggle("is-active", b === pp));
      paintPrice();
      return;
    }
    const add = e.target.closest("[data-p-add]");
    if (add) addToCart(p.id, ps.color, ps.opt, add);
  });

  /* ================= GLOBAL CLICKS ================= */
  document.addEventListener("click", (e) => {
    const fav = e.target.closest("[data-fav]");
    if (fav) { e.stopPropagation(); toggleFav(fav.dataset.fav); return; }
    const add = e.target.closest("[data-add]");
    if (add) { addToCart(add.dataset.add, 0, 0, add); return; }
    const open = e.target.closest("[data-open]");
    if (open) { openProduct(open.dataset.open); return; }
    const home = e.target.closest("[data-home]");
    if (home) { e.preventDefault(); if (filter === "fav") setFilter("all"); goHome(); scrollTo({ top: 0, behavior: "smooth" }); }
  });
  addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    closeStory();
    closeCart();
  });

  /* ================= INIT ================= */
  $("#year").textContent = new Date().getFullYear();
  route();
})();
