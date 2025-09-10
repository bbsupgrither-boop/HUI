// index.js — prod (ESM)

import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';

// твои модули
import { bot, webhookCallback } from './src/bot.js';
import { router as api } from './src/routes.js';
import { addon as addonRoutes } from './src/routes.addon.js';

// ───────────────────────────────────────────────────────────
// ENV
const {
  BOT_TOKEN,
  WEBHOOK_SECRET = 'hook',
  APP_URL,
  PORT = 3000,
} = process.env;

// имена переменных для фронта: поддержим оба
const FRONTEND_ORIGIN =
  process.env.FRONTEND_ORIGIN || process.env.FRONTEND_ORIGINS || '';

// Supabase: поддержим оба имени ключа
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_KEY || '';

// безопасный флаг для диагностики
const SKIP_TWA_VERIFY = process.env.SKIP_TWA_VERIFY;

// ───────────────────────────────────────────────────────────
if (!BOT_TOKEN) {
  console.error('[FATAL] BOT_TOKEN is required');
  process.exit(1);
}

// Опционально: подключим Supabase (если заданы обе переменные)
let supabase = null;
if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
  // динамический импорт, чтобы не падать без пакета
  const { createClient } = await import('@supabase/supabase-js');
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });
} else {
  console.warn(
    '[WARN] Supabase vars are not set — /api/logs will skip DB insert'
  );
}

// ───────────────────────────────────────────────────────────
// DIAG: проверить вставку в БД напрямую (без фронта/токена)
app.post('/api/diag/db', async (req, res) => {
  try {
    if (!supa) {
      return res.status(500).json({ ok: false, error: 'supa not inited' })
    }
    const testUserId = 6020903159  // можешь подставить свой Telegram id
    const { error } = await supa
      .from('logs')
      .insert({
        user_id: testUserId,
        type: 'diag',
        message: 'railway direct insert',
        extra: { source: 'diag-endpoint' },
      })

    if (error) {
      console.warn('[diag/db insert failed]', error.message)
      return res.status(500).json({ ok: false, error: error.message })
    }
    console.log('[diag/db inserted] ok for', testUserId)
    return res.json({ ok: true })
  } catch (e) {
    console.error('[diag/db error]', e)
    return res.status(500).json({ ok: false, error: 'server' })
  }
})

// ───────────────────────────────────────────────────────────
// App
const app = express();

// Общий лог входящих запросов
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
const allowlist = FRONTEND_ORIGIN.split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .concat(['http://localhost:5173']);

const previewRegex =
  /https:\/\/[a-z0-9-]+--[a-z0-9-]+\.netlify\.app$/i;

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // curl/сервер-сервер
      if (allowlist.some((a) => origin.startsWith(a))) return cb(null, true);
      if (previewRegex.test(origin)) return cb(null, true); // превью нетлифи
      return cb(new Error('Not allowed by CORS'));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  })
);
app.options('*', cors());

console.log('[cors] allowlist =', allowlist, 'previewRegex =', true);

// ───────────────────────────────────────────────────────────
// Хелперы подписи/токена
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
  const secret = WEBHOOK_SECRET || 'devsecret';
  const [sig, b64] = (token || '').split('.');
  if (!sig || !b64) return null;
  const body = Buffer.from(b64, 'base64url').toString();
  const expected = signHmac(secret, body);
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

// Проверка подписи initData Telegram Web App
function verifyTgInitData(initData, botToken) {
  const pairs = (initData || '').split('&').map((p) => p.split('='));
  const data = Object.fromEntries(
    pairs
      .filter(([k]) => k)
      .map(([k, v]) => [k, decodeURIComponent(v)])
  );

  const providedHash = data.hash;
  delete data.hash;

  const checkString = Object.keys(data)
    .sort()
    .map((k) => `${k}=${data[k]}`)
    .join('\n');

  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();
  const calcHash = crypto
    .createHmac('sha256', secretKey)
    .update(checkString)
    .digest('hex');

  const ok =
    providedHash &&
    crypto.timingSafeEqual(
      Buffer.from(calcHash, 'hex'),
      Buffer.from(providedHash, 'hex')
    );

  return { ok: !!ok, data };
}

// ───────────────────────────────────────────────────────────
// Health / Ping
app.get('/api/health', (req, res) => res.json({ ok: true }));

// === DIAG: показать, видит ли процесс ключевые переменные окружения ===
app.get('/api/diag/env', (req, res) => {
  res.json({
    ok: true,
    SUPABASE_URL: process.env.SUPABASE_URL || null,
    SUPABASE_SERVICE_ROLE: process.env.SUPABASE_SERVICE_ROLE ? '***set***' : null,
    FRONTEND_ORIGIN: process.env.FRONTEND_ORIGIN || null,
  });
});


app.get('/api/twa/ping', (req, res) => {
  const from = req.query.from || 'unknown';
  const wa = req.query.wa || '-';
  const init = req.query.init || '-';
  console.log(`[ping] from=${from} wa=${wa} init=${init}`);
  res.json({ ok: true });
});

// ───────────────────────────────────────────────────────────
// Авторизация WebApp
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

    const payload = { id: user.id, username: user.username || null, ts: Date.now() };
    const token = makeSignedToken(payload);
    // контрольная запись в Supabase — помечаем успешную авторизацию
if (supabase) {
  try {
    await supabase.from('logs').insert({
      user_id: user.id,
      type: 'auth',
      message: 'twa auth ok',
      extra: { username: user.username || null }
    });
    console.log('[auth->db] inserted for', user.id);
  } catch (e) {
    console.warn('[auth->db failed]', e.message);
  }
}

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

// ───────────────────────────────────────────────────────────
// Логи с фронта
// ───────────────────────────────────────────────────────────
// Лёгкий логгер событий с фронта (требует Authorization: Bearer <token>)
app.post('/api/logs', async (req, res) => {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.replace(/^Bearer\s+/i, '');
    const payload = verifySignedToken(token);
    if (!payload) return res.status(401).json({ ok: false, error: 'bad token' });

    // Принимаем оба варианта тела:
    // 1) { type, message, extra }
    // 2) { level, message, context }
    const {
      type = null,
      level: levelRaw = null,
      message = null,
      extra = null,
      context: contextRaw = null,
    } = req.body || {};

    const level = (levelRaw || type || 'info').toString();

    // Собираем context (jsonb) — объединяем присланный extra/context с тех.метаданными
    const context =
      (contextRaw && typeof contextRaw === 'object' ? contextRaw : {}) ||
      (extra && typeof extra === 'object' ? extra : {}) || {};

    const mergedContext = {
      ...context,
      user_id: payload.id,
      username: payload.username || null,
      ua: req.headers['user-agent'] || null,
      ip: req.headers['x-forwarded-for'] || req.ip || null,
    };

    console.log('[log]', payload.id, level, message);

    // Если Supabase настроен — пишем в БД
    if (supa) {
      try {
        const { error, data } = await supa
          .from('logs')
          .insert({
            level,
            message,
            context: mergedContext,
          })
          .select('id')
          .single();

        if (error) {
          console.warn('[log->db failed]', error.message);
        } else {
          console.log('[log->db] inserted id=', data?.id);
        }
      } catch (e) {
        console.warn('[log->db failed]', e.message);
      }
    } else {
      console.warn('[log->db] skipped: supa client is not initialized');
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error('log error', e);
    return res.status(500).json({ ok: false, error: 'server' });
  }
});


// Вспомогательный эндпойнт для отладки токена
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

app.use(`/tg/${secret}`, (req, res, next) => {
  console.log('[webhook] hit', {
    method: req.method,
    url: req.originalUrl,
    len: req.headers['content-length'] || '0',
  });
  next();
});

app.get(`/tg/${secret}`, (req, res) => res.status(200).send('OK'));
app.use(`/tg/${secret}`, webhookCallback);

// ───────────────────────────────────────────────────────────
// Старт
app.listen(PORT, async () => {
  console.log('[server] listening on', PORT, 'APP_URL=', APP_URL || '(not set)');
  console.log('[env check] FRONTEND_ORIGIN=', FRONTEND_ORIGIN || '(empty)');
  console.log(
    '[env check] SUPABASE_URL set =',
    Boolean(SUPABASE_URL),
    ', SERVICE_KEY set =',
    Boolean(SUPABASE_SERVICE_KEY)
  );

  if (APP_URL) {
    try {
      const url = `${APP_URL}/tg/${secret}`;
      await bot.telegram.setWebhook(url);
      console.log('[webhook] set to', url);
    } catch (e) {
      console.error('[webhook] failed:', e.message);
    }
  } else {
    console.log('[webhook] APP_URL is not set yet.');
  }
});
