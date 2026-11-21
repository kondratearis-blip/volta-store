// Ставится в <head> обычным скриптом, файлом (CSP сайта запрещает встроенные скрипты): класс js на <html> — для стилей,
// которым нужен JavaScript (шторки), и язык, выбранный покупателем, до первой отрисовки (specs/018, i18n.js)
(function () {
  var root = document.documentElement;
  root.classList.add('js');
  try { if (localStorage.getItem('kokoro.lang') === 'ky') root.lang = 'ky'; } catch (e) { /* приватный режим */ }
  // Открыто в приложении из магазина: Capacitor на iPhone (мост ставится до страницы) или Android-приложение, которое
  // открывает сайт с меткой ?app=twa в стартовом адресе (app-store.md). Не по referrer android-app:// — так же приходят ссылки из
  // мессенджеров. Запоминаем на время работы приложения — дальше переходы внутри сайта уже без метки
  try {
    var inApp = (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform())
      || /[?&]app=(twa|ios)\b/.test(location.search) || sessionStorage.getItem('kokoro.inapp') === '1';
    if (inApp) { root.classList.add('in-app'); sessionStorage.setItem('kokoro.inapp', '1'); }
  } catch (e) { /* приватный режим */ }
  // Там, где нет системного шрифта Apple (Android, Windows), Inter нужен для первого экрана — просим его сразу, а не после стилей
  if (!/iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent)) {
    ['inter-cyrillic', 'inter-latin'].forEach(function (name) {
      var link = document.createElement('link');
      link.rel = 'preload'; link.as = 'font'; link.type = 'font/woff2'; link.crossOrigin = 'anonymous';
      link.href = 'assets/fonts/' + name + '.woff2';
      document.head.appendChild(link);
    });
  }
  // Уже заказывали с этого телефона — место под карточку «Как в прошлый раз» есть до отрисовки: главная не «прыгает» (specs/025)
  try { if ((JSON.parse(localStorage.getItem('kokoro.history') || '[]') || []).length) root.classList.add('has-history'); } catch (e) { /* нет истории */ }
})();
