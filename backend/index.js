// --- imports ---
import express from "express";
import crypto from "node:crypto";
import { bot, webhookCallback } from "./src/bot.js";
import { router as api } from "./src/routes.js";
import { addon as addonRoutes } from "./src/routes.addon.js";

// --- app ---
const app = express();

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
  const data = Object.fromEntries(pairs.map(([k, v]) => [k, decodeURIComponent(v)]));

  const hash = data.hash;
  delete data.hash;

  const checkString = Object.keys(data)
    .sort()
    .map(k => `${k}=${data[k]}`)
    .join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(process.env.BOT_TOKEN || botToken).digest();
  const calcHash = crypto.createHmac("sha256", secretKey).update(checkString).digest("hex");

  const ok = crypto.timingSafeEqual(Buffer.from(calcHash, "hex"), Buffer.from(hash, "hex"));
  return { ok, data };
}

// --- Auth WebApp: POST /api/twa/auth ---
app.post("/api/twa/auth", (req, res) => {
  try {
    const { initData } = req.body || {};
    if (!initData) return res.status(400).json({ ok: false, error: "no initData" });

    const { ok, data } = verifyTgInitData(initData, process.env.BOT_TOKEN);
    if (!ok) return res.status(401).json({ ok: false, error: "bad signature" });

    const tgUser = JSON.parse(data.user); // user приходит строкой JSON
    console.log("[auth ok]", tgUser.id, tgUser.username || null, tgUser.first_name || null);

    // Лёгкий "токен" (HMAC + payload в base64url)
    const authPayload = { id: tgUser.id, username: tgUser.username || null, ts: Date.now() };
    const secret = process.env.WEBHOOK_SECRET || "devsecret";
    const sig = crypto.createHmac("sha256", secret).update(JSON.stringify(authPayload)).digest("hex");
    const token = `${sig}.${Buffer.from(JSON.stringify(authPayload)).toString("base64url")}`;

    return res.json({
      ok: true,
      me: { id: tgUser.id, name: tgUser.first_name, username: tgUser.username || null },
      token
    });
  } catch (e) {
    console.error("auth error", e);
    return res.status(500).json({ ok: false, error: "server" });
  }
});

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
