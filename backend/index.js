// index.js — прод-версия (ESM) с CORS и TWA-авторизацией


import express from 'express'
import cors from 'cors'
import crypto from 'node:crypto'

// твои модули
import { bot, webhookCallback } from './src/bot.js'
import { router as api } from './src/routes.js'
import { addon as addonRoutes } from './src/routes.addon.js'

// ───────────────────────────────────────────────────────────
// ENV
// Обязательные:
//   BOT_TOKEN           — токен бота из @BotFather
//   WEBHOOK_SECRET      — секретная часть URL вебхука (напр. GRITHER)
// Рекомендуемые:
//   APP_URL             — публичный URL бэка (https://...railway.app)
//   FRONTEND_ORIGIN     — прод-URL фронта (https://<site>.netlify.app)
//   FRONTEND_ORIGINS    — доп. домены через запятую (опционально)
// Опциональные:
//   PORT                — порт (по умолчанию 3000)
//   SKIP_TWA_VERIFY     — "1" = пропускать проверку подписи (только диагностика)
// ───────────────────────────────────────────────────────────

const {
  BOT_TOKEN,
  WEBHOOK_SECRET = 'hook',
  APP_URL,
  FRONTEND_ORIGIN,
  FRONTEND_ORIGINS = '',
  PORT = 3000,
  SKIP_TWA_VERIFY
} = process.env

if (!BOT_TOKEN) {
  console.error('[FATAL] BOT_TOKEN is required')
  process.exit(1)
}

// ───────────────────────────────────────────────────────────
// App
const app = express()

// Простой журнал входящих запросов (видно в Railway logs)
app.use((req, res, next) => {
  const origin = req.headers.origin || '-'
  console.log(`[hit] ${new Date().toISOString()} ${req.method} ${req.originalUrl} origin=${origin}`)
  next()
})

// ───────────────────────────────────────────────────────────
// CORS — ставим до роутов и до json-парсера
const RAW_ORIGIN = process.env.FRONTEND_ORIGIN || ''
const EXTRA = String(process.env.FRONTEND_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

// базовый вайтлист + локалка
const allowlist = [RAW_ORIGIN, ...EXTRA, 'http://localhost:5173'].filter(Boolean)

// Построим regex для Netlify preview на основе FRONTEND_ORIGIN
let previewRegex = null
try {
  if (RAW_ORIGIN) {
    const u = new URL(RAW_ORIGIN) // напр. https://bright-tiramisu-4df5d7.netlify.app
    if (u.host.endsWith('.netlify.app')) {
      // https://<hash>--<site>.netlify.app
      const siteHost = u.host.replace('.', '\\.')
      previewRegex = new RegExp(`^https:\\/\\/[a-z0-9-]+--${siteHost}$`)
    }
  }
} catch (_) {}

console.log('[cors] allowlist =', allowlist, 'previewRegex =', !!previewRegex)

app.use(cors({
  origin: (origin, cb) => {
    // Сервер-сервер/ curl / Telegram — без Origin
    if (!origin) return cb(null, true)

    // Точное совпадение или начинается с (на случай разных схем/портов)
    if (allowlist.some(a => origin === a || origin.startsWith(a))) {
      return cb(null, true)
    }

    // Netlify preview: https://<hash>--<site>.netlify.app
    if (previewRegex && previewRegex.test(origin)) {
      return cb(null, true)
    }

    // На всякий — если очень нужно пустить все *.netlify.app:
    // if (origin.endsWith('.netlify.app')) return cb(null, true)

    return cb(new Error('Not allowed by CORS'))
  },
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
  credentials: false,
  optionsSuccessStatus: 204,
}))
app.options('*', cors())


// JSON парсер
app.use(express.json())

// ───────────────────────────────────────────────────────────
// Вспомогалки: подпись, токен (простой HMAC, не JWT)
const signHmac = (secret, data) =>
  crypto.createHmac('sha256', secret).update(data).digest('hex')

function makeSignedToken(payloadObj) {
  const secret = process.env.WEBHOOK_SECRET || 'devsecret'
  const body = JSON.stringify(payloadObj)
  const sig = signHmac(secret, body)
  const b64 = Buffer.from(body).toString('base64url')
  return `${sig}.${b64}`
}

function verifySignedToken(token) {
  const secret = process.env.WEBHOOK_SECRET || 'devsecret'
  const [sig, b64] = (token || '').split('.')
  if (!sig || !b64) return null
  const body = Buffer.from(b64, 'base64url').toString()
  const expected = signHmac(secret, body)
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
  try { return JSON.parse(body) } catch { return null }
}

// ───────────────────────────────────────────────────────────
// Проверка подписи initData Telegram Web App
function verifyTgInitData(initData, botToken) {
  // initData — строка querystring (key=value&…)
  const pairs = String(initData || '').split('&').map(p => p.split('='))
  const data = Object.fromEntries(
    pairs.filter(([k]) => k).map(([k,v]) => [k, decodeURIComponent(v)])
  )

  const providedHash = data.hash
  delete data.hash

  const checkString = Object.keys(data)
    .sort()
    .map(k => `${k}=${data[k]}`)
    .join('\n')

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest()
  const calcHash = crypto.createHmac('sha256', secretKey).update(checkString).digest('hex')

  const ok = providedHash
    && crypto.timingSafeEqual(Buffer.from(calcHash, 'hex'), Buffer.from(providedHash, 'hex'))

  return { ok: !!ok, data }
}

// ───────────────────────────────────────────────────────────
// Health / Ping
app.get('/api/health', (_req, res) => res.json({ ok: true }))

// Быстрые пинги с фронта (видно, жив ли фронт и WebApp)
app.get('/api/twa/ping', (req, res) => {
  const from = req.query.from || 'unknown'
  const wa = req.query.wa || '-'
  const init = req.query.init || '-'
  console.log(`[ping] from=${from} wa=${wa} init=${init}`)
  res.json({ ok: true })
})

import { createClient } from '@supabase/supabase-js';

const supa = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ───────────────────────────────────────────────────────────
// Авторизация WebApp: принимает initData, проверяет подпись, выдаёт токен
// ЛЁГКИЙ ЛОГГЕР СОБЫТИЙ С ФРОНТА
app.post('/api/logs', async (req, res) => {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.replace(/^Bearer\s+/i, '');
    const payload = verifySignedToken(token);
    if (!payload) {
      return res.status(401).json({ ok: false, error: 'bad token' });
    }

    const { type, message = null, extra = null } = req.body || {};

    // запись в Supabase
    try {
      await supa
        .from('logs')
        .insert({
          user_id: payload.id,
          type,
          message,
          extra,
        });
      console.log('[log->db]', payload.id, type, message);
    } catch (e) {
      console.warn('[log->db failed]', e.message);
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error('log error', e);
    return res.status(500).json({ ok: false, error: 'server' });
  }
});



    // здесь можно сохранить/обновить пользователя в БД

    // Простейшая «сессия»: подписанный токен
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

// ───────────────────────────────────────────────────────────
// Лёгкий логгер событий с фронта (нужен Authorization: Bearer <token>)
app.post('/api/logs', (req, res) => {
  try {
    const auth = req.headers.authorization || ''
    const token = auth.replace(/^Bearer\s+/i, '')
    const payload = verifySignedToken(token)
    if (!payload) return res.status(401).json({ ok: false, error: 'bad token' })

    const { type, message = null, extra = null } = req.body || {}
    console.log('[log]', payload.id, type, message, extra)
    // тут можно писать в БД (Supabase)
    return res.json({ ok: true })
  } catch (e) {
    console.error('log error', e)
    return res.status(500).json({ ok: false, error: 'server' })
  }
})

// Вспомогательный эндпойнт — посмотреть, что в токене
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
// Подключаем твои API-роуты
app.use('/api', api)
app.use('/api', addonRoutes)

// ───────────────────────────────────────────────────────────
// Telegram webhook
const secret = WEBHOOK_SECRET

// лог на любой заход к вебхуку
app.use(`/tg/${secret}`, (req, res, next) => {
  console.log('[webhook] hit', {
    method: req.method,
    url: req.originalUrl,
    len: req.headers['content-length'] || '0'
  })
  next()
})

// Телега периодически делает GET — отдадим 200 OK
app.get(`/tg/${secret}`, (_req, res) => res.status(200).send('OK'))

// Основной обработчик от Telegraf
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
