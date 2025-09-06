import express from "express";
import { bot, webhookCallback } from "./src/bot.js";
import { router as api } from "./src/routes.js";
import { addon as addonRoutes } from "./src/routes.addon.js";

const app = express();

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
