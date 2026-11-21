// Сервер бота курьеров @kkurierr_bot — единственный код KOKORO на Cloudflare; всё остальное на kokoro.com.kg —
// статика из site/ (код запускается только для /tg/*, см. wrangler.jsonc → run_worker_first).
// Telegram присылает сюда сообщения курьеров: подключение (/start <код>) и трансляцию места. Секретов здесь нет:
// секрет из заголовка Telegram сверяет сама база (supabase/couriers.sql → kokoro_tg_update), она же решает, что ответить.
// Ответ уходит Telegram прямо в ответ на его запрос ({ method: 'sendMessage', … }) — токен бота серверу не нужен.
// Ещё здесь таймер автоназначения (specs/015): раз в минуту просим базу раздать свободные заказы курьерам на смене.
// И погода (specs/022): раз в 10 минут спрашиваем прогноз у каждой кухни и отдаём базе — она сама включает и выключает
// «Идёт дождь» (+100 сом к доставке). Секрет для этого — WEATHER_SECRET (Cloudflare → секреты worker; копия в .env), база
// хранит только его SHA-256. Секрета нет — погоду не спрашиваем, дождь включают вручную, как раньше.
import { config } from '../site/assets/js/config.js';

// Кухни точек — как data.js → delivery.kitchens
const KITCHENS = { kulieva: [42.8796, 74.5684], kokzhar: [42.8412, 74.649] };
// Прогноз MET Norway (api.met.no, бесплатно и для коммерции, данные CC BY 4.0): правила просят назваться в User-Agent
const MET_UA = 'KOKORO-delivery/1.0 (+https://kokoro.com.kg)';

/**
 * Погода у кухонь на ближайший час: { kulieva: { wet, mm, symbol }, kokzhar: … }. wet — дождь, морось, снег или мокрый снег
 * по значку прогноза, или осадков от 0,3 мм за час. Кухня, по которой прогноз не пришёл, в отчёт не попадает
 */
async function weatherReport() {
  const report = {};
  for (const [branch, [lat, lon]] of Object.entries(KITCHENS)) {
    // Сбой по одной кухне (обрыв, страница ошибки вместо JSON) не отменяет отчёт по другой
    try {
      const res = await fetch(`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat}&lon=${lon}`, {
        headers: { 'User-Agent': MET_UA, Accept: 'application/json' },
      });
      if (!res.ok) { console.error(`погода ${branch}: HTTP ${res.status}`); continue; }
      const series = (await res.json())?.properties?.timeseries || [];
      const now = Date.now();
      const current = series.filter((s) => Date.parse(s.time) <= now).pop() || series[0];
      const hour = current?.data?.next_1_hours;
      if (!hour) continue;
      const symbol = String(hour.summary?.symbol_code || '');
      const mm = Number(hour.details?.precipitation_amount ?? 0);
      report[branch] = { wet: /rain|sleet|snow|drizzle/.test(symbol) || mm >= 0.3, mm: Number.isFinite(mm) ? mm : 0, symbol };
    } catch (err) {
      console.error(`погода ${branch}: ${err?.message || err}`);
    }
  }
  return report;
}

const rpc = (name, body) => fetch(`${config.supabaseUrl}/rest/v1/rpc/${name}`, {
  method: 'POST',
  headers: { apikey: config.supabaseKey, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export default {
  // Таймер Cloudflare (wrangler.jsonc → triggers.crons, раз в минуту): база назначает свободные заказы курьерам на смене
  // (supabase/auto-dispatch.sql → kokoro_dispatch; чаще раза в 5 секунд она сама не назначает). Сбой не страшен и ошибкой
  // не считается: через минуту таймер попросит снова, а страницы курьеров и панели зовут назначение и сами
  async scheduled(event, env, ctx) {
    ctx.waitUntil(rpc('kokoro_dispatch', {}).then(async (res) => {
      const text = await res.text().catch(() => '');
      if (!res.ok) console.error(`kokoro_dispatch: HTTP ${res.status} ${text.slice(0, 200)}`);
    }, (err) => console.error(`kokoro_dispatch: нет связи с базой — ${err?.message || err}`)));
    // Погода — раз в 10 минут (в :00, :10, :20 …)
    if (env.WEATHER_SECRET && new Date(event.scheduledTime).getUTCMinutes() % 10 === 0) {
      ctx.waitUntil(weatherReport().then(async (report) => {
        if (!Object.keys(report).length) return;
        const res = await rpc('kokoro_weather_update', { p_secret: env.WEATHER_SECRET, p_report: report });
        const text = await res.text().catch(() => '');
        if (!res.ok) console.error(`kokoro_weather_update: HTTP ${res.status} ${text.slice(0, 200)}`);
        else if (text && text !== '{}') console.log(`погода: ${text}`);
      }).catch((err) => console.error(`погода: ${err?.message || err}`)));
    }
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/tg/hook') return env.ASSETS.fetch(request);
    if (request.method !== 'POST') return new Response('Not found', { status: 404 });
    const secret = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
    if (!secret) return new Response('Forbidden', { status: 403 }); // не Telegram — в базу даже не ходим
    let update;
    try { update = await request.json(); } catch { return new Response('Bad request', { status: 400 }); }
    const res = await fetch(`${config.supabaseUrl}/rest/v1/rpc/kokoro_tg_update`, {
      method: 'POST',
      headers: { apikey: config.supabaseKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_secret: secret, p_update: update }),
    });
    if (res.status === 401 || res.status === 403) return new Response('Forbidden', { status: 403 });
    if (!res.ok) return new Response('Retry later', { status: 500 }); // сбой базы — Telegram повторит сообщение сам
    const reply = await res.json().catch(() => null);
    if (reply?.method) return Response.json(reply);
    return new Response('ok');
  },
};
