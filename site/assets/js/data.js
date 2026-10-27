// Всё, что знаем о KOKORO, — в одном месте. Меняется здесь, вёрстку трогать не нужно.
// Цена комбо и стоимость доставки — в базе (панель → «Настройки»), здесь только запасное значение.
export const brand = {
  name: 'KOKORO',
  phone: '996707581771',
  phoneLabel: '+996 707 581 771',
  instagram: 'kokoro.kgz',
  instagramUrl: 'https://www.instagram.com/kokoro.kgz/',
};

export const combo = {
  name: 'Комбо KOKORO',
  price: 1400,
  items: [
    { count: '25', title: 'хрустящих крыльев' },
    { count: '1 кг', title: 'деревенской картошки' },
    { count: '3', title: 'больших фирменных соуса' },
    { count: '1 л', title: 'Coca-Cola' },
  ],
};

export const STATUSES = {
  new: 'Новый',
  confirmed: 'Подтверждён',
  cooking: 'Готовится',
  delivering: 'В пути',
  done: 'Доставлен',
  canceled: 'Отменён',
};

export const PAYMENTS = { cash: 'Наличными курьеру', transfer: 'Переводом' };

export const money = (n) => `${Number(n).toLocaleString('ru-RU')} сом`;
