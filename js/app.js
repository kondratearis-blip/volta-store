// Точка входа: запуск интерфейса и офлайн-режим.
(function () {
  window.HQ.ui.start();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => { /* офлайн-режим недоступен — приложение работает и так */ });
    });
  }
})();
