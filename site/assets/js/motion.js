// Анимации приложения покупателя (specs/018, design.md → «Движение»; экраны и вкладки — specs/025): GSAP 3.15 из assets/vendor/gsap
// (обычные скрипты defer выше).
// Всё — в gsap.matchMedia() «(prefers-reduced-motion: no-preference)»; нет GSAP — сайт работает без анимаций: шторки
// открываются сразу, суммы меняются сразу (app.js проверяет motion.* перед каждым вызовом). Анимируем transform и opacity
// (фото при входе — clip-path). Цена, кнопки и поля видны сразу. ScrollSmoother не берём: со шторками и sticky он мешает.
import { closeByUser, motion as hooks, sheets } from './app.js';
import { onLang } from './i18n.js';

const html = document.documentElement;
const { gsap } = window;

if (gsap) init();
else html.classList.add('motion-ready'); // GSAP не загрузился — показываем всё сразу (app.css прячет фото и заголовок до входа)

function init() {
  // Вход играем, только если app.css ещё прячет заголовок (скрипты успели раньше 0,8 с): опоздавший вход спрятал бы уже
  // видное и показал заново — выглядит как поломка. Медленная сеть — всё сразу на месте, без входа
  const heading = document.querySelector('.combo__title');
  const stillHidden = Boolean(heading) && getComputedStyle(heading).opacity === '0';
  // Сразу: фото и заголовок больше не ждут скрипт. Вход ниже ставит свои начальные состояния в этой же задаче — до отрисовки
  html.classList.add('motion-ready');
  const { ScrollTrigger, Flip, Draggable, MotionPathPlugin, CustomEase, SplitText } = window;
  gsap.registerPlugin(...[ScrollTrigger, Flip, Draggable, MotionPathPlugin, CustomEase, SplitText].filter(Boolean));
  // Одна кривая на всё движение — как --kit в base.css
  const kit = CustomEase ? CustomEase.create('kit', '0.22,1,0.36,1') : 'power3.out';
  gsap.defaults({ ease: kit, duration: 0.6 });
  ScrollTrigger?.config({ ignoreMobileResize: true });

  const $ = (s, root = document) => root.querySelector(s);
  const title = $('.combo__title');
  let introPlayed = !stillHidden;
  let split = null; // заголовок, разбитый на буквы, пока идёт вход

  /* ---------- Вход, как запуск приложения: рамка (шапка, вкладки, корзина) на месте, содержимое входит — фото раскрывается
     шторкой, название по буквам, плитки состава каскадом ---------- */
  function intro() {
    if (introPlayed) return;
    introPlayed = true;
    const tl = gsap.timeline();
    // Шапка, панель вкладок и кнопка корзины стоят на месте с первой отрисовки (рамка приложения; кнопку заказа не прячем
    // ни на миг) — входит только содержимое экрана
    tl.from('.screen--menu .eta, .screen--menu .reorder', { y: 14, autoAlpha: 0, duration: 0.45, stagger: 0.06, clearProps: 'transform,opacity,visibility' }, 0.05);
    const photo = $('.combo__photo');
    if (photo) {
      // Фото не раскрываем шторкой: это главная картинка первого экрана — видна сразу (стоит в начале сцены прокрутки, app.css)
      const img = $('img', photo);
      const halal = $('.combo__halal', photo);
      if (halal) tl.from(halal, { scale: 0, autoAlpha: 0, duration: 0.45 }, 0.55);
    }
    if (title && SplitText) {
      split = SplitText.create(title, { type: 'words,chars', mask: 'chars' });
      tl.from(split.chars, { yPercent: 110, duration: 0.55, stagger: 0.03 }, 0.15);
      // Сразу после входа — исходная разметка: переносы, перевод и экранный диктор как в вёрстке
      tl.call(() => { split?.revert(); split = null; }, null, '>');
    }
    // Плитки состава поднимаются каскадом
    tl.from('.combo__list li', { y: 16, autoAlpha: 0, duration: 0.45, stagger: 0.06, clearProps: 'transform,opacity,visibility' }, 0.35);
  }
  // Сменили язык, пока заголовок разбит: app.js уже написал новый текст поверх букв — возвращать старый нельзя
  onLang(() => {
    if (split && title && !title.contains(split.chars[0])) { title.removeAttribute('aria-label'); split = null; }
  });

  /* ---------- Главная сцена: при прокрутке «Меню» фото живёт внутри рамки — отъезжает и плывёт, подпись «Халал» отстаёт,
     логотип в шапке сжимается; шаги «Как это работает» поднимаются, когда до них долистали ---------- */
  function scrollScene() {
    if (!ScrollTrigger) return () => {};
    const made = [];
    const card = $('.combo');
    const img = card && $('.combo__zoom img', card);
    const halal = card && $('.combo__halal', card);
    if (card && (img || halal)) {
      // Без закрепления: карточка просто уходит под шапку — так сцена не мешает ни вкладкам, ни колонке оформления
      const tl = gsap.timeline({
        defaults: { ease: 'none' },
        scrollTrigger: { trigger: card, start: 'top 120px', end: 'bottom 60px', scrub: 0.6, invalidateOnRefresh: true },
      });
      // От того, где фото стоит до прокрутки (scale 1.12 из app.css), — без скачка на первом кадре
      if (img) tl.fromTo(img, { scale: 1.12, yPercent: 0 }, { scale: 1, yPercent: 6 }, 0);
      // Подпись «Халал» на стекле чуть отстаёт от фото — лёгкая глубина, без поворотов
      if (halal) tl.fromTo(halal, { y: 0 }, { y: 10 }, 0);
      made.push(tl);
    }
    const logo = $('.appbar .topbar__logo');
    if (logo) made.push(gsap.fromTo(logo, { scale: 1 }, { scale: 0.86, ease: 'none', scrollTrigger: { start: 0, end: 140, scrub: 0.4 } }));
    // Шаги «Как это работает»: каскадом, как только показались снизу (до этого их не видно — прятать заранее не нужно)
    const steps = gsap.utils.toArray('.howto__list li');
    const batch = steps.length ? ScrollTrigger.batch(steps, {
      start: 'top bottom', once: true,
      onEnter: (els) => {
        gsap.fromTo(els, { y: 22, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.5, stagger: 0.09, clearProps: 'transform,opacity,visibility' });
        gsap.fromTo(els.map((el) => el.querySelector('.howto__num')).filter(Boolean), { scale: 0 }, { scale: 1, duration: 0.45, delay: 0.25, stagger: 0.09, ease: 'back.out(2.4)', clearProps: 'transform' });
      },
    }) : [];
    return () => {
      made.forEach((t) => { t.scrollTrigger?.kill(); t.kill(); });
      batch.forEach((t) => t.kill());
      gsap.set([img, halal, logo, ...steps].filter(Boolean), { clearProps: 'transform,opacity,visibility' });
    };
  }
  /** Шапка сжимается: способ и адрес в одну строку (класс; высота шапки не меняется — ничего не прыгает). Короткая страница
   *  на компьютере упирается в конец прокрутки — поэтому по scrollY, а не отрезком ScrollTrigger */
  function compactBar() {
    const bar = $('.appbar');
    if (!bar) return () => {};
    let frame = 0;
    const sync = () => { frame = 0; bar.classList.toggle('is-compact', window.scrollY > 90); };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(sync); };
    window.addEventListener('scroll', onScroll, { passive: true });
    sync();
    return () => { window.removeEventListener('scroll', onScroll); cancelAnimationFrame(frame); bar.classList.remove('is-compact'); };
  }

  /* ---------- Шторки: выезд снизу (компьютер — окно по центру), уход вниз ---------- */
  function sheetTween(s, open, done, phone) {
    const { panel, backdrop } = s;
    gsap.killTweensOf([panel, backdrop].filter(Boolean));
    const fromBottom = phone;
    const away = () => (fromBottom ? { y: panel.offsetHeight + 24, autoAlpha: 1 } : { y: 28, autoAlpha: 0 });
    if (open) {
      if (backdrop) gsap.fromTo(backdrop, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.35, ease: 'none', clearProps: 'opacity,visibility' });
      gsap.fromTo(panel, away(), { y: 0, autoAlpha: 1, duration: fromBottom ? 0.55 : 0.4, clearProps: 'transform,opacity,visibility', onComplete: done });
    } else {
      if (backdrop) gsap.to(backdrop, { autoAlpha: 0, duration: 0.3, ease: 'none' });
      gsap.to(panel, { ...away(), duration: 0.35, onComplete: () => {
        gsap.set([panel, backdrop].filter(Boolean), { clearProps: 'transform,opacity,visibility' });
        done();
      } });
    }
  }

  /** Свайп вниз за язычок (телефон): Draggable по y, бросок — своей скоростью, без Inertia */
  function drags() {
    if (!Draggable) return null;
    const list = Object.values(sheets).filter((s) => s.panel && s.grab).map((s) => {
      let lastY = 0, lastT = 0, speed = 0;
      return Draggable.create(s.panel, {
        type: 'y', trigger: s.grab, bounds: { minY: 0, maxY: 4000 }, zIndexBoost: false,
        onPress() { lastY = this.y; lastT = performance.now(); speed = 0; gsap.killTweensOf(s.panel); },
        onDrag() {
          const t = performance.now();
          speed = (this.y - lastY) / Math.max(1, t - lastT);
          lastY = this.y;
          lastT = t;
        },
        onRelease() {
          if (this.y > 110 || (speed > 0.7 && this.y > 30)) closeByUser(s.name);
          else if (this.y) gsap.to(s.panel, { y: 0, duration: 0.4, clearProps: 'transform' });
        },
      })[0];
    });
    hooks.drag = true;
    return () => { list.forEach((d) => d.kill()); hooks.drag = false; };
  }

  /* ---------- Корзина: копия фото летит дугой в панель, панель подпрыгивает, сумма перекатывается ---------- */
  const visible = (el) => el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[hidden]');
  function bounce(el) {
    gsap.fromTo(el, { y: 0 }, { keyframes: { y: [0, -10, 0, -3, 0] }, duration: 0.55, ease: 'none', clearProps: 'transform' });
  }
  function fly(from) {
    const img = $('[data-product-photo]');
    const bar = $('.cartbar__btn');
    const onBar = visible(bar) && getComputedStyle($('.cartbar')).display !== 'none';
    const sheet = $('[data-order-sheet]');
    const dest = onBar ? bar : sheet;
    if (!dest) return;
    const spot = onBar ? bar : ($('[data-order-card] .qty') || sheet);
    if (!img || !MotionPathPlugin) { bounce(dest); return; }
    const a = from || img.getBoundingClientRect();
    const b = spot.getBoundingClientRect();
    const size = 64;
    const sx = a.left + a.width / 2, sy = a.top + a.height / 2;
    const tx = onBar ? b.left + 44 : b.left + b.width / 2, ty = b.top + b.height / 2;
    const ghost = document.createElement('img');
    ghost.src = img.currentSrc || img.src;
    ghost.alt = '';
    ghost.className = 'flyer';
    ghost.setAttribute('aria-hidden', 'true');
    ghost.style.left = `${sx - size / 2}px`;
    ghost.style.top = `${sy - size / 2}px`;
    document.body.append(ghost);
    const dx = tx - sx, dy = ty - sy;
    gsap.timeline({ onComplete: () => { ghost.remove(); bounce(dest); } })
      .fromTo(ghost, { scale: 0.3, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.2, ease: 'none' }, 0)
      .to(ghost, { duration: 0.8, motionPath: { path: [{ x: 0, y: 0 }, { x: dx * 0.25, y: Math.min(0, dy) - 120 }, { x: dx, y: dy }], curviness: 1.3 } }, 0.05)
      .to(ghost, { scale: 0.35, duration: 0.8 }, 0.05)
      .to(ghost, { autoAlpha: 0, duration: 0.15, ease: 'none' }, 0.72);
  }
  // «+» в меню: летит фото (оно на экране) или от самой кнопки
  $('.stepper--menu [data-qty="1"]')?.addEventListener('click', (e) => {
    if (!hooks.added) return;
    const photo = $('[data-product-photo]')?.getBoundingClientRect();
    const seen = photo && photo.bottom > 80 && photo.top < innerHeight - 80;
    hooks.added(seen ? null : e.currentTarget.getBoundingClientRect());
  });

  function roll(el, from, to, format) {
    if (el.__roll) el.__roll.kill();
    const o = { v: from };
    el.__roll = gsap.to(o, { v: to, duration: 0.5, onUpdate: () => { el.textContent = format(Math.round(o.v)); }, onComplete: () => { el.textContent = format(to); el.__roll = null; } });
  }
  const tick = (el) => gsap.fromTo(el, { yPercent: 70, autoAlpha: 0 }, { yPercent: 0, autoAlpha: 1, duration: 0.35, clearProps: 'transform,opacity,visibility' });

  /* ---------- Бегунки: панель вкладок, «Доставка / Самовывоз» на главной и сегменты формы (если у них есть бегунок) ---------- */
  function flip(el, change) {
    if (!Flip) { change(); return; }
    const state = Flip.getState(el);
    change();
    Flip.from(state, { duration: 0.4 });
  }

  /* ---------- Живой фон: два «огонька» под карточками медленно плывут. Недолго — около 40 секунд после входа и после
     каждой смены экрана: движение, которое не останавливается само, мешает читать ---------- */
  function ambient() {
    const glows = gsap.utils.toArray('.ambient__glow');
    if (!glows.length) return () => {};
    let tweens = [];
    const drift = () => {
      tweens.forEach((t) => t.kill());
      tweens = glows.map((g, i) => gsap.fromTo(g, { x: 0, y: 0, scale: 1 },
        { x: i ? 52 : -44, y: i ? -34 : 48, scale: i ? 1.14 : 0.88, duration: i ? 11 : 9, ease: 'sine.inOut', repeat: 3, yoyo: true }));
    };
    // Один раз после входа: перезапуск на каждой смене вкладки нагружал слабые телефоны
    drift();
    return () => {
      tweens.forEach((t) => t.kill());
      gsap.set(glows, { clearProps: 'transform' });
    };
  }

  /* ---------- Экран вкладки: лист въезжает с той стороны, куда ушли, карточки — каскадом; значок вкладки пружинит ---------- */
  function screenIn(el, dir) {
    const body = $('.screen__body', el);
    const title = $('.screen__title', el);
    gsap.killTweensOf([body, title].filter(Boolean));
    if (title) gsap.fromTo(title, { x: 18 * dir, autoAlpha: 0 }, { x: 0, autoAlpha: 1, duration: 0.4, clearProps: 'transform,opacity,visibility' });
    if (body) {
      const cards = [...body.children].filter((c) => c.getClientRects().length).slice(0, 8);
      gsap.fromTo(cards, { y: 18, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.4, stagger: 0.045, clearProps: 'transform,opacity,visibility' });
    }
    const mark = $('.tabbar__tab[aria-current="page"] .ico');
    if (mark) gsap.fromTo(mark, { scale: 0.72 }, { scale: 1, duration: 0.5, ease: 'back.out(2.6)', clearProps: 'transform' });
  }
  function segments() {
    if (!Flip) return () => {};
    const THUMB = '.seg__thumb, [data-seg-thumb]';
    let pending = null;
    const before = (e) => {
      const thumb = e.target.closest?.('fieldset, .seg, [role="radiogroup"]')?.querySelector(THUMB);
      pending = thumb ? { thumb, state: Flip.getState(thumb) } : null;
    };
    const after = (e) => {
      if (pending && pending.thumb.parentElement?.contains(e.target)) Flip.from(pending.state, { duration: 0.45 });
      pending = null;
    };
    document.addEventListener('pointerdown', before, true);
    document.addEventListener('keydown', before, true);
    document.addEventListener('change', after);
    return () => {
      document.removeEventListener('pointerdown', before, true);
      document.removeEventListener('keydown', before, true);
      document.removeEventListener('change', after);
    };
  }

  /* ---------- Микро: нажатие — лёгкое сжатие (кнопки .btn сжимает их собственный CSS) ---------- */
  function press() {
    const SEL = '.cartbar__btn, .modechip, .activebar, .langswitch button, .sheet__close, .tabbar__tab, .homeseg__btn, .row, .stepper button';
    let pressed = null;
    // Обычный твин с перезаписью: quickTo не умеет составное свойство scale (сжатия не было, в консоли — предупреждения)
    const scaleTo = (el, v) => gsap.to(el, { scale: v, duration: 0.25, overwrite: 'auto', ...(v === 1 ? { clearProps: 'scale' } : {}) });
    const down = (e) => { const el = e.target.closest?.(SEL); if (el) { pressed = el; scaleTo(el, 0.96); } };
    const up = () => { if (pressed) { scaleTo(pressed, 1); pressed = null; } };
    document.addEventListener('pointerdown', down);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', up);
    return () => {
      document.removeEventListener('pointerdown', down);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', up);
    };
  }

  const mm = gsap.matchMedia();
  mm.add({ motion: '(prefers-reduced-motion: no-preference)', phone: '(max-width: 1023.98px)' }, (ctx) => {
    const { motion, phone } = ctx.conditions;
    if (!motion) return undefined;
    // Сбой анимации не должен оставить фото или заголовок спрятанными: вход откатываем — всё на своих местах
    try { intro(); } catch (err) {
      split?.revert(); split = null;
      gsap.set('.eta, .reorder, .combo__photo, .combo__photo img, .combo__halal, .combo__list li', { clearProps: 'all' });
      console.warn(err);
    }
    let stopScene = () => {};
    try { stopScene = scrollScene(); } catch (err) { console.warn(err); }
    hooks.sheet = (s, open, done) => sheetTween(s, open, done, phone);
    hooks.added = fly;
    hooks.roll = roll;
    hooks.tick = tick;
    hooks.flip = flip;
    hooks.screen = screenIn;
    const stopDrag = phone ? drags() : null;
    const stopSegments = segments();
    const stopPress = press();
    const stopBar = compactBar();
    let stopAmbient = () => {};
    try { stopAmbient = ambient(); } catch (err) { console.warn(err); }
    return () => {
      Object.assign(hooks, { sheet: null, added: null, roll: null, tick: null, flip: null, screen: null });
      stopAmbient();
      stopScene();
      stopBar();
      stopDrag?.();
      stopSegments();
      stopPress();
    };
  });

  // Высота страницы поменялась (плашка заказа, «Добавить к заказу», другой язык, шрифты) — пересчитать сцены прокрутки
  let refreshTimer = 0;
  const refresh = () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => ScrollTrigger?.refresh(), 150); };
  window.addEventListener('kokoro:layout', refresh);
  onLang(refresh);
  document.fonts?.ready.then(refresh);
}
