/*
 * Чиби-персонажи (фан-арт по мотивам Hunter x Hunter), нарисованные вручную в SVG.
 * chibi(id, mood) возвращает строку <svg>. mood: neutral | happy | sad | smirk | angry
 */
(function (root) {
  const HQ = root.HQ = root.HQ || {};

  const SKIN = '#ffe0c8';
  const LINE = '#2a2033';

  function eyes(color, mood, opts = {}) {
    if (mood === 'happy') {
      return `<path d="M35,61 Q40,54 45,61" fill="none" stroke="${LINE}" stroke-width="2.4" stroke-linecap="round"/>
              <path d="M55,61 Q60,54 65,61" fill="none" stroke="${LINE}" stroke-width="2.4" stroke-linecap="round"/>`;
    }
    if (opts.closed) {
      return `<path d="M35,60 Q40,62 45,60" fill="none" stroke="${LINE}" stroke-width="2" stroke-linecap="round"/>
              <path d="M55,60 Q60,62 65,60" fill="none" stroke="${LINE}" stroke-width="2" stroke-linecap="round"/>`;
    }
    const ry = opts.narrow ? 4.6 : 6;
    const one = (cx) => `
      <ellipse cx="${cx}" cy="60" rx="4.8" ry="${ry}" fill="${color}"/>
      <ellipse cx="${cx}" cy="61" rx="2.6" ry="${ry - 2.4}" fill="${LINE}"/>
      <circle cx="${cx - 1.6}" cy="${60 - ry / 2.6}" r="1.7" fill="#fff"/>
      <path d="M${cx - 5.6},${60 - ry + 0.6} Q${cx},${60 - ry - 2.6} ${cx + 5.6},${60 - ry + 0.6}" fill="none" stroke="${LINE}" stroke-width="2" stroke-linecap="round"/>`;
    return one(40) + one(60);
  }

  function brows(mood, color = LINE) {
    const d = {
      sad:   ['M34,50 L44,48', 'M56,48 L66,50'],
      angry: ['M34,47 L44,51', 'M56,51 L66,47'],
      smirk: ['M34,49 L44,49', 'M56,47 L66,49'],
    }[mood] || ['M34,49 Q39,47 44,49', 'M56,49 Q61,47 66,49'];
    return d.map((p) => `<path d="${p}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round"/>`).join('');
  }

  function mouth(mood) {
    switch (mood) {
      case 'happy': return `<path d="M43,70 Q50,80 57,70 Z" fill="#b8323f"/><path d="M46,74 Q50,78 54,74" fill="#ff8a95"/>`;
      case 'sad':   return `<path d="M45,75 Q50,70 55,75" fill="none" stroke="${LINE}" stroke-width="1.8" stroke-linecap="round"/>`;
      case 'smirk': return `<path d="M44,72 Q51,76 56,70" fill="none" stroke="${LINE}" stroke-width="1.8" stroke-linecap="round"/>`;
      case 'angry': return `<path d="M45,74 L55,74" fill="none" stroke="${LINE}" stroke-width="1.8" stroke-linecap="round"/>`;
      default:      return `<path d="M46,72 Q50,75 54,72" fill="none" stroke="${LINE}" stroke-width="1.8" stroke-linecap="round"/>`;
    }
  }

  function face(o, mood) {
    return `
      <rect x="45" y="78" width="10" height="10" fill="${SKIN}"/>
      <ellipse cx="22" cy="60" rx="4.5" ry="${o.longEars ? 9 : 6}" fill="${SKIN}"/>
      <ellipse cx="78" cy="60" rx="4.5" ry="${o.longEars ? 9 : 6}" fill="${SKIN}"/>
      <ellipse cx="50" cy="55" rx="28" ry="27" fill="${SKIN}"/>
      ${o.noBrows ? '' : brows(mood, o.browColor)}
      ${o.eyesSvg || eyes(mood === 'angry' && o.angryEyes ? o.angryEyes : o.eyeColor, mood, o)}
      <ellipse cx="33" cy="67" rx="4" ry="2.2" fill="#ff8fa0" opacity=".55"/>
      <ellipse cx="67" cy="67" rx="4" ry="2.2" fill="#ff8fa0" opacity=".55"/>
      ${o.mouthSvg ? o.mouthSvg(mood) : mouth(mood)}`;
  }

  const torso = (fill) => `<path d="M26,120 C26,98 35,86 50,86 C65,86 74,98 74,120 Z" fill="${fill}"/>`;

  const DEFS = {
    gon: {
      name: 'Гон', role: 'Наставник Тела',
      eyeColor: '#8a5a2b',
      body: () => `${torso('#2f9e5f')}
        <path d="M40,87 L50,100 L60,87" fill="none" stroke="#1f7144" stroke-width="3"/>
        <circle cx="50" cy="106" r="2" fill="#f2c14e"/>`,
      hair: `<path d="M21,58 L14,40 L3,31 L19,28 L13,9 L31,19 L35,1 L47,15 L58,0 L63,17 L81,7 L77,25 L96,28 L85,40 L79,58
                L76,42 L70,46 L65,35 L57,43 L50,33 L43,43 L36,35 L30,46 L24,42 Z" fill="#1d1a24"/>
             <path d="M47,15 L50,33 M63,17 L57,43 M31,19 L36,35" stroke="#2f6b48" stroke-width="2" fill="none"/>`,
    },
    killua: {
      name: 'Киллуа', role: 'Наставник Разума',
      eyeColor: '#3d8bfd', narrow: true,
      body: () => `${torso('#3a3f6e')}
        <path d="M38,90 Q50,96 62,90" fill="none" stroke="#e9e9f5" stroke-width="3"/>
        <path d="M70,96 L76,104 L72,104 L78,114" fill="none" stroke="#7fc8ff" stroke-width="2.2" stroke-linejoin="round"/>`,
      hair: `<path d="M19,62 L6,52 L14,45 L2,35 L16,31 L8,16 L26,21 L26,4 L40,14 L50,1 L58,13 L72,4 L73,21 L92,15 L85,31 L98,36 L86,45 L94,54 L81,62
                L77,44 L71,49 L65,37 L58,46 L50,35 L43,46 L36,37 L30,49 L23,44 Z" fill="#f1f1f8" stroke="#b8b4d8" stroke-width="1.4" stroke-linejoin="round"/>`,
    },
    kurapika: {
      name: 'Курапика', role: 'Наставник Духа',
      eyeColor: '#5d7fb5', angryEyes: '#e3263c',
      hairBack: `<path d="M18,80 C12,44 26,20 50,20 C74,20 88,44 82,80 Z" fill="#f2cd5c"/>`,
      body: () => `${torso('#2d5cb0')}
        <path d="M42,86 L42,120 M58,86 L58,120" stroke="#f2c14e" stroke-width="2.4"/>
        <path d="M44,100 L50,94 L56,100 L50,106 Z" fill="#f2c14e"/>
        <path d="M21,66 Q19,72 21,76 Q23,72 21,66 Z" fill="#d61f3a"/>`,
      hair: `<path d="M18,78 C14,42 28,22 50,22 C72,22 86,42 82,78 L76,78 C77,62 75,52 72,46 L67,49 L61,41 L55,47 L49,39 L43,47 L37,41 L31,49 C27,54 25,62 25,78 Z"
                fill="#f6d46a" stroke="#d6a73a" stroke-width="1.2"/>`,
    },
    leorio: {
      name: 'Леорио', role: 'Наставник Финансов',
      eyeColor: '#3b3b3b',
      eyesSvg: `<circle cx="40" cy="60" r="6.4" fill="#232338" stroke="#d9b54a" stroke-width="1.4"/>
                <circle cx="60" cy="60" r="6.4" fill="#232338" stroke="#d9b54a" stroke-width="1.4"/>
                <path d="M46.4,60 L53.6,60" stroke="#d9b54a" stroke-width="1.4"/>
                <path d="M36,57 L39,55" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>
                <path d="M56,57 L59,55" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>`,
      body: () => `${torso('#26305c')}
        <path d="M42,86 L50,104 L58,86 Z" fill="#f4f4f8"/>
        <path d="M48,90 L52,90 L53,104 L50,108 L47,104 Z" fill="#3a7bd5"/>
        <rect x="66" y="104" width="14" height="10" rx="2" fill="#7a4b2a"/>`,
      hair: `<path d="M21,54 C19,28 34,18 52,18 C70,18 82,28 79,52 L76,42 C70,34 61,32 54,33 L58,26 L48,32 C40,32 30,35 25,43 Z" fill="#1d1a24"/>`,
    },
    netero: {
      name: 'Нетеро', role: 'Великий мастер',
      eyeColor: '#3b3b3b', closed: true, longEars: true, browColor: '#f4f4f4', noBrows: true,
      body: () => `${torso('#f2f0ea')}
        <text x="50" y="114" text-anchor="middle" font-size="12" font-weight="700" fill="#1d1a24" font-family="serif">心</text>`,
      hair: `<circle cx="50" cy="26" r="5" fill="#f4f4f4" stroke="#d0d0d0" stroke-width="1"/>
             <path d="M44,48 Q34,46 22,56 Q32,52 44,52 Z" fill="#f7f7f7" stroke="#cfcfcf" stroke-width=".8"/>
             <path d="M56,48 Q66,46 78,56 Q68,52 56,52 Z" fill="#f7f7f7" stroke="#cfcfcf" stroke-width=".8"/>`,
      mouthSvg: (mood) => `
        <path d="M33,68 Q50,76 67,68 Q66,94 50,114 Q34,94 33,68 Z" fill="#f7f7f7" stroke="#d6d6d6" stroke-width="1"/>
        <path d="M50,70 Q42,68 36,73 M50,70 Q58,68 64,73" fill="none" stroke="#d0d0d0" stroke-width="2"/>
        ${mood === 'happy' ? '<path d="M45,74 Q50,79 55,74" fill="none" stroke="#2a2033" stroke-width="1.6" stroke-linecap="round"/>' : ''}`,
    },
  };

  function chibi(id, mood = 'neutral') {
    const o = DEFS[id] || DEFS.gon;
    return `<svg viewBox="0 0 100 120" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${o.name}">
      ${o.hairBack || ''}${o.body()}${face(o, mood)}${o.hair}</svg>`;
  }

  const LINES = {
    gon: {
      greet: ['Ош! Сегодня отличный день, чтобы стать сильнее!', 'Пойдём вперёд вместе! Я уже размялся.', 'Если долго идти, обязательно дойдёшь. Начнём?'],
      done: ['Круто! Ты становишься сильнее!', 'Йес! Ещё одно задание позади!', 'Вот это да! Давай следующее!'],
      miss: ['Ничего страшного. Завтра попробуем вместе ещё раз!', 'Даже я иногда падаю. Главное — встать.'],
    },
    killua: {
      greet: ['Хех. Посмотрим, на что ты способен сегодня.', 'Скучно? Тогда давай ускоримся ⚡', 'Фокус — это как Божественная скорость. Включай.'],
      done: ['Неплохо. Но я знаю, ты можешь лучше.', 'Быстро сработано. Мне нравится.', 'Хм, а ты не так прост.'],
      miss: ['Отвлёкся? Бывает. Только не делай из этого привычку.', 'Даже убийцы ошибаются. Ну, иногда.'],
    },
    kurapika: {
      greet: ['Дисциплина — это клятва, которую даёшь себе.', 'Тихий ум видит дальше. Начнём с малого.', 'Сила рождается из ограничений.'],
      done: ['Ты держишь своё слово. Это ценно.', 'Хорошо. Шаг за шагом.', 'Я вижу, как крепнет твой дух.'],
      miss: ['Мои глаза краснеют... Не нарушай клятву.', 'Ошибка — это урок, если её признать.'],
    },
    leorio: {
      greet: ['Деньги — инструмент. Я коплю, чтобы стать врачом!', 'Каждая монета — шаг к мечте!', 'Эй, не трать всё на ерунду, договорились?'],
      done: ['Вот это я понимаю! Мечта стала ближе!', 'Отлично! Прямо как сдать экзамен!', 'Так держать, партнёр!'],
      miss: ['Ну и ладно, с кем не бывает. Завтра отыграемся!'],
    },
    netero: {
      greet: ['Хо-хо! Каждый день начинай с благодарности.', 'Мой путь начался с десяти тысяч ударов. Твой — с одного задания.', 'Не спеши, юный Хантер. Но и не стой на месте.'],
      done: ['Хо-хо! Отличная работа.', 'Вот так и растёт Нэн.', 'Старик доволен.'],
      miss: ['Даже мастер когда-то проигрывал. Вставай.', 'Хм. Аура немного ослабла. Ничего, восстановим.'],
    },
  };

  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  function line(id, kind) { return pick((LINES[id] || LINES.gon)[kind] || LINES.gon.greet); }

  HQ.chars = { chibi, line, DEFS, LIST: ['gon', 'killua', 'kurapika', 'leorio', 'netero'] };
})(typeof self !== 'undefined' ? self : this);
