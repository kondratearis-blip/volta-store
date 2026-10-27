// Kokoro order API: menu, orders, admin. Storage-agnostic: receives getStore(name)
// returning an object with the @netlify/blobs Store interface.
import crypto from "node:crypto";

export const STATUSES = ["new", "confirmed", "cooking", "delivering", "done", "canceled"];
const TIME_ZONE = "Asia/Bishkek";
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

const DEFAULT_SETTINGS = {
  acceptingOrders: true,
  closedMessage: "Сейчас мы не принимаем заказы. Загляните позже!",
  deliveryFee: 0,
  minOrder: 0,
  qrImage: "",
  qrNote: "Оплатите заказ по QR-коду. Менеджер свяжется с вами в WhatsApp для подтверждения.",
  whatsappTemplate:
    "Здравствуйте, {name}! Ваш заказ №{number} в Kokoro принят:\n{items}\nИтого: {total} сом.\nАдрес: {address}\nПодтвердите, пожалуйста, адрес и время доставки.",
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
const fail = (message, status = 400) => json({ error: message }, status);

const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const int = (v, min, max) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
};

export function dayKey(date) {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(date);
}

export function createApi({ getStore, password, now = () => new Date() }) {
  const data = getStore("kokoro");
  const images = getStore("kokoro-images");
  const secret = password ? crypto.createHash("sha256").update("kokoro:" + password).digest() : null;

  const sign = (payload) => crypto.createHmac("sha256", secret).update(payload).digest("base64url");

  function issueToken() {
    const payload = Buffer.from(JSON.stringify({ exp: Date.now() + TOKEN_TTL_MS })).toString("base64url");
    return payload + "." + sign(payload);
  }

  function isAuthorized(req) {
    if (!secret) return false;
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const [payload, sig] = token.split(".");
    if (!payload || !sig) return false;
    const expected = Buffer.from(sign(payload));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return false;
    try {
      return JSON.parse(Buffer.from(payload, "base64url").toString()).exp > Date.now();
    } catch {
      return false;
    }
  }

  const getMenu = async () => (await data.get("menu", { type: "json" })) || [];
  const getSettings = async () => ({ ...DEFAULT_SETTINGS, ...((await data.get("settings", { type: "json" })) || {}) });

  async function nextOrderNumber() {
    for (let attempt = 0; attempt < 8; attempt++) {
      const current = await data.getWithMetadata("counter", { type: "json" });
      const next = (current?.data?.value || 0) + 1;
      const result = current
        ? await data.setJSON("counter", { value: next }, { onlyIfMatch: current.etag })
        : await data.setJSON("counter", { value: next }, { onlyIfNew: true });
      if (result.modified) return next;
    }
    throw new Error("counter contention");
  }

  async function createOrder(req) {
    let body;
    try {
      body = await req.json();
    } catch {
      return fail("Некорректный запрос");
    }
    if (body.website) return json({ ok: true }); // honeypot: bots fill hidden fields

    const settings = await getSettings();
    if (!settings.acceptingOrders) return fail(settings.closedMessage, 403);

    const customer = {
      name: str(body.name, 60),
      phone: str(body.phone, 30),
      address: str(body.address, 200),
      entrance: str(body.entrance, 20),
      floor: str(body.floor, 20),
      apartment: str(body.apartment, 20),
      time: str(body.time, 40) || "Как можно скорее",
      comment: str(body.comment, 500),
    };
    if (!customer.name) return fail("Укажите имя");
    if (customer.phone.replace(/\D/g, "").length < 9) return fail("Укажите корректный номер телефона");
    if (customer.address.length < 3) return fail("Укажите адрес доставки");

    const menu = await getMenu();
    const byId = new Map(menu.map((m) => [m.id, m]));
    const items = [];
    for (const line of Array.isArray(body.items) ? body.items.slice(0, 50) : []) {
      const product = byId.get(line?.id);
      if (!product || !product.available) return fail("Некоторые позиции больше недоступны — обновите страницу");
      items.push({ id: product.id, name: product.name, price: product.price, qty: int(line.qty, 1, 50) });
    }
    if (!items.length) return fail("Корзина пуста");

    const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
    if (subtotal < settings.minOrder) return fail(`Минимальная сумма заказа — ${settings.minOrder} сом`);
    const deliveryFee = settings.deliveryFee;

    const created = now();
    const number = await nextOrderNumber();
    const id = `${dayKey(created)}/${created.getTime()}-${crypto.randomBytes(3).toString("hex")}`;
    const order = {
      id,
      number,
      createdAt: created.toISOString(),
      status: "new",
      items,
      subtotal,
      deliveryFee,
      total: subtotal + deliveryFee,
      payment: "qr",
      customer,
      managerNote: "",
    };
    await data.setJSON("orders/" + id, order);
    return json({ number, total: order.total, qrImage: settings.qrImage, qrNote: settings.qrNote }, 201);
  }

  async function listOrders(url) {
    const day = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("day") || "") ? url.searchParams.get("day") : dayKey(now());
    const { blobs } = await data.list({ prefix: `orders/${day}/` });
    const orders = await Promise.all(blobs.map((b) => data.get(b.key, { type: "json" })));
    return json({ day, orders: orders.filter(Boolean).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
  }

  async function updateOrder(req, url) {
    const id = url.searchParams.get("id") || "";
    if (!/^\d{4}-\d{2}-\d{2}\/[\w-]+$/.test(id)) return fail("Неверный id");
    const order = await data.get("orders/" + id, { type: "json" });
    if (!order) return fail("Заказ не найден", 404);
    const body = await req.json().catch(() => ({}));
    if (body.status !== undefined) {
      if (!STATUSES.includes(body.status)) return fail("Неверный статус");
      order.status = body.status;
    }
    if (body.managerNote !== undefined) order.managerNote = str(body.managerNote, 500);
    order.updatedAt = now().toISOString();
    await data.setJSON("orders/" + id, order);
    return json(order);
  }

  async function saveMenu(req) {
    const body = await req.json().catch(() => null);
    if (!Array.isArray(body)) return fail("Ожидался список позиций");
    const seen = new Set();
    const menu = [];
    for (const raw of body.slice(0, 300)) {
      const name = str(raw?.name, 80);
      if (!name) return fail("У каждой позиции должно быть название");
      let id = str(raw.id, 40).replace(/[^\w-]/g, "");
      if (!id || seen.has(id)) id = crypto.randomBytes(5).toString("hex");
      seen.add(id);
      menu.push({
        id,
        name,
        category: str(raw.category, 40) || "Меню",
        description: str(raw.description, 300),
        price: int(raw.price, 0, 1_000_000),
        image: str(raw.image, 300),
        available: raw.available !== false,
      });
    }
    await data.setJSON("menu", menu);
    return json(menu);
  }

  async function saveSettings(req) {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return fail("Некорректный запрос");
    const settings = {
      acceptingOrders: body.acceptingOrders !== false,
      closedMessage: str(body.closedMessage, 300) || DEFAULT_SETTINGS.closedMessage,
      deliveryFee: int(body.deliveryFee, 0, 100_000),
      minOrder: int(body.minOrder, 0, 1_000_000),
      qrImage: str(body.qrImage, 300),
      qrNote: str(body.qrNote, 500),
      whatsappTemplate: str(body.whatsappTemplate, 1000) || DEFAULT_SETTINGS.whatsappTemplate,
    };
    await data.setJSON("settings", settings);
    return json(settings);
  }

  async function uploadImage(req) {
    const type = (req.headers.get("content-type") || "").split(";")[0];
    if (!/^image\/(jpeg|png|webp|gif|svg\+xml)$/.test(type)) return fail("Поддерживаются JPG, PNG, WEBP, GIF, SVG");
    const buf = await req.arrayBuffer();
    if (!buf.byteLength) return fail("Пустой файл");
    if (buf.byteLength > MAX_IMAGE_BYTES) return fail("Файл больше 3 МБ");
    const key = crypto.randomBytes(8).toString("hex");
    await images.set(key, buf, { metadata: { type } });
    return json({ url: "/api/img/" + key }, 201);
  }

  async function serveImage(key) {
    if (!/^[a-f0-9]{16}$/.test(key)) return fail("Not found", 404);
    const entry = await images.getWithMetadata(key, { type: "arrayBuffer" });
    if (!entry) return fail("Not found", 404);
    return new Response(entry.data, {
      headers: {
        "content-type": entry.metadata?.type || "application/octet-stream",
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
  }

  return async function handle(req) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/api/, "").replace(/\/+$/, "") || "/";
    const method = req.method;

    try {
      if (method === "GET" && path === "/menu") {
        const [menu, s] = await Promise.all([getMenu(), getSettings()]);
        return json({
          items: menu.filter((m) => m.available),
          settings: {
            acceptingOrders: s.acceptingOrders,
            closedMessage: s.closedMessage,
            deliveryFee: s.deliveryFee,
            minOrder: s.minOrder,
          },
        });
      }
      if (method === "POST" && path === "/orders") return await createOrder(req);
      if (method === "GET" && path.startsWith("/img/")) return await serveImage(path.slice(5));

      if (method === "POST" && path === "/admin/login") {
        if (!secret) return fail("На сервере не задан ADMIN_PASSWORD", 500);
        const body = await req.json().catch(() => ({}));
        const given = crypto.createHash("sha256").update(String(body.password || "")).digest();
        const expected = crypto.createHash("sha256").update(password).digest();
        if (!crypto.timingSafeEqual(given, expected)) return fail("Неверный пароль", 401);
        return json({ token: issueToken() });
      }

      if (path.startsWith("/admin/")) {
        if (!isAuthorized(req)) return fail("Требуется вход", 401);
        if (method === "GET" && path === "/admin/orders") return await listOrders(url);
        if (method === "PATCH" && path === "/admin/orders") return await updateOrder(req, url);
        if (method === "GET" && path === "/admin/menu") return json(await getMenu());
        if (method === "PUT" && path === "/admin/menu") return await saveMenu(req);
        if (method === "GET" && path === "/admin/settings") return json(await getSettings());
        if (method === "PUT" && path === "/admin/settings") return await saveSettings(req);
        if (method === "POST" && path === "/admin/images") return await uploadImage(req);
      }
      return fail("Not found", 404);
    } catch (err) {
      console.error(err);
      return fail("Ошибка сервера, попробуйте ещё раз", 500);
    }
  };
}
