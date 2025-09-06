// index.js — боевая версия

import express from "express";
import crypto from "node:crypto";
import { bot, webhookCallback } from "./src/bot.js";
import { router as api } from "./src/routes.js";
import { addon as addonRoutes } from "./src/routes.addon.js";
import cors from "cors";

const app = express();

// ===== CORS (белый список) =====
const allowlist = [
  ...(process.env.FRONTEND_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
  'https://bright-tiramisu-4df5d7.netlify.app', // твой фронт
  'http://localhost:5173',                      // на будущее — локалка
];

const corsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true); // curl/сервер-сервер
    if (allowlist.some(a => origin.startsWith(a))) return cb(null, true);
    return cb(new Error('Not allowed by CORS: ' + origin));
  },
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','X-Requested-With'],
  credentials: true,
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // корректный ответ на preflight
// ================================


/* ===================== Глобальные ловушки ошибок ===================== */
process.on("unhandledRejection", (e) =>
  console.error("[unhandledRejection]", e)
);
process.on("uncaughtException", (e) =>
  console.error("[uncaughtException]", e)
);

/* ===================== Логгер всех запросов (первым) ===================== */
app.use((req, res, next) => {
  const origin = req.headers.origin || "-";
  console.log("[hit]", new Date().toISOString(), req.method, req.url, "origin=" + origin);
  next();
});

/* ===================== CORS (белый список) ===================== */
const allowed = (process.env.FRONTEND_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .concat(["http://localhost:5173"]);
app.use((req, res, next) => {
  const o = req.headers.origin;
  if (o && allowed.some((a) => o.startsWith(a))) {
    res.setHeader("Access-Control-Allow-Origin", o);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

/* ===================== Парсер JSON ===================== */
app.use(express.json());

/* ===================== Служебные ручки ===================== */
app.get("/api/health", (req, res) => res.json({ ok: true, ts: Date.now() }));
app.get("/api/twa/ping", (req, res) => res.json({ ok: true, path: "/api/twa/ping" }));

/* ===================== Подпись initData (Telegram WebApp) ===================== */
function verifyTgInitData(initData, botToken) {
  const pairs = initData.split("&").map((p) => p.split("="));
  const data = Object.fromEntries(
    pairs.map(([k, v]) => [k, decodeURIComponent(v || "")])
  );

  const hash = data.hash;
  delete data.hash;

  const checkString = Object.keys(data)
    .sort()
    .map((k) => `${k}=${data[k]}`)
    .join("\n");

  const token = process.env.BOT_TOKEN || botToken || "";
  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(token)
    .digest();
  const calcHash = crypto
    .createHmac("sha256", secretKey)
    .update(checkString)
    .digest("hex");

  const ok = !!hash && crypto.timingSafeEqual(Buffer.from(calcHash, "hex"), Buffer.from(hash, "hex"));
  return { ok, data };
}

// (для диагностики без падений можно разобрать initData без проверки)
function parseInitDataUnchecked(initData) {
  const pairs = initData.split("&").map((p) => p.split("="));
  return Object.fromEntries(pairs.map(([k, v]) => [k, decodeURIComponent(v || "")]));
}

/* ===================== Авторизация WebApp ===================== */
/**
 * POST /api/twa/auth
 * body: { initData: window.Telegram.WebApp.initData }
 * ответ: { ok:true, me:{id,name,username}, token }
 */
app.post("/api/twa/auth", (req, res) => {
  try {
    const initData = req.body?.initData;
    console.log("[auth HIT]", {
      hasBody: !!req.body,
      len: initData ? initData.length : 0,
      origin: req.headers.origin || null,
    });
    if (!initData) {
      console.warn("[auth] no initData in body");
      return res.status(400).json({ ok: false, error: "no initData" });
    }

    const skipVerify = process.env.SKIP_TWA_VERIFY === "1";

    let data;
    if (skipVerify) {
      console.warn("[auth] signature check SKIPPED (diag mode)");
      data = parseInitDataUnchecked(initData);
    } else {
      const v = verifyTgInitData(initData, process.env.BOT_TOKEN);
      if (!v.ok) {
        console.warn("[auth] bad signature (check BOT_TOKEN and open via bot WebApp)");
        return res.status(401).json({ ok: false, error: "bad signature" });
      }
      data = v.data;
    }

    if (!data?.user) {
      console.warn("[auth] initData.user missing");
      return res.status(400).json({ ok: false, error: "bad initData: no user" });
    }

    let tgUser = null;
    try {
      tgUser = JSON.parse(data.user);
    } catch (e) {
      console.warn("[auth] cannot parse data.user:", e?.message);
      return res.status(400).json({ ok: false, error: "bad initData: invalid user json" });
    }

    console.log("[auth ok*]", {
      id: tgUser?.id || null,
      username: tgUser?.username || null,
      first_name: tgUser?.first_name || null,
    });

    // Лёгкий «подписанный» токен (не JWT, но достаточно для идентификации)
    const payload = { id: tgUser?.id || null, username: tgUser?.username || null, ts: Date.now() };
    const sig = crypto
      .createHmac("sha256", process.env.WEBHOOK_SECRET || "devsecret")
      .update(JSON.stringify(payload))
      .digest("hex");
    const token = `${sig}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;

    return res.json({
      ok: true,
      me: { id: tgUser?.id || null, name: tgUser?.first_name || null, username: tgUser?.username || null },
      token,
    });
  } catch (e) {
    console.error("auth error", e);
    return res.status(500).json({ ok: false, error: "server" });
  }
});

/* ===================== Простой лог-эндпоинт (опционально) ===================== */
/**
 * POST /api/logs
 * headers: Authorization: Bearer <token>
 * body: { type, message, extra? }
 */
app.post("/api/logs", (req, res) => {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.replace("Bearer ", "");
    const [sig, b64] = token.split(".");
    if (!sig || !b64) return res.status(401).json({ ok: false, error: "no token" });

    const payload = JSON.parse(Buffer.from(b64, "base64url").toString());
    // тут можно проверить подпись, если нужно (для простоты — только лог)
    console.log(
      "[log]",
      payload?.id || null,
      req.body?.type || "-",
      req.body?.message || "-",
      req.body?.extra || null
    );
    return res.json({ ok: true });
  } catch (e) {
    return res.status(400).json({ ok: false, error: "bad token" });
  }
});

/* ===================== Подключение твоих API ===================== */
app.use("/api", api);
app.use("/api", addonRoutes);

/* ===================== Вебхук Telegram ===================== */
const secret = process.env.WEBHOOK_SECRET || "hook";

// Телеге приятно получать 200 на GET
app.get(`/tg/${secret}`, (req, res) => res.status(200).send("OK"));

// Основной обработчик Telegraf
app.use(`/tg/${secret}`, webhookCallback);

/* ===================== Старт и авто-установка вебхука ===================== */
const port = process.env.PORT || 3000;
app.listen(port, async () => {
  console.log("[server] listening on", port, "APP_URL=", process.env.APP_URL || "(none)");
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
    console.log("[webhook] APP_URL is not set yet. Set it in Railway Variables.");
  }
});
