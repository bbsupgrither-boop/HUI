// index.js — прод-версия (ESM)

import express from 'express'
import cors from 'cors'
import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

// твои модули
import { bot, webhookCallback } from './src/bot.js'
import { router as api } from './src/routes.js'
import { addon as addonRoutes } from './src/routes.addon.js'

// ───────────────────────────────────────────────────────────
// ENV (единственный блок — не дублировать ниже!)
const {
  BOT_TOKEN,
  WEBHOOK_SECRET = 'hook',
  APP_URL,
  FRONTEND_ORIGINS = '',
  PORT = 3000,
  SKIP_TWA_VERIFY,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE,
} = process.env

if (!BOT_TOKEN) {
  console.error('[FATAL] BOT_TOKEN is required')
  process.exit(1)
}

// Supabase client (не сохраняем сессии на сервере)
const supa = (SUPABASE_URL && SUPABASE_SERVICE_ROLE)
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null

if (!supa) {
  console.warn('[WARN] Supabase vars are not set — DB inserts will be skipped')
}

// ───────────────────────────────────────────────────────────
// Helpers: подпись токена (простой HMAC, не JWT)
const signHmac = (secret, data) =>
  crypto.createHmac('sha256', secret).update(data).digest('hex')

function makeSignedToken(payloadObj) {
  const secret = WEBHOOK_SECRET || 'devsecret'
  const body = JSON.stringify(payloadObj)
  const sig = signHmac(secret, body)
  const b64 = Buffer.from(body).toString('base64url')
  return `${sig}.${b64}`
}

function verifySignedToken(token) {
  try {
    const secret = WEBHOOK_SECRET || 'devsecret'
    const [sig, b64] = (token || '').split('.')
    if (!sig || !b64) return null
    const body = Buffer.from(b64, 'base64url').toString()
    const expected = signHmac(secret, body)
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
    return JSON.parse(body)
  } catch {
    return null
  }
}

// Проверка подписи initData Telegram Web App
function verifyTgInitData(initData, botToken) {
  const pairs = (initData || '').split('&').map(p => p.split('='))
  const data = Object.fromEntries(
    pairs
      .filter(([k]) => k)
      .map(([k, v]) => [k, decodeURIComponent(v)])
  )

  const providedHash = data.hash
  delete data.hash

  const checkString = Object.keys(data)
    .sort()
    .map(k => `${k}=${data[k]}`)
    .join('\n')

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest()
  const calcHash = crypto.createHmac('sha256', secretKey).update(checkString).digest('hex')

  const ok = providedHash &&
    crypto.timingSafeEqual(Buffer.from(calcHash, 'hex'), Buffer.from(providedHash, 'hex'))

  return { ok: !!ok, data }
}

// ───────────────────────────────────────────────────────────
// App
const app = express()

// Простой журнал входящих запросов (видно в Railway Logs)
app.use((req, res, next) => {
  const origin = req.headers.origin || '-'
  console.log(`[hit] ${new Date().toISOString()} ${req.method} ${req.originalUrl} origin=${origin}`)
  next()
})

// JSON парсер
app.use(express.json())

// CORS: белый список + превью Netlify
const allowlist = (FRONTEND_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// всегда разрешаем локалку
if (!allowlist.includes('http://localhost:5173')) {
  allowlist.push('http://localhost:5173');
}

// если среди allowlist есть прод-домен Netlify — построим regex и для превью-деплоев
const previewRegexes = [];
for (const o of allowlist) {
  // прод домен формата https://example.netlify.app
  if (/^https?:\/\/[^/]+\.netlify\.app$/.test(o)) {
    const host = o.replace(/^https?:\/\//, '');
    // разрешаем https://<anything>--HOST
    previewRegexes.push(new RegExp(`^https://[a-z0-9-]+--${host.replace(/\./g, '\\.')}$`));
  }
}

console.log('[cors] allowlist =', allowlist, 'previewRegex =', previewRegexes.length > 0);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // curl/server-to-server

    // точное совпадение или startsWith (на случай, если в env без протокола)
    const inList = allowlist.some(a =>
      origin === a ||
      origin.startsWith(a) ||
      // на всякий случай поддержим вариант без схемы в env (example.netlify.app)
      (!a.startsWith('http') && origin.endsWith(a))
    );

    const isPreview = previewRegexes.some(rx => rx.test(origin));

    if (inList || isPreview) return cb(null, true);

    console.warn('[cors] blocked origin:', origin, 'allowlist=', allowlist);
    return cb(new Error('Not allowed by CORS'));
  },
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
  credentials: false,
}));
app.options('*', cors());

// ───────────────────────────────────────────────────────────
// Health / Diagnostics
app.get('/api/health', (req, res) => res.json({ ok: true }))

// Отдать env-состояние (без секретов)
app.get('/api/diag/env', (req, res) => {
  res.json({
    ok: true,
    SUPABASE_URL: SUPABASE_URL ? '***set***' : null,
    SUPABASE_SERVICE_ROLE: SUPABASE_SERVICE_ROLE ? '***set***' : null,
    FRONTEND_ORIGINS: allowlist,
  })
})

// Пробная запись в DB (logs.type='diag')
app.post('/api/diag/db', async (req, res) => {
  try {
    if (!supa) return res.status(200).json({ ok: false, skipped: true, reason: 'no supabase vars' })
    const ins = await supa.from('logs').insert({
      user_id: 0,
      type: 'diag',
      message: 'manual insert',
      extra: { ts: Date.now() }
    })
    if (ins.error) throw ins.error
    return res.json({ ok: true })
  } catch (e) {
    console.warn('[diag/db error]', e)
    return res.status(500).json({ ok: false, error: 'db insert failed' })
  }
})

// ───────────────────────────────────────────────────────────
// Авторизация WebApp: принимает initData, проверяет подпись, выдаёт токен
app.post('/api/twa/auth', async (req, res) => {
  try {
    const { initData } = req.body || {}
    console.log('[auth HIT]', {
      hasBody: !!req.body,
      len: req.headers['content-length'] || '0',
      origin: req.headers.origin || '-'
    })
    if (!initData) return res.status(400).json({ ok: false, error: 'no initData' })

    let verified = { ok: false, data: {} }
    if (SKIP_TWA_VERIFY === '1') {
      // только для диагностики
      verified = {
        ok: true,
        data: {
          user: JSON.stringify({ id: 999, username: null, first_name: 'CLI' })
        }
      }
      console.log('[auth] signature check SKIPPED (diag mode)')
    } else {
      verified = verifyTgInitData(initData, BOT_TOKEN)
    }
    if (!verified.ok) return res.status(401).json({ ok: false, error: 'bad signature' })

    // user — это строка JSON в initData
    const user = JSON.parse(verified.data.user || '{}')
    console.log('[auth ok*]', {
      id: user.id,
      username: user.username || null,
      first_name: user.first_name || null
    })

    // Пишем событие в Supabase (если доступно)
    if (supa) {
      const ins = await supa.from('logs').insert({
        user_id: user.id,
        type: 'auth',
        message: 'webapp auth ok',
        extra: { username: user.username || null }
      })
      if (ins.error) console.warn('[auth->db failed]', ins.error.message)
      else console.log('[auth->db] inserted for', user.id)
    }

    // Возвращаем простой подписанный токен
    const payload = { id: user.id, username: user.username || null, ts: Date.now() }
    const token = makeSignedToken(payload)

    return res.json({
      ok: true,
      me: { id: user.id, name: user.first_name, username: user.username || null },
      token
    })
  } catch (e) {
    console.error('auth error', e)
    return res.status(500).json({ ok: false, error: 'server' })
  }
})

// Лёгкий логгер событий с фронта (требует Authorization: Bearer <token>)
app.post('/api/logs', async (req, res) => {
  try {
    const auth = req.headers.authorization || ''
    const token = auth.replace(/^Bearer\s+/i, '')
    const payload = verifySignedToken(token)
    if (!payload) return res.status(401).json({ ok: false, error: 'bad token' })

    // СТАНЕТ:
const { type, message = null, extra = null, level = 'info' } = req.body || {};

try {
  await supa
    .from('logs')
    .insert({
      user_id: payload.id,
      type,
      message,
      extra,
      level,           // <-- добавили
    });
  console.log('[log->db]', payload.id, type, message, level);
} catch (e) {
  console.warn('[log->db failed]', e.message);
}
    console.log('[log]', payload.id, type, message, extra)

    if (supa) {
      const ins = await supa.from('logs').insert({
        user_id: payload.id,
        type,
        message,
        extra,
      })
      if (ins.error) console.warn('[log->db failed]', ins.error.message)
      else console.log('[log->db]', payload.id, type, message)
    }

    return res.json({ ok: true })
  } catch (e) {
    console.error('log error', e)
    return res.status(500).json({ ok: false, error: 'server' })
  }
})

// Вспомогательный эндпойнт — посмотреть полезную нагрузку токена
app.get('/api/whoami', (req, res) => {
  try {
    const auth = req.headers.authorization || ''
    const token = auth.replace(/^Bearer\s+/i, '')
    const payload = verifySignedToken(token)
    if (!payload) return res.status(401).json({ ok: false, error: 'no/bad token' })
    return res.json({ ok: true, payload })
  } catch {
    return res.status(400).json({ ok: false, error: 'bad token' })
  }
})

// ───────────────────────────────────────────────────────────
// Твои API-роуты
app.use('/api', api)
app.use('/api', addonRoutes)

// ───────────────────────────────────────────────────────────
// Telegram webhook
const secret = WEBHOOK_SECRET

// лог заходов к вебхуку
app.use(`/tg/${secret}`, (req, res, next) => {
  console.log('[webhook] hit', {
    method: req.method,
    url: req.originalUrl,
    len: req.headers['content-length'] || '0',
  })
  next()
})

// на GET отдаём 200 OK (Телега иногда проверяет)
app.get(`/tg/${secret}`, (req, res) => res.status(200).send('OK'))

// основной обработчик от Telegraf
app.use(`/tg/${secret}`, webhookCallback)

// ───────────────────────────────────────────────────────────
// Старт
app.listen(PORT, async () => {
  console.log('[server] listening on', PORT, 'APP_URL=', APP_URL || '(not set)')
  if (APP_URL) {
    try {
      const url = `${APP_URL}/tg/${secret}`
      await bot.telegram.setWebhook(url)
      console.log('[webhook] set to', url)
    } catch (e) {
      console.error('[webhook] failed:', e.message)
    }
  } else {
    console.log('[webhook] APP_URL is not set yet. Set it in Railway Vars.')
  }
})
