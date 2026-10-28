/* Motion layer: GSAP + ScrollTrigger + Lenis. The page works fully without it. */
(() => {
  "use strict";

  const root = document.documentElement;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!window.gsap || !window.ScrollTrigger || reduce) {
    root.classList.remove("has-motion");
    return;
  }
  window.VOLTA_MOTION = true;
  root.classList.add("has-motion");

  const { gsap, ScrollTrigger } = window;
  gsap.registerPlugin(ScrollTrigger);
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const finePointer = matchMedia("(pointer: fine)").matches;
  const mm = gsap.matchMedia();

  // CSS scroll-driven reveals are replaced by GSAP ones
  $$(".reveal").forEach((el) => el.classList.remove("reveal"));

  /* ================= SMOOTH SCROLL ================= */
  let lenis = null;
  if (window.Lenis && finePointer) {
    lenis = new window.Lenis({ duration: 1.15, smoothWheel: true });
    lenis.on("scroll", ScrollTrigger.update);
    gsap.ticker.add((t) => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
    document.addEventListener("click", (e) => {
      const a = e.target.closest('a[href^="#"]');
      if (!a) return;
      const id = a.getAttribute("href");
      const target = id === "#top" ? 0 : $(id);
      if (target === null) return;
      e.preventDefault();
      lenis.scrollTo(target, { offset: -72, duration: 1.4 });
    });
    if (window.VOLTA) window.VOLTA.scrollTo = (el, opts = {}) => lenis.scrollTo(el, { offset: -72, duration: 1.4, ...opts });
    // freeze page scroll while cart or modal is open
    const overlays = [$("#cart"), $("#modal")];
    new MutationObserver(() => {
      overlays.some((el) => el.classList.contains("is-open")) ? lenis.stop() : lenis.start();
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["class"] });
  }

  /* ================= HELPERS ================= */
  function split(el) {
    const text = el.textContent.trim().replace(/\s+/g, " ");
    el.setAttribute("aria-label", text);
    el.innerHTML = text
      .split(" ")
      .map((w) => `<span class="split-line" aria-hidden="true">${[...w].map((c) => `<span class="split-char">${c}</span>`).join("")}</span>`)
      .join(" ");
    return $$(".split-char", el);
  }

  /* ================= PRELOADER + INTRO ================= */
  const heroChars = split($("#heroName"));
  const counter = { v: 0 };
  gsap.set(".hero__visual", { clipPath: "inset(100% 0% 0% 0% round 32px)" });
  gsap.set(heroChars, { yPercent: 115, rotate: 6 });
  gsap.set([".hero .kicker", ".hero__lead", ".hero__colors", ".hero__color-name", ".hero__buy"], { y: 30, opacity: 0 });
  gsap.set(".header", { yPercent: -100 });

  const intro = gsap.timeline({ defaults: { ease: "expo.out" } });
  intro
    .to(counter, { v: 100, duration: 1.1, ease: "power2.inOut", onUpdate: () => ($("#preCount").textContent = Math.round(counter.v)) })
    .to("#preBar", { scaleX: 1, duration: 1.1, ease: "power2.inOut" }, 0)
    .to(".preloader__inner", { yPercent: -140, duration: 0.55, ease: "power3.in" }, "+=0.05")
    .to("#preloader", { clipPath: "inset(0% 0% 100% 0%)", duration: 0.9, ease: "expo.inOut" }, "-=0.15")
    .set("#preloader", { display: "none" })
    .to(".hero__visual", { clipPath: "inset(0% 0% 0% 0% round 32px)", duration: 1.3, ease: "expo.inOut" }, "-=0.55")
    .from("#heroStage .d3", { scale: 0.55, y: 160, opacity: 0, duration: 1.8 }, "-=0.8")
    .to(heroChars, { yPercent: 0, rotate: 0, duration: 1.1, stagger: 0.03 }, "-=1.6")
    .to([".hero .kicker", ".hero__lead", ".hero__colors", ".hero__color-name", ".hero__buy"], { y: 0, opacity: 1, duration: 0.9, stagger: 0.07 }, "-=1.1")
    .to(".header", { yPercent: 0, duration: 0.9 }, "-=1")
    .add(() => ScrollTrigger.refresh());

  /* ================= HERO ON SCROLL ================= */
  mm.add("(min-width: 981px)", () => {
    const n = window.VOLTA?.heroColorCount || 1;
    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: ".hero",
        start: "top top",
        end: "+=140%",
        scrub: 1,
        pin: true,
        onUpdate(self) {
          if (!window.VOLTA || intro.isActive()) return;
          window.VOLTA.setHeroColor(Math.min(n - 1, Math.floor(self.progress * n * 0.999)));
        },
      },
    });
    tl.to(".hero__text", { xPercent: -30, opacity: 0, ease: "none" }, 0)
      .to(".hero__visual", { xPercent: -54, scale: 1.12, borderRadius: 48, ease: "none" }, 0)
      .to(".hero__visual", { scale: 0.92, opacity: 0.0, ease: "power1.in" }, 0.75);
  });
  mm.add("(max-width: 980px)", () => {
    gsap.to("#heroStage", { yPercent: 18, ease: "none", scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub: true } });
  });

  /* ================= BRANDS ================= */
  gsap.from("#brands button", {
    y: 40, opacity: 0, duration: 0.9, ease: "expo.out", stagger: 0.06,
    scrollTrigger: { trigger: "#brands", start: "top 92%" },
  });

  /* ================= HEADINGS ================= */
  $$(".showcase__head h2, .section__head h2, .deal h2, .newsletter h2").forEach((h) => {
    const chars = split(h);
    gsap.from(chars, {
      yPercent: 115, rotate: 5, duration: 1, ease: "expo.out", stagger: 0.018,
      scrollTrigger: { trigger: h, start: "top 88%" },
    });
  });
  gsap.from(".section__head .muted, .showcase__head .kicker", {
    opacity: 0, y: 20, duration: 0.8, ease: "power3.out",
    scrollTrigger: { trigger: ".showcase__head", start: "top 88%" },
  });

  /* ================= HORIZONTAL SHOWCASE ================= */
  mm.add("(min-width: 761px)", () => {
    const track = $("#showcaseTrack");
    const dist = () => Math.max(0, track.scrollWidth - innerWidth);
    const move = gsap.to(track, {
      x: () => -dist(),
      ease: "none",
      scrollTrigger: {
        trigger: "#showcase",
        start: "top top",
        end: () => "+=" + dist(),
        pin: true,
        scrub: 1,
        invalidateOnRefresh: true,
      },
    });
    $$(".slide").forEach((slide, i) => {
      gsap.fromTo($(".slide__render", slide), { rotate: -14, scale: 0.78, xPercent: 30 }, {
        rotate: 10, scale: 1.06, xPercent: -20, ease: "none",
        scrollTrigger: { trigger: slide, containerAnimation: move, start: "left right", end: "right left", scrub: true },
      });
      if (i === 0) return;
      gsap.from($$(".slide__info > *", slide), {
        x: 80, opacity: 0, duration: 0.9, ease: "expo.out", stagger: 0.06,
        scrollTrigger: { trigger: slide, containerAnimation: move, start: "left 75%" },
      });
    });
  });

  /* ================= VELOCITY TICKER ================= */
  const ticker = gsap.to("#ticker", { xPercent: -50, repeat: -1, duration: 26, ease: "none" });
  ticker.totalTime(ticker.duration() * 50);
  let boost = 0, dir = 1, skew = 0;
  const setSkew = gsap.quickSetter("#ticker", "skewX", "deg");
  ScrollTrigger.create({
    onUpdate(self) {
      boost = Math.min(Math.abs(self.getVelocity()) / 250, 8);
      dir = self.direction;
    },
  });
  gsap.ticker.add(() => {
    boost *= 0.93;
    ticker.timeScale(dir * (1 + boost));
    skew += (-dir * boost * 1.6 - skew) * 0.12;
    setSkew(skew);
  });

  /* ================= PRODUCT CARDS ================= */
  const productsEl = $("#products");
  const prepCards = (cards) => cards.forEach((c) => {
    if (!c.querySelector(".glare")) c.insertAdjacentHTML("beforeend", '<span class="glare"></span>');
  });
  const initial = $$(".card", productsEl);
  prepCards(initial);
  gsap.set(initial, { y: 90, opacity: 0, rotateX: -18, transformPerspective: 900 });
  ScrollTrigger.batch(initial, {
    start: "top 92%",
    once: true,
    onEnter: (batch) => gsap.to(batch, { y: 0, opacity: 1, rotateX: 0, duration: 1.1, ease: "expo.out", stagger: 0.08, clearProps: "transform" }),
  });
  let refreshTimer;
  new MutationObserver(() => {
    const cards = $$(".card", productsEl);
    prepCards(cards);
    gsap.fromTo(cards, { y: 50, opacity: 0, scale: 0.94 }, { y: 0, opacity: 1, scale: 1, duration: 0.8, ease: "expo.out", stagger: 0.04, clearProps: "transform" });
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => ScrollTrigger.refresh(), 200);
  }).observe(productsEl, { childList: true });

  if (finePointer) {
    productsEl.addEventListener("pointermove", (e) => {
      const card = e.target.closest(".card");
      if (!card) return;
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
      card.style.setProperty("--gx", px * 100 + "%");
      card.style.setProperty("--gy", py * 100 + "%");
      gsap.to(card, { rotateY: (px - 0.5) * 14, rotateX: -(py - 0.5) * 14, y: -6, transformPerspective: 900, duration: 0.5, ease: "power3.out", overwrite: "auto" });
    });
    productsEl.addEventListener("pointerout", (e) => {
      const card = e.target.closest(".card");
      if (!card || card.contains(e.relatedTarget)) return;
      gsap.to(card, { rotateY: 0, rotateX: 0, y: 0, duration: 0.9, ease: "elastic.out(1, 0.5)", overwrite: "auto" });
    });
  }

  /* ================= DEAL ================= */
  gsap.fromTo("#dealVisual svg", { rotateX: -88, y: 80, opacity: 0.2, transformPerspective: 1100, transformOrigin: "50% 92%" }, {
    rotateX: 0, y: 0, opacity: 1, ease: "none",
    scrollTrigger: { trigger: ".deal", start: "top 85%", end: "top 25%", scrub: 1 },
  });
  gsap.from("#countdown div", {
    y: 40, opacity: 0, scale: 0.7, duration: 0.8, ease: "back.out(2)", stagger: 0.08,
    scrollTrigger: { trigger: "#countdown", start: "top 90%" },
  });
  const dealPrice = $(".deal .price strong");
  if (dealPrice) {
    const p = { v: 109990 };
    gsap.to(p, {
      v: 93490, duration: 1.6, ease: "power3.out",
      scrollTrigger: { trigger: dealPrice, start: "top 90%" },
      onUpdate: () => (dealPrice.textContent = (Math.round(p.v / 10) * 10).toLocaleString("ru-RU") + " ₽"),
    });
  }

  /* ================= SERVICE + NEWSLETTER ================= */
  gsap.from(".service__item", {
    y: 100, opacity: 0, rotate: 4, duration: 1.1, ease: "expo.out", stagger: 0.1,
    scrollTrigger: { trigger: ".service", start: "top 88%" },
  });
  gsap.from(".service__item svg", {
    scale: 0, rotate: -90, duration: 0.9, ease: "back.out(2.5)", stagger: 0.1, delay: 0.25,
    scrollTrigger: { trigger: ".service", start: "top 88%" },
  });
  gsap.fromTo(".newsletter", { scale: 0.88, borderRadius: 80 }, {
    scale: 1, borderRadius: 32, ease: "none",
    scrollTrigger: { trigger: ".newsletter", start: "top 95%", end: "top 55%", scrub: 1 },
  });

  /* ================= FOOTER WORDMARK ================= */
  const word = $("#footerWord");
  word.innerHTML = [...word.textContent].map((c) => `<span>${c}</span>`).join("");
  gsap.from($$("span", word), {
    yPercent: 100, ease: "none", stagger: 0.08,
    scrollTrigger: { trigger: word, start: "top bottom", end: "bottom bottom", scrub: 1 },
  });

  /* ================= SCROLL PROGRESS + HEADER ================= */
  gsap.to("#scrollProgress", { scaleX: 1, ease: "none", scrollTrigger: { start: 0, end: "max", scrub: 0.3 } });
  let headerHidden = false;
  ScrollTrigger.create({
    start: 0,
    end: "max",
    onUpdate(self) {
      const hide = self.direction === 1 && self.scroll() > 400;
      if (hide === headerHidden || intro.isActive()) return;
      headerHidden = hide;
      gsap.to(".header", { yPercent: hide ? -100 : 0, duration: 0.45, ease: "power3.out" });
    },
  });

  /* ================= MAGNETIC BUTTONS ================= */
  if (finePointer) {
    $$(".btn, .icon-btn").forEach((el) => {
      const xTo = gsap.quickTo(el, "x", { duration: 0.5, ease: "power3.out" });
      const yTo = gsap.quickTo(el, "y", { duration: 0.5, ease: "power3.out" });
      el.addEventListener("pointermove", (e) => {
        const r = el.getBoundingClientRect();
        xTo((e.clientX - r.left - r.width / 2) * 0.3);
        yTo((e.clientY - r.top - r.height / 2) * 0.4);
      });
      el.addEventListener("pointerleave", () => {
        gsap.to(el, { x: 0, y: 0, duration: 0.9, ease: "elastic.out(1, 0.4)" });
      });
    });
  }

  addEventListener("load", () => ScrollTrigger.refresh());
})();
