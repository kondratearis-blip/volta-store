/*
 * Стартовое интервью. Каждая глава ведётся своим наставником.
 *
 * Типы вопросов: single, multi, scale, text, number.
 * sphere + w — вклад ответа в оценку сферы (0..100), s — значение варианта 0..1.
 * tags — метки, по которым подбираются задания (см. js/data/tasks.js).
 * field — ответ записывается в профиль напрямую.
 */
(function (root) {
  const HQ = root.HQ = root.HQ || {};

  const CHAPTERS = [
    { id: 'intro',  title: 'Экзамен на Хантера', mentor: 'netero',
      text: 'Хо-хо! Новый кандидат. Прежде чем выдать тебе лицензию, я задам много вопросов. Отвечай честно: от этого зависят твои задания.' },
    { id: 'body',   title: 'Тело', mentor: 'gon', sphere: 'body',
      text: 'Ош! Я Гон. Давай поговорим про сон, движение и еду. Сильное тело — это фундамент всего!' },
    { id: 'mind',   title: 'Разум', mentor: 'killua', sphere: 'mind',
      text: 'Я Киллуа. Проверим, насколько остёр твой ум: учёба, фокус, телефон. Не ври, я замечу.' },
    { id: 'spirit', title: 'Дух', mentor: 'kurapika', sphere: 'spirit',
      text: 'Меня зовут Курапика. Сила духа — в ясной цели, близких людях и спокойном сердце. Поговорим об этом.' },
    { id: 'money',  title: 'Финансы', mentor: 'leorio',
      text: 'Леорио на связи! Я коплю, чтобы выучиться на врача. Расскажи, как у тебя с деньгами и о чём мечтаешь.' },
    { id: 'habits', title: 'Тёмная сторона', mentor: 'netero',
      text: 'У каждого есть привычки, которые крадут силу. Назови их — и мы начнём битву.' },
    { id: 'nen',    title: 'Пробуждение Нэн', mentor: 'netero',
      text: 'Последнее испытание. Гадание на воде покажет твой тип Нэн.' },
  ];

  const QUESTIONS = [
    // ——— Вступление ———
    { id: 'name', ch: 'intro', type: 'text', field: 'name', q: 'Как тебя зовут, юный кандидат?', placeholder: 'Имя или ник' },
    { id: 'age', ch: 'intro', type: 'single', field: 'age', q: 'Сколько тебе лет?', options: [
      { v: 'u18', label: 'До 18' }, { v: '18', label: '18–24' }, { v: '25', label: '25–34' },
      { v: '35', label: '35–44' }, { v: '45', label: '45+' } ] },
    { id: 'focus', ch: 'intro', type: 'multi', q: 'Что для тебя сейчас важнее всего?', hint: 'Можно выбрать несколько', options: [
      { v: 'body', label: 'Здоровье и энергия', tags: ['focus_body'] },
      { v: 'mind', label: 'Ум, учёба, карьера', tags: ['focus_mind'] },
      { v: 'spirit', label: 'Спокойствие и смысл', tags: ['focus_spirit'] },
      { v: 'money', label: 'Деньги и накопления', tags: ['focus_money', 'finance'] },
      { v: 'rel', label: 'Отношения и друзья', tags: ['focus_rel'] },
      { v: 'habits', label: 'Избавиться от вредного', tags: ['focus_habits'] } ] },
    { id: 'minutes', ch: 'intro', type: 'single', field: 'dailyMinutes', q: 'Сколько времени в день готов уделять развитию?', options: [
      { v: 15, label: '15 минут' }, { v: 30, label: '30 минут' }, { v: 60, label: 'Около часа' }, { v: 120, label: '2 часа и больше' } ] },
    { id: 'difficulty', ch: 'intro', type: 'single', field: 'difficulty', q: 'Какой режим игры выбираешь?', options: [
      { v: 'easy', label: 'Спокойный', note: 'Штрафы вдвое меньше' },
      { v: 'normal', label: 'Хантер', note: 'Баланс наград и штрафов' },
      { v: 'hard', label: 'Хардкор', note: '+25% к наградам, но штрафы ×1.5' } ] },

    // ——— Тело ———
    { id: 'sleep_h', ch: 'body', type: 'single', sphere: 'body', w: 2, q: 'Сколько ты обычно спишь?', options: [
      { v: 5, label: 'Меньше 6 часов', s: 0, tags: ['low_sleep'] }, { v: 6, label: '6–7 часов', s: 0.5, tags: ['low_sleep'] },
      { v: 7, label: '7–8 часов', s: 1 }, { v: 8, label: '8–9 часов', s: 0.9 }, { v: 9, label: 'Больше 9', s: 0.6 } ] },
    { id: 'sleep_reg', ch: 'body', type: 'single', sphere: 'body', w: 1, q: 'Во сколько ложишься спать?', options: [
      { v: 'same', label: 'Примерно в одно время, до полуночи', s: 1 },
      { v: 'vary', label: 'Каждый день по-разному', s: 0.4, tags: ['irregular_sleep'] },
      { v: 'owl', label: 'Сова: после часа ночи', s: 0.1, tags: ['late_sleep'] } ] },
    { id: 'activity', ch: 'body', type: 'single', sphere: 'body', w: 2, q: 'Как часто ты тренируешься?', options: [
      { v: 0, label: 'Почти никогда', s: 0, tags: ['sedentary', 'beginner'] }, { v: 1, label: '1–2 раза в неделю', s: 0.4, tags: ['beginner'] },
      { v: 3, label: '3–4 раза в неделю', s: 0.8 }, { v: 5, label: '5+ раз в неделю', s: 1, tags: ['athlete'] } ] },
    { id: 'sports', ch: 'body', type: 'multi', q: 'Что из этого тебе нравится или хочется попробовать?', hint: 'Можно выбрать несколько', options: [
      { v: 'run', label: 'Бег', tags: ['run'] }, { v: 'gym', label: 'Зал', tags: ['gym'] },
      { v: 'swim', label: 'Плавание', tags: ['swim'] }, { v: 'yoga', label: 'Йога, растяжка', tags: ['yoga'] },
      { v: 'martial', label: 'Единоборства', tags: ['martial'] }, { v: 'bike', label: 'Велосипед', tags: ['bike'] },
      { v: 'walk', label: 'Прогулки', tags: ['walk'] }, { v: 'dance', label: 'Танцы', tags: ['dance'] },
      { v: 'home', label: 'Домашние тренировки', tags: ['home'] }, { v: 'team', label: 'Командный спорт', tags: ['team'] } ] },
    { id: 'steps', ch: 'body', type: 'single', sphere: 'body', w: 1, q: 'Сколько ты ходишь пешком в день?', options: [
      { v: 2, label: 'Меньше 3 000 шагов', s: 0, tags: ['sedentary'] }, { v: 5, label: '3–7 тысяч', s: 0.5 },
      { v: 8, label: '7–10 тысяч', s: 0.8 }, { v: 10, label: 'Больше 10 тысяч', s: 1 }, { v: 0, label: 'Не знаю', s: 0.4 } ] },
    { id: 'sitting', ch: 'body', type: 'single', sphere: 'body', w: 1, q: 'Сколько часов в день проводишь сидя?', options: [
      { v: 3, label: 'Меньше 4', s: 1 }, { v: 6, label: '4–8 часов', s: 0.5, tags: ['desk'] },
      { v: 9, label: 'Больше 8', s: 0.1, tags: ['desk', 'sedentary'] } ] },
    { id: 'food', ch: 'body', type: 'scale', sphere: 'body', w: 2, q: 'Насколько здорово ты питаешься?',
      labels: ['Фастфуд и хаос', 'Чисто и сбалансированно'], lowTags: ['poor_food'] },
    { id: 'water', ch: 'body', type: 'single', sphere: 'body', w: 1, q: 'Сколько воды выпиваешь за день?', options: [
      { v: 0.5, label: 'Меньше литра', s: 0, tags: ['low_water'] }, { v: 1.5, label: '1–2 литра', s: 0.6 }, { v: 2, label: 'Больше 2 литров', s: 1 } ] },
    { id: 'energy', ch: 'body', type: 'scale', sphere: 'body', w: 2, q: 'Сколько у тебя энергии в течение дня?',
      labels: ['Еле живой', 'Полон сил'], lowTags: ['low_energy'] },
    { id: 'body_goal', ch: 'body', type: 'multi', q: 'Какая цель для тела?', hint: 'Можно выбрать несколько', options: [
      { v: 'lose', label: 'Похудеть', tags: ['lose_weight'] }, { v: 'muscle', label: 'Набрать мышцы', tags: ['gain_muscle'] },
      { v: 'endurance', label: 'Выносливость', tags: ['endurance'] }, { v: 'flex', label: 'Гибкость', tags: ['flexibility'] },
      { v: 'posture', label: 'Осанка, спина', tags: ['posture'] }, { v: 'health', label: 'Просто здоровье', tags: ['health'] } ] },
    { id: 'health_limit', ch: 'body', type: 'single', q: 'Есть ли ограничения по здоровью для нагрузок?', options: [
      { v: 'no', label: 'Нет' }, { v: 'yes', label: 'Есть, нужны мягкие нагрузки', tags: ['health_limit'] } ] },

    // ——— Разум ———
    { id: 'reading', ch: 'mind', type: 'single', sphere: 'mind', w: 2, q: 'Как часто ты читаешь книги?', options: [
      { v: 0, label: 'Почти не читаю', s: 0, tags: ['no_reading'] }, { v: 1, label: 'Иногда', s: 0.4 },
      { v: 2, label: 'Книга в месяц', s: 0.8 }, { v: 3, label: 'Больше книги в месяц', s: 1, tags: ['reader'] } ] },
    { id: 'learn', ch: 'mind', type: 'multi', q: 'Что тебе интересно изучать?', hint: 'Можно выбрать несколько', options: [
      { v: 'lang', label: 'Иностранные языки', tags: ['lang'] }, { v: 'code', label: 'Программирование', tags: ['code'] },
      { v: 'finance', label: 'Финансы, инвестиции', tags: ['finance'] }, { v: 'psych', label: 'Психология', tags: ['psych'] },
      { v: 'history', label: 'История, культура', tags: ['history'] }, { v: 'science', label: 'Наука', tags: ['science'] },
      { v: 'art', label: 'Рисование, дизайн', tags: ['art'] }, { v: 'music', label: 'Музыка', tags: ['music'] },
      { v: 'business', label: 'Бизнес', tags: ['business'] } ] },
    { id: 'focus_q', ch: 'mind', type: 'scale', sphere: 'mind', w: 2, q: 'Насколько легко тебе сосредоточиться на одном деле?',
      labels: ['Отвлекаюсь каждую минуту', 'Могу работать часами'], lowTags: ['low_focus'] },
    { id: 'screen', ch: 'mind', type: 'single', sphere: 'mind', w: 2, q: 'Сколько времени в день уходит на телефон и соцсети (не по работе)?', options: [
      { v: 1, label: 'Меньше 2 часов', s: 1 }, { v: 3, label: '2–4 часа', s: 0.6 },
      { v: 5, label: '4–6 часов', s: 0.3, tags: ['high_screen'] }, { v: 7, label: 'Больше 6 часов', s: 0, tags: ['high_screen'] } ] },
    { id: 'planning', ch: 'mind', type: 'single', sphere: 'mind', w: 1, q: 'Ты планируешь свой день?', options: [
      { v: 'yes', label: 'Да, каждый день', s: 1, tags: ['planner'] }, { v: 'some', label: 'Иногда', s: 0.5 },
      { v: 'no', label: 'Живу спонтанно', s: 0.1, tags: ['no_plan'] } ] },
    { id: 'procrast', ch: 'mind', type: 'scale', sphere: 'mind', w: 1, invert: true, q: 'Как часто ты откладываешь важные дела?',
      labels: ['Почти никогда', 'Постоянно'], highTags: ['procrastinator'] },
    { id: 'work_sat', ch: 'mind', type: 'scale', sphere: 'mind', w: 1, q: 'Насколько тебе нравится твоя работа или учёба?',
      labels: ['Ненавижу', 'Обожаю'], lowTags: ['career_change'] },
    { id: 'stress', ch: 'mind', type: 'scale', sphere: 'mind', w: 1, invert: true, q: 'Какой у тебя уровень стресса?',
      labels: ['Спокоен', 'На пределе'], highTags: ['high_stress'] },
    { id: 'career', ch: 'mind', type: 'text', field: 'career', optional: true, q: 'Каким ты хочешь стать в профессии через год?', placeholder: 'Например: стать middle-разработчиком' },
    { id: 'skill', ch: 'mind', type: 'text', field: 'dreamSkill', optional: true, q: 'Какой навык ты мечтаешь освоить в этом году?', placeholder: 'Например: гитара, английский, рисование' },

    // ——— Дух ———
    { id: 'meditation', ch: 'spirit', type: 'single', sphere: 'spirit', w: 1, q: 'Есть ли у тебя опыт медитации?', options: [
      { v: 0, label: 'Никогда не пробовал', s: 0.2, tags: ['no_meditation'] }, { v: 1, label: 'Пробовал пару раз', s: 0.4, tags: ['no_meditation'] },
      { v: 2, label: 'Иногда практикую', s: 0.7 }, { v: 3, label: 'Регулярно', s: 1, tags: ['meditator'] } ] },
    { id: 'gratitude', ch: 'spirit', type: 'single', sphere: 'spirit', w: 1, q: 'Как часто ты замечаешь, за что благодарен?', options: [
      { v: 0, label: 'Редко', s: 0.1 }, { v: 1, label: 'Иногда', s: 0.5 }, { v: 2, label: 'Каждый день', s: 1 } ] },
    { id: 'family', ch: 'spirit', type: 'scale', sphere: 'spirit', w: 1, q: 'Как ты оцениваешь отношения с семьёй?', labels: ['Очень сложно', 'Тепло и близко'], lowTags: ['family_issue'] },
    { id: 'friends', ch: 'spirit', type: 'scale', sphere: 'spirit', w: 1, q: 'Есть ли рядом друзья, на которых можно положиться?', labels: ['Чувствую одиночество', 'Да, надёжные друзья'], lowTags: ['lonely'] },
    { id: 'purpose', ch: 'spirit', type: 'scale', sphere: 'spirit', w: 2, q: 'Насколько ясно ты понимаешь, зачем живёшь и куда идёшь?', labels: ['Совсем не понимаю', 'Абсолютно ясно'], lowTags: ['low_purpose'] },
    { id: 'emotions', ch: 'spirit', type: 'scale', sphere: 'spirit', w: 1, q: 'Насколько хорошо ты справляешься с эмоциями?', labels: ['Эмоции управляют мной', 'Я управляю эмоциями'], lowTags: ['emotions'] },
    { id: 'nature', ch: 'spirit', type: 'single', sphere: 'spirit', w: 1, q: 'Как часто ты бываешь на природе?', options: [
      { v: 0, label: 'Почти не бываю', s: 0, tags: ['low_nature'] }, { v: 1, label: 'Раз в неделю', s: 0.6 }, { v: 2, label: 'Часто', s: 1 } ] },
    { id: 'helping', ch: 'spirit', type: 'single', sphere: 'spirit', w: 1, q: 'Как часто ты помогаешь другим просто так?', options: [
      { v: 2, label: 'Часто', s: 1 }, { v: 1, label: 'Иногда', s: 0.5 }, { v: 0, label: 'Редко', s: 0.1 } ] },
    { id: 'creative', ch: 'spirit', type: 'multi', q: 'Какое творчество тебе близко?', hint: 'Можно выбрать несколько', options: [
      { v: 'draw', label: 'Рисование', tags: ['creative', 'art'] }, { v: 'music', label: 'Музыка', tags: ['creative', 'music'] },
      { v: 'write', label: 'Писать тексты', tags: ['creative', 'write'] }, { v: 'photo', label: 'Фото и видео', tags: ['creative', 'photo'] },
      { v: 'craft', label: 'Делать руками', tags: ['creative', 'craft'] }, { v: 'cook', label: 'Готовка', tags: ['creative', 'cook'] },
      { v: 'none', label: 'Пока ничего', exclusive: true } ] },
    { id: 'values', ch: 'spirit', type: 'multi', max: 3, field: 'values', q: 'Выбери три главные ценности', hint: 'До трёх вариантов', options: [
      { v: 'Семья', label: 'Семья', tags: ['v_family'] }, { v: 'Свобода', label: 'Свобода' }, { v: 'Развитие', label: 'Развитие' },
      { v: 'Вера', label: 'Вера', tags: ['faith'] }, { v: 'Помощь другим', label: 'Помощь другим', tags: ['v_help'] },
      { v: 'Успех', label: 'Успех' }, { v: 'Честность', label: 'Честность' }, { v: 'Приключения', label: 'Приключения', tags: ['adventure'] },
      { v: 'Дружба', label: 'Дружба' } ] },
    { id: 'practice', ch: 'spirit', type: 'single', q: 'Есть ли у тебя духовная практика?', options: [
      { v: 'faith', label: 'Религия, молитва', tags: ['faith'] }, { v: 'med', label: 'Медитация, йога', tags: ['meditator'] },
      { v: 'phil', label: 'Философия, размышления', tags: ['philosophy'] }, { v: 'none', label: 'Пока нет' } ] },

    // ——— Финансы ———
    { id: 'saving', ch: 'money', type: 'single', sphere: 'mind', w: 1, q: 'Получается ли откладывать деньги?', options: [
      { v: 2, label: 'Да, регулярно', s: 1 }, { v: 1, label: 'Иногда', s: 0.5 }, { v: 0, label: 'Не получается', s: 0, tags: ['no_savings'] } ] },
    { id: 'spend', ch: 'money', type: 'scale', sphere: 'mind', w: 1, q: 'Насколько ты контролируешь свои траты?', labels: ['Деньги утекают сами', 'Знаю каждую копейку'], lowTags: ['impulse_spend'] },
    { id: 'debts', ch: 'money', type: 'single', q: 'Есть ли у тебя долги или кредиты?', options: [
      { v: 'no', label: 'Нет' }, { v: 'yes', label: 'Да', tags: ['debts'] } ] },
    { id: 'goal_title', ch: 'money', type: 'text', field: 'goalTitle', optional: true, q: 'На что ты мечтаешь накопить?', placeholder: 'Например: путешествие в Японию' },
    { id: 'goal_amount', ch: 'money', type: 'number', field: 'goalAmount', optional: true, q: 'Сколько нужно на эту цель?', placeholder: 'Сумма в рублях', showIf: (a) => !!a.goal_title },

    // ——— Привычки ———
    { id: 'bad', ch: 'habits', type: 'multi', q: 'Какие привычки ты хочешь победить?', hint: 'Каждая станет боссом во вкладке «Привычки»', options: [
      { v: 'smoking', label: 'Курение', tags: ['smoking'] }, { v: 'alcohol', label: 'Алкоголь', tags: ['alcohol'] },
      { v: 'sugar', label: 'Сладкое', tags: ['sugar'] }, { v: 'fastfood', label: 'Фастфуд', tags: ['fastfood', 'poor_food'] },
      { v: 'social', label: 'Залипание в соцсетях', tags: ['social', 'high_screen'] }, { v: 'games', label: 'Слишком много игр', tags: ['games'] },
      { v: 'procrastination', label: 'Прокрастинация', tags: ['procrastinator'] }, { v: 'late', label: 'Поздний отбой', tags: ['late_sleep'] },
      { v: 'overeat', label: 'Переедание', tags: ['overeat'] }, { v: 'negative', label: 'Ругань и негатив', tags: ['emotions'] },
      { v: 'caffeine', label: 'Много кофе и энергетиков', tags: ['caffeine'] }, { v: 'porn', label: 'Порно', tags: ['porn'] },
      { v: 'none', label: 'Ничего из этого', exclusive: true } ] },
    { id: 'bad_power', ch: 'habits', type: 'single', field: 'habitSeverity', q: 'Насколько сильно эти привычки держат тебя?', showIf: (a) => Array.isArray(a.bad) && a.bad.length && !a.bad.includes('none'), options: [
      { v: 'light', label: 'Слегка, легко контролирую' }, { v: 'medium', label: 'Заметно мешают' }, { v: 'heavy', label: 'Сильно, это серьёзно' } ] },
    { id: 'free_year', ch: 'habits', type: 'text', field: 'freeYear', optional: true, q: 'Что бы ты делал, если бы у тебя был целый свободный год?', placeholder: 'Помечтай' },

    // ——— Нэн ———
    { id: 'nen_water', ch: 'nen', type: 'single', field: 'nenType', nen: true,
      q: 'Перед тобой стакан воды с листком. Ты направляешь в него свою ауру. Что происходит?', options: [
        { v: 'enhancer', label: 'Воды становится больше' }, { v: 'transmuter', label: 'Вода меняет вкус' },
        { v: 'emitter', label: 'Вода меняет цвет' }, { v: 'conjurer', label: 'В воде появляются кристаллы' },
        { v: 'manipulator', label: 'Листок начинает двигаться' }, { v: 'specialist', label: 'Что-то совсем иное' } ] },
  ];

  // Каталог вредных привычек: из ответа «bad» создаются боссы.
  const HABITS = {
    smoking:         { title: 'Курение', sphere: 'body', severity: 'heavy' },
    alcohol:         { title: 'Алкоголь', sphere: 'body', severity: 'heavy' },
    sugar:           { title: 'Сладкое', sphere: 'body', severity: 'light' },
    fastfood:        { title: 'Фастфуд', sphere: 'body', severity: 'light' },
    social:          { title: 'Соцсети без цели', sphere: 'mind', severity: 'medium' },
    games:           { title: 'Игры без меры', sphere: 'mind', severity: 'medium' },
    procrastination: { title: 'Прокрастинация', sphere: 'mind', severity: 'medium' },
    late:            { title: 'Отбой после полуночи', sphere: 'body', severity: 'medium' },
    overeat:         { title: 'Переедание', sphere: 'body', severity: 'medium' },
    negative:        { title: 'Ругань и негатив', sphere: 'spirit', severity: 'medium' },
    caffeine:        { title: 'Кофеин сверх меры', sphere: 'body', severity: 'light' },
    porn:            { title: 'Порно', sphere: 'spirit', severity: 'heavy' },
  };

  HQ.interview = { CHAPTERS, QUESTIONS, HABITS };
})(typeof self !== 'undefined' ? self : this);
