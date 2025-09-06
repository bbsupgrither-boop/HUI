// index.js — prod версия (ESM, Node 18+)

import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';

// твои модули (оставь только те, что реально есть в /src)
import { bot, webhookCallback } from './src/bot.js';
import { router as api } from './src/routes.js';
import { addon as addonRoutes } from './src/routes.addon.js';

// ───────────────────────────────────────────────────────────
// ENV
// Обязательные:
//   BOT_TOKEN            — токен бота из @BotFather
//   WEBHOOK_SECRET       — секрет урла вебхука (напр. GRITHER)
//
// Рекомендуемые:
//   APP_URL              — публичный URL этого бэка (https://...railway.app)
//   FRONTEND_ORIGIN      — основной фронт-URL (https://bright-....netlify.app)
//   FRONTEND_ORIGINS     — (опц.) доп. список Origin через запятую
//
// Опциональные:
//   PORT                 — порт (по умолчанию 3000)
//   SKIP_TWA_VERIFY      — '1' = отключить проверку подписи initData (только диагностика!)
// ───────────────────────────────────────────────────────────

const {
  BOT_TOKEN,
  WEBHOOK_SECRET = 'hook',
  APP_URL,
  FRONTEND_ORIGIN,
  FRONTEND_ORIGINS = '',
  PORT = 3000,
  SKIP_TWA_VERIFY,
} = process.env;

if (!BOT_TOKEN) {
  console.error('[FATAL] BOT_TOKEN is required');
  process.exit(1);
}

const app = express();

// Лёгкий лог всех входящих запросов (удобно в Railway logs)
app.use((req, _res, next) => {
  const origin = req.headers.origin || '-';
  console.log(`[hit] ${new Date().toISOString()} ${req.method} ${req.originalUrl} origin=${origin}`);
  next();
});

// CORS — ставим СРАЗУ, до роутов и до json-парсера (чтобы OPTIONS не падали на body-parser)
const allowlist = [
  FRONTEND_ORIGIN,                 // основной прод-урл фронта (Netlify Production)
  ...FRONTEND_ORIGINS.split(',').map(s => s.trim()).filter(Boolean),
  'http://localhost:5173',         // локалка
].filter(Boolean);

// если фронт — Netlify, добавим шаблон превью-деплоев:
// https://<hash>--<site>.netlify.app
const NETLIFY_SITE = (() => {
  try {
    // вытащим хост из FRONTEND_ORIGIN, напр. bright-tiramisu-4df5d7.netlify.app
    const u = new URL(FRONTEND_ORIGIN || '');
    return u.host.endsWith('.netlify.app') ? u.host : null;
  } catch { return null; }
})();

const netlifyPreviewRegex = NETLIFY_SITE
  ? new RegExp(`^https:\\/\\/[a-z0-9-]+--${NETLIFY_SITE.replace('.', '\\.')}\\$`)
  : null;

app.use(cors({
  origin: (origin, cb) => {
    // без Origin (curl/сервер-сервер) — пропускаем
    if (!origin) return cb(null, true);

    // точные/startswith совпадения из allowlist
    if (allowlist.some(a => origin === a || origin.startsWith(a))) {
      return cb(null, true);
    }
    // превью-деплои Netlify
    if (netlifyPreviewRegex && netlifyPreviewRegex.test(origin)) {
      return cb(null, true);
    }
    return cb(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 204,
}));
app.options('*', cors());

// JSON-парсер
app.use(express.json());

// ───────────────────────────────────────────────────────────
// Утилиты подписи (простой HMAC токен — не JWT)
const signHmac = (secret, data) =>
  crypto.createHmac('sha256', secret).update(data).digest('hex');

function makeSignedToken(payloadObj) {
  const secret = process.env.WEBHOOK_SECRET || 'devsecret';
  const body = JSON.stringify(payloadObj);
  const sig = signHmac(secret, body);
  const b64 = Buffer.from(body).toString('base64url');
  return `${sig}.${b64}`;
}

function verifySignedToken(token) {
  const secret = process.env.WEBHOOK_SECRET || 'devsecret';
  const [sig, b64] = (token || '').split('.');
  if (!sig || !b64) return null;
  const body = Buffer.from(b64, 'base64url').toString();
  const expected = signHmac(secret, body);
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try { return JSON.parse(body); } catch { return null; }
}

// ───────────────────────────────────────────────────────────
// Проверка подписи initData Telegram Web App
function verifyTgInitData(initData, botToken) {
  const pairs = (initData || '').split('&').map(p => p.split('='));
  const data = Object.fromEntries(
    pairs.filter(([k]) => k).map(([k, v]) => [k, decodeURIComponent(v)])
  );

  const providedHash = data.hash;
  delete data.hash;

  const checkString = Object.keys(data)
    .sort()
    .map(k => `${k}=${data[k]}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();

  const calcHash = crypto.createHmac('sha256', secretKey)
    .update(checkString)
    .digest('hex');

  const ok =
    providedHash &&
    crypto.timingSafeEqual(Buffer.from(calcHash, 'hex'), Buffer.from(providedHash, 'hex'));

  return { ok: !!ok, data };
}

// ───────────────────────────────────────────────────────────
// Health / Ping
app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/api/twa/ping', (req, res) => {
  const from = req.query.from || 'unknown';
  const wa = req.query.wa || '-';
  const init = req.query.init || '-';
  console.log(`[ping] from=${from} wa=${wa} init=${init}`);
  res.json({ ok: true });
});

// ───────────────────────────────────────────────────────────
// Авторизация WebApp: принимает initData, проверяет подпись, выдаёт токен
app.post('/api/twa/auth', async (req, res) => {
  try {
    const { initData } = req.body || {};
    console.log('[auth HIT]', {
      hasBody: !!req.body,
      len: req.headers['content-length'] || '0',
      origin: req.headers.origin || '-',
    });
    if (!initData) return res.status(400).json({ ok: false, error: 'no initData' });

    let verified;
    if (SKIP_TWA_VERIFY === '1') {
      // ⚠️ только для диагностики: не используйте в проде
      verified = {
        ok: true,
        data: { user: JSON.stringify({ id: 999, username: null, first_name: 'CLI' }) },
      };
      console.log('[auth] signature check SKIPPED (diag mode)');
    } else {
      verified = verifyTgInitData(initData, BOT_TOKEN);
    }

    if (!verified.ok) return res.status(401).json({ ok: false, error: 'bad signature' });

    const user = JSON.parse(verified.data.user || '{}');
    console.log('[auth ok*]', {
      id: user.id,
      username: user.username || null,
      first_name: user.first_name || null,
    });

    // тут можно сохранить пользователя в БД (Supabase)…

    const payload = { id: user.id, username: user.username || null, ts: Date.now() };
    const token = makeSignedToken(payload);

    return res.json({
      ok: true,
      me: { id: user.id, name: user.first_name, username: user.username || null },
      token,
    });
  } catch (e) {
    console.error('auth error', e);
    return res.status(500).json({ ok: false, error: 'server' });
  }
});

// Лёгкий логгер событий (нужен Authorization: Bearer <token>)
app.post('/api/logs', (req, res) => {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.replace(/^Bearer\s+/i, '');
    const payload = verifySignedToken(token);
    if (!payload) return res.status(401).json({ ok: false, error: 'bad token' });

    const { type, message = null, extra = null } = req.body || {};
    console.log('[log]', payload.id, type, message, extra);
    return res.json({ ok: true });
  } catch (e) {
    console.error('log error', e);
    return res.status(500).json({ ok: false, error: 'server' });
  }
});

// посмотреть, что в токене
app.get('/api/whoami', (req, res) => {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.replace(/^Bearer\s+/i, '');
    const payload = verifySignedToken(token);
    if (!payload) return res.status(401).json({ ok: false, error: 'no/bad token' });
    return res.json({ ok: true, payload });
  } catch {
    return res.status(400).json({ ok: false, error: 'bad token' });
  }
});

// ───────────────────────────────────────────────────────────
// Подключаем твои API-роуты
app.use('/api', api);
app.use('/api', addonRoutes);

// ───────────────────────────────────────────────────────────
// Telegram webhook
const secret = WEBHOOK_SECRET;

// лог на любой заход к вебхуку (для отладки 404)
app.use(`/tg/${secret}`, (req, _res, next) => {
  console.log('[webhook] hit', {
    method: req.method,
    url: req.originalUrl,
    len: req.headers['content-length'] || '0',
  });
  next();
});

// Телега иногда делает GET — вернём 200, чтобы не было "Webhook is not responding"
app.get(`/tg/${secret}`, (_req, res) => res.status(200).send('OK'));

// Основной обработчик Telegraf
app.use(`/tg/${secret}`, webhookCallback);

// ───────────────────────────────────────────────────────────
// Старт
app.listen(PORT, async () => {
  console.log('[server] listening on', PORT, 'APP_URL=', APP_URL || '(not set)');
  if (APP_URL) {
    try {
      const url = `${APP_URL}/tg/${secret}`;
      await bot.telegram.setWebhook(url);
      console.log('[webhook] set to', url);
    } catch (e) {
      console.error('[webhook] failed:', e.message);
    }
  } else {
    console.log('[webhook] APP_URL is not set yet. Set it in Railway Vars.');
  }
});
