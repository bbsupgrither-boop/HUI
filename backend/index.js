import express from "express";
import { bot, webhookCallback } from "./src/bot.js";
import { router as api } from "./src/routes.js";
import { addon as addonRoutes } from "./src/routes.addon.js";

const app = express();

import crypto from 'node:crypto'

// ПАРСЕР JSON (если ещё не стоит)
app.use(express.json())

// ВАЛИДАЦИЯ initData от Telegram Web App
function verifyTgInitData(initData, botToken) {
  // разбор querystring в объект
  const pairs = initData.split('&').map(p => p.split('='))
  const data = Object.fromEntries(pairs.map(([k,v]) => [k, decodeURIComponent(v)]))

  const hash = data.hash
  delete data.hash

  const checkString = Object.keys(data)
    .sort()
    .map(k => `${k}=${data[k]}`)
    .join('\n')

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest()
  const calcHash = crypto.createHmac('sha256', secretKey).update(checkString).digest('hex')

  const ok = crypto.timingSafeEqual(Buffer.from(calcHash, 'hex'), Buffer.from(hash, 'hex'))
  return { ok, data }
}

// POST /api/twa/auth  { initData: window.Telegram.WebApp.initData }
app.post('/api/twa/auth', async (req, res) => {
  try {
    const { initData } = req.body || {}
    if (!initData) return res.status(400).json({ ok:false, error:'no initData' })

    const { ok, data } = verifyTgInitData(initData, process.env.BOT_TOKEN)
    if (!ok) return res.status(401).json({ ok:false, error:'bad signature' })

    const user = JSON.parse(data.user) // строка JSON от Telegram
    // здесь — сохранить/обновить пользователя в БД (Supabase) и запись в логи
    // …(ниже дам простой вариант без БД)
const user = JSON.parse(data.user);
console.log('[auth ok]', user.id, user.username || null, user.first_name || null);

// было: const payload = { ... }  <-- из-за этого конфликт
const authPayload = { id: user.id, username: user.username || null, ts: Date.now() };
const secret = process.env.WEBHOOK_SECRET || 'devsecret';
const sig = crypto.createHmac('sha256', secret)
  .update(JSON.stringify(authPayload))
  .digest('hex');

const token = `${sig}.${Buffer.from(JSON.stringify(authPayload)).toString('base64url')}`;

return res.json({
  ok: true,
  me: { id: user.id, name: user.first_name, username: user.username || null },
  token
});

    // ... после: const user = JSON.parse(data.user);

// ЯВНЫЙ ЛОГ: кто авторизуется
console.log('[auth ok]', user.id, user.username || null, user.first_name || null);

// формирование token как у тебя
const payload = { id: user.id, username: user.username || null, ts: Date.now() };
const secret = process.env.WEBHOOK_SECRET || 'devsecret';
const sig = crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
const token = `${sig}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;

return res.json({ ok: true, me: { id: user.id, name: user.first_name, username: user.username || null }, token });

    app.get('/api/whoami', (req, res) => {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.replace('Bearer ', '');
    const [sig, b64] = token.split('.');
    if (!sig || !b64) return res.status(401).json({ ok: false, error: 'no token' });
    const payload = JSON.parse(Buffer.from(b64, 'base64url').toString());
    return res.json({ ok: true, payload });
  } catch (e) {
    return res.status(400).json({ ok: false, error: 'bad token' });
  }
});


    // ЛЁГКИЙ ВАРИАНТ: “сессия” через подписанный токен на стороне сервера
    const payload = { id:user.id, username:user.username || null, ts:Date.now() }
    const jwt = crypto
      .createHmac('sha256', process.env.WEBHOOK_SECRET || 'devsecret')
      .update(JSON.stringify(payload))
      .digest('hex') + '.' + Buffer.from(JSON.stringify(payload)).toString('base64url')

    res.json({ ok:true, me: { id:user.id, name: user.first_name, username: user.username || null }, token: jwt })
  } catch (e) {
    console.error('auth error', e)
    res.status(500).json({ ok:false, error:'server' })
  }
})


app.post('/api/twa/seen', (req, res) => {
  const user = req.body?.user;
  console.log('[twa] user seen:', user?.id, user?.username);
  res.json({ ok: true });
});



// сразу после app = express()
const allowed = (process.env.FRONTEND_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)
  .concat(['http://localhost:5173']); // для локали

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowed.some(a => origin.startsWith(a))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});


// === CORS с белым списком доменов ===
app.use((req, res, next) => {
  const allowed = [
    'https://bright-tiramisu-4df5d7.netlify.app', // <-- твой текущий фронт
    'http://localhost:5173'                        // для локальной разработки
  ];

  const origin = req.headers.origin;
  if (origin && allowed.some(a => origin.startsWith(a))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
// =====================================



// ==== CORS: разрешаем запросы с твоего фронта на Netlify ====
app.use((req, res, next) => {
  const allowed = [
    process.env.FRONTEND_ORIGIN,     // зададим переменную в Railway
    'http://localhost:5173'          // для локальной разработки
  ].filter(Boolean);

  const origin = req.headers.origin;
  if (origin && allowed.some(a => origin.startsWith(a))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
// ==== /CORS ====


// JSON-парсер — оставить до вебхука
app.use(express.json());

// === ВЕБХУК TELEGRAM ===
// Берём секрет из переменных (у тебя "GRITHER")
const secret = process.env.WEBHOOK_SECRET || "hook";

// Лог на каждый входящий запрос к вебхуку (для диагностики)
app.use(`/tg/${secret}`, (req, res, next) => {
  console.log("[webhook] hit", {
    method: req.method,
    url: req.originalUrl,
    len: req.headers["content-length"] || "0",
  });
  next();
});

// Разрешим любой метод (GET/POST/…) и отдаём простую 200 на GET,
// чтобы Телега не считала это ошибкой:
app.get(`/tg/${secret}`, (req, res) => res.status(200).send("OK"));

// Основной обработчик от Telegraf (универсальный)
app.use(`/tg/${secret}`, webhookCallback);

// === ТВОИ API ===
app.use("/api", api);
app.use("/api", addonRoutes);

// === СТАРТ ===
const port = process.env.PORT || 3000;
app.listen(port, async () => {
  console.log("[server] listening on", port);
  const appUrl = process.env.APP_URL;
  if (appUrl) {
    const url = `${appUrl}/tg/${secret}`;
    try {
      await bot.telegram.setWebhook(url);
      console.log("[webhook] set to", url);
    } catch (e) {
      console.error("[webhook] failed:", e.message);
    }
  } else {
    console.log("[webhook] APP_URL is not set yet. Set it after first deploy.");
  }
});
