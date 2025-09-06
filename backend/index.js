import express from "express";
import crypto from "node:crypto";

// === SAFE MODE: пока отключим бота/вебхук/роуты-аддоны, чтобы сервер точно поднялся ===
// import { bot, webhookCallback } from "./src/bot.js";
// import { router as api } from "./src/routes.js";
// import { addon as addonRoutes } from "./src/routes.addon.js";

const app = express();

// Глобальные ловушки, чтобы видеть фатальные ошибки
process.on('unhandledRejection', e => console.error('[unhandledRejection]', e));
process.on('uncaughtException', e => console.error('[uncaughtException]', e));

// Логгер всех запросов — САМЫМ ПЕРВЫМ
app.use((req, res, next) => {
  console.log('[hit]', new Date().toISOString(), req.method, req.url, 'origin=' + (req.headers.origin || '-'));
  next();
});

// CORS (простой белый список)
const allowed = (process.env.FRONTEND_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean)
  .concat(['http://localhost:5173']);
app.use((req, res, next) => {
  const o = req.headers.origin;
  if (o && allowed.some(a => o.startsWith(a))) res.setHeader('Access-Control-Allow-Origin', o);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// JSON-парсер
app.use(express.json());

// Техручки для проверки живости
app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));
app.get('/api/twa/ping', (req, res) => res.json({ ok: true, path: '/api/twa/ping' }));

// Парсинг initData без проверки подписи (для диагностики)
function parseInitDataUnchecked(initData) {
  const pairs = initData.split('&').map(p => p.split('='));
  return Object.fromEntries(pairs.map(([k, v]) => [k, decodeURIComponent(v || '')]));
}

// /api/twa/auth — безопасный
app.post('/api/twa/auth', (req, res) => {
  try {
    const initData = req.body?.initData;
    console.log('[auth HIT]', { hasBody: !!req.body, len: initData ? initData.length : 0 });

    if (!initData) return res.status(400).json({ ok: false, error: 'no initData' });

    if (process.env.SKIP_TWA_VERIFY === '1') {
      console.warn('[auth] SKIP_TWA_VERIFY=1 — signature check is skipped (diag mode)');
      const data = parseInitDataUnchecked(initData);
      if (!data.user) return res.status(400).json({ ok: false, error: 'bad initData: no user' });

      let tgUser = null;
      try { tgUser = JSON.parse(data.user); } catch (e) {
        return res.status(400).json({ ok: false, error: 'bad initData: invalid user json' });
      }

      console.log('[auth ok*]', { id: tgUser?.id || null, username: tgUser?.username || null, first_name: tgUser?.first_name || null });

      const payload = { id: tgUser?.id || null, username: tgUser?.username || null, ts: Date.now() };
      const sig = crypto.createHmac('sha256', process.env.WEBHOOK_SECRET || 'devsecret')
        .update(JSON.stringify(payload)).digest('hex');
      const token = `${sig}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;

      return res.json({ ok: true, me: { id: tgUser?.id || null, name: tgUser?.first_name || null, username: tgUser?.username || null }, token });
    }

    // Если SKIP_TWA_VERIFY != 1 — пока честно говорим, что проверка отключена в этом режиме
    return res.status(503).json({ ok: false, error: 'verify disabled in safe-mode; set SKIP_TWA_VERIFY=1 for diag' });
  } catch (e) {
    console.error('auth error', e);
    return res.status(500).json({ ok: false, error: 'server' });
  }
});

// === НЕ включаем ничего лишнего, пока не убедимся, что сервис отвечает ===
// app.use('/api', api);
// app.use('/api', addonRoutes);
// app.get(`/tg/${process.env.WEBHOOK_SECRET || 'hook'}`, (req, res) => res.send('OK'));
// app.use(`/tg/${process.env.WEBHOOK_SECRET || 'hook'}`, webhookCallback);

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log('[server] listening on', port, 'APP_URL=', process.env.APP_URL || '(none)');
});
