// index.js — прод-версия (ESM)

import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

// твои модули бота/роутов
import { bot, webhookCallback } from './src/bot.js';
import { router as api } from './src/routes.js';
import { addon as addonRoutes } from './src/routes.addon.js';

// ───────────────────────────────────────────────────────────
// ENV
const {
  BOT_TOKEN,
  WEBHOOK_SECRET = 'hook',
  APP_URL,
  FRONTEND_ORIGIN,
  FRONTEND_ORIGINS = '',          // можно перечислить через запятую
  SUPABASE_URL = '',
  SUPABASE_SERVICE_ROLE = '',
  PORT = 3000,
  SKIP_TWA_VERIFY,
} = process.env;

if (!BOT_TOKEN) {
  console.error('[FATAL] BOT_TOKEN is required');
  process.exit(1);
}

// ───────────────────────────────────────────────────────────
// Supabase
let supa = null;
if (SUPABASE_URL && SUPABASE_SERVICE_ROLE) {
  supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
    auth: { persistSession: false },
  });
} else {
  console.warn('[WARN] Supabase vars are not set — DB inserts will be skipped');
}

// ───────────────────────────────────────────────────────────
// Helpers: HMAC token (простой), проверка initData
const signHmac = (secret, data) =>
  crypto.createHmac('sha256', secret).update(data).digest('hex');

function makeSignedToken(payloadObj) {
  const secret = WEBHOOK_SECRET || 'devsecret';
  const body = JSON.stringify(payloadObj);
  const sig = signHmac(secret, body);
  const b64 = Buffer.from(body).toString('base64url');
  return `${sig}.${b64}`;
}

function verifySignedToken(token) {
  try {
    const secret = WEBHOOK_SECRET || 'devsecret';
    const [sig, b64] = (token || '').split('.');
    if (!sig || !b64) return null;
    const body = Buffer.from(b64, 'base64url').toString();
    const expected = signHmac(secret, body);
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function verifyTgInitData(initData, botToken) {
  const pairs = (initData || '').split('&').map(p => p.split('='));
  const data = Object.fromEntries(
    pairs
      .filter(([k]) => k)
      .map(([k, v]) => [k, decodeURIComponent(v)])
  );

  const providedHash = data.hash;
  delete data.hash;

  const checkString = Object.keys(data)
    .sort()
    .map(k => `${k}=${data[k]}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calcHash = crypto.createHmac('sha256', secretKey).update(checkString).digest('hex');

  const ok =
    providedHash &&
    crypto.timingSafeEqual(Buffer.from(calcHash, 'hex'), Buffer.from(providedHash, 'hex'));

  return { ok: !!ok, data };
}

// ───────────────────────────────────────────────────────────
// App
const app = express();

// Простой аудит запросов (видно в Railway logs)
app.use((req, res, next) => {
  const origin = req.headers.origin || '-';
  console.log(
    `[hit] ${new Date().toISOString()} ${req.method} ${req.originalUrl} origin=${origin}`
  );
  next();
});

// JSON парсер до роутов
app.use(express.json());

// CORS allowlist
const listFromEnv = (FRONTEND_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const allowlist = [
  ...new Set([ ...(FRONTEND_ORIGIN ? [FRONTEND_ORIGIN.trim()] : []), ...listFromEnv ]),
  'http://localhost:5173',
].filter(Boolean);

console.log('[cors] allowlist =', allowlist, 'previewRegex = true');

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);                 // curl/сервер-сервер
      const ok = allowlist.some(a => origin === a || origin.startsWith(a));
      if (ok) return cb(null, true);
      console.warn('[cors] blocked origin:', origin, 'allowlist=', allowlist);
      return cb(new Error('Not allowed by CORS'));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: false,
  })
);
app.options('*', cors());

// ───────────────────────────────────────────────────────────
// Health / Ping / Diag
app.get('/api/health', (req, res) => res.json({ ok: true }));

app.get('/api/twa/ping', (req, res) => {
  const from = req.query.from || 'unknown';
  const wa = req.query.wa || '-';
  const init = req.query.init || '-';
  console.log(`[ping] from=${from} wa=${wa} init=${init}`);
  res.json({ ok: true });
});

app.get('/api/diag/env', (req, res) => {
  res.json({
    ok: true,
    SUPABASE_URL: SUPABASE_URL ? '***set***' : '',
    SUPABASE_SERVICE_ROLE: SUPABASE_SERVICE_ROLE ? '***set***' : '',
    FRONTEND_ORIGIN: FRONTEND_ORIGIN || '',
    FRONTEND_ORIGINS: FRONTEND_ORIGINS || '',
    APP_URL: APP_URL || '',
  });
});

// ───────────────────────────────────────────────────────────
// WebApp auth
app.post('/api/twa/auth', async (req, res) => {
  try {
    const { initData } = req.body || {};
    console.log('[auth HIT]', {
      hasBody: !!req.body,
      len: req.headers['content-length'] || '0',
      origin: req.headers.origin || '-',
    });
    if (!initData) return res.status(400).json({ ok: false, error: 'no initData' });

    let verified = { ok: false, data: {} };
    if (SKIP_TWA_VERIFY === '1') {
      verified = {
        ok: true,
        data: {
          user: JSON.stringify({ id: 999, username: null, first_name: 'CLI' }),
        },
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

    // Пишем лог «auth» в Supabase (если настроен)
    if (supa) {
      try {
        await supa.from('logs').insert({
          user_id: user.id,
          type: 'auth',
          message: 'auth ok',
          extra: { username: user.username || null },
          level: 'info', // обязательно
        });
        console.log('[auth->db] inserted for', user.id);
      } catch (e) {
        console.warn('[auth->db failed]', e.message);
      }
    }

    // Простейшая «сессия» — подписанный токен
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

// Logs endpoint (с фронта)
app.post('/api/logs', async (req, res) => {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.replace(/^Bearer\s+/i, '');
    const payload = verifySignedToken(token);
    if (!payload) return res.status(401).json({ ok: false, error: 'bad token' });

    const { type, message = null, extra = null, level = 'info' } = req.body || {};

    if (supa) {
      try {
        await supa.from('logs').insert({
          user_id: payload.id,
          type,
          message,
          extra,
          level, // обязательно
        });
        console.log('[log->db]', payload.id, type, message);
      } catch (e) {
        console.warn('[log->db failed]', e.message);
      }
    } else {
      console.log('[log] (skip db)', payload.id, type, message);
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error('log error', e);
    return res.status(500).json({ ok: false, error: 'server' });
  }
});

// Кто я — расшифровка токена
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
// Твои API-роуты
app.use('/api', api);
app.use('/api', addonRoutes);

// ───────────────────────────────────────────────────────────
// Telegram webhook
const secret = WEBHOOK_SECRET;

// лог на любой заход к вебхуку (для диагностики)
app.use(`/tg/${secret}`, (req, res, next) => {
  console.log('[webhook] hit', {
    method: req.method,
    url: req.originalUrl,
    len: req.headers['content-length'] || '0',
  });
  next();
});

// Телега делает GET — отдаём 200 OK
app.get(`/tg/${secret}`, (req, res) => res.status(200).send('OK'));

// Основной обработчик от Telegraf
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

  // Небольшая проверка окружения
  console.log('[env check] FRONTEND_ORIGIN=', FRONTEND_ORIGIN || '(none)');
  console.log(
    '[env check] SUPABASE_URL set =',
    !!SUPABASE_URL,
    ', SERVICE_KEY set =',
    !!SUPABASE_SERVICE_ROLE
  );
});
