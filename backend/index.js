// --- imports ---
import express from "express";
import crypto from "node:crypto";
import { bot, webhookCallback } from "./src/bot.js";
import { router as api } from "./src/routes.js";
import { addon as addonRoutes } from "./src/routes.addon.js";

// --- app ---
const app = express();

// ГЛОБАЛЬНЫЙ ЛОГГЕР ВСЕХ ЗАПРОСОВ (ставим самым первым)
app.use((req, res, next) => {
  try {
    const o = req.headers.origin || '';
    console.log('[hit]', new Date().toISOString(), req.method, req.url, o ? `origin=${o}` : '');
  } catch {}
  next();
});


// --- CORS (до любых роутов) ---
const allowedOrigins = (process.env.FRONTEND_ORIGINS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean)
  .concat(["http://localhost:5173"]); // для локалки

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.some(a => origin.startsWith(a))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// --- JSON-парсер (один раз) ---
app.use(express.json());

// --- Проверка подписи Telegram WebApp ---
function verifyTgInitData(initData, botToken) {
  const pairs = initData.split("&").map(p => p.split("="));
  const data = Object.fromEntries(
    pairs.map(([k, v]) => [k, decodeURIComponent(v || "")])
  );

  const hash = data.hash;
  delete data.hash;

  const checkString = Object.keys(data)
    .sort()
    .map(k => `${k}=${data[k]}`)
    .join("\n");

  // Делаем ключ безопасным даже если токена нет
  const token = (process.env.BOT_TOKEN || botToken || "");
  const secretKey = crypto.createHmac("sha256", "WebAppData").update(token).digest();
  const calcHash = crypto.createHmac("sha256", secretKey).update(checkString).digest("hex");

  // Если hash пуст — явно провалим проверку, но без исключений
  const ok = !!hash && crypto.timingSafeEqual(Buffer.from(calcHash, "hex"), Buffer.from(hash, "hex"));
  return { ok, data };
}

// Парсим initData БЕЗ проверки подписи (для диагностики)
function parseInitDataUnchecked(initData) {
  const pairs = initData.split("&").map(p => p.split("="));
  const data = Object.fromEntries(
    pairs.map(([k, v]) => [k, decodeURIComponent(v || "")])
  );
  return data;
}

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

    const authPayload = {
      id: tgUser?.id || null,
      username: tgUser?.username || null,
      ts: Date.now(),
    };
    const secret = process.env.WEBHOOK_SECRET || "devsecret";
    const sig = crypto.createHmac("sha256", secret)
      .update(JSON.stringify(authPayload))
      .digest("hex");
    const token = `${sig}.${Buffer.from(JSON.stringify(authPayload)).toString("base64url")}`;

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


    const authPayload = { id: tgUser?.id || null, username: tgUser?.username || null, ts: Date.now() };
    const secret = process.env.WEBHOOK_SECRET || "devsecret";
    const sig = crypto.createHmac("sha256", secret).update(JSON.stringify(authPayload)).digest("hex");
    const token = `${sig}.${Buffer.from(JSON.stringify(authPayload)).toString("base64url")}`;

    return res.json({
      ok: true,
      me: { id: tgUser?.id || null, name: tgUser?.first_name || null, username: tgUser?.username || null },
      token
    });
  } catch (e) {
    console.error("auth error", e);
    return res.status(500).json({ ok: false, error: "server" });
  }
});


// Посмотреть важные ENV, но безопасно (без токенов целиком)
app.get("/api/debug/env", (req, res) => {
  const botToken = process.env.BOT_TOKEN || "";
  res.json({
    ok: true,
    hasBotToken: !!botToken,
    botTokenPrefix: botToken ? botToken.slice(0, 10) : null,
    appUrl: process.env.APP_URL || null,
    origins: process.env.FRONTEND_ORIGINS || null,
    skipVerify: process.env.SKIP_TWA_VERIFY === "1"
  });
});

app.get("/api/twa/ping", (req, res) => res.json({ ok: true, path: "/api/twa/auth alive" }));



// --- Кто я по токену: GET /api/whoami ---
app.get("/api/whoami", (req, res) => {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.replace("Bearer ", "");
    const [sig, b64] = token.split(".");
    if (!sig || !b64) return res.status(401).json({ ok: false, error: "no token" });
    const payload = JSON.parse(Buffer.from(b64, "base64url").toString());
    return res.json({ ok: true, payload });
  } catch {
    return res.status(400).json({ ok: false, error: "bad token" });
  }
});

// --- Приём пользовательских логов: POST /api/logs ---
app.post("/api/logs", (req, res) => {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace("Bearer ", "");
  const [sig, b64] = token.split(".");
  let decoded = null;
  try {
    if (b64) decoded = JSON.parse(Buffer.from(b64, "base64url").toString());
  } catch {}
  const { type, message, extra } = req.body || {};
  console.log("[log]", decoded?.id ?? null, type || "event", message || "", extra || null);
  return res.json({ ok: true });
});

// --- Простой "seen" лог: POST /api/twa/seen ---
app.post("/api/twa/seen", (req, res) => {
  const u = req.body?.user;
  console.log("[twa] user seen:", u?.id, u?.username);
  res.json({ ok: true });
});

// --- Телеграм вебхук ---
const secret = process.env.WEBHOOK_SECRET || "hook";

// Не обязательно, но удобно иметь GET 200, чтобы Telegram не ругался
app.get(`/tg/${secret}`, (req, res) => res.status(200).send("OK"));

// Основной обработчик (Telegraf)
app.use(`/tg/${secret}`, webhookCallback);

// --- Твои API роуты ---
app.use("/api", api);
app.use("/api", addonRoutes);

// --- START ---
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
