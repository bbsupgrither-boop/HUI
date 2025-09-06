// src/bot.js
import { Telegraf } from "telegraf";
import { supabase } from "./db.js";

// === ИНИЦИАЛИЗАЦИЯ БОТА ===
const token = process.env.BOT_TOKEN;
if (!token) throw new Error("BOT_TOKEN is missing");
export const bot = new Telegraf(token);

// === ХЕЛПЕР: ПРОВЕРКА АДМИНА ===
async function isAdmin(userId) {
  const { data, error } = await supabase
    .from("admins")
    .select("user_id")
    .eq("user_id", userId)
    .limit(1);
  if (error) {
    console.error("[admins select] error:", error.message);
    return false;
  }
  return Array.isArray(data) && data.length === 1;
}

// === ЛОГ ВСЕХ ТЕКСТОВЫХ СООБЩЕНИЙ (для диагностики) ===
bot.on("text", async (ctx, next) => {
  try {
    console.log("[text]", ctx.message?.text, "from", ctx.from?.id);
  } catch {}
  return next();
});

// === СТАРТ ===
bot.start(async (ctx) => {
  const webAppUrl = 'https://bright-tiramisu-4df5d7.netlify.app/?v=5';
  await ctx.reply('Открыть приложение 👇', {
    reply_markup: {
      keyboard: [[{ text: 'Открыть GRITHER', web_app: { url: webAppUrl } }]],
      resize_keyboard: true,
      one_time_keyboard: true
    }
  });
});

// === ПОМОЩЬ ===
bot.command("help", async (ctx) => {
  await ctx.reply(
    [
      "Команды:",
      "/ping — проверка связи",
      "/admin — проверить права",
      "/list — список контент-блоков (админ)",
      "/get <slug> — показать блок контента",
      "/set <slug>|Заголовок|Текст — создать/обновить блок (админ)",
    ].join("\n")
  );
});

// === PING ===
bot.command("ping", async (ctx) => {
  await ctx.reply("pong");
});

// === ПРОВЕРКА АДМИНА ===
bot.command("admin", async (ctx) => {
  const ok = await isAdmin(ctx.from.id);
  await ctx.reply(ok ? "Ты админ ✅" : "Нет доступа ❌");
});

// === СПИСОК БЛОКОВ (АДМИН) ===
bot.command("list", async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) {
    await ctx.reply("Нет доступа ❌");
    return;
  }
  const { data, error } = await supabase
    .from("content_blocks")
    .select("slug,title,updated_at")
    .order("updated_at", { ascending: false })
    .limit(30);

  if (error) {
    await ctx.reply("Ошибка: " + error.message);
    return;
  }
  if (!data || data.length === 0) {
    await ctx.reply("Пусто");
    return;
  }
  await ctx.reply(data.map((r) => `• ${r.slug} — ${r.title}`).join("\n"));
});

// === ПОЛУЧИТЬ КОНТЕНТ: /get about ===
bot.command("get", async (ctx) => {
  const txt = ctx.message?.text || "";
  // поддержим /get и /get@имябота
  const payload = txt.replace(/^\/get(@\S+)?\s*/i, "");
  const slug = payload.trim();
  if (!slug) {
    await ctx.reply("Формат: /get slug");
    return;
  }

  const { data, error } = await supabase
    .from("content_blocks")
    .select("*")
    .eq("slug", slug)
    .single();

  if (error || !data) {
    await ctx.reply("Не найдено");
    return;
  }
  await ctx.reply(`*${data.title}*\n\n${data.body}`, { parse_mode: "Markdown" });
});

// === СОЗДАТЬ/ОБНОВИТЬ КОНТЕНТ: /set about|Заголовок|Текст ===
bot.command("set", async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) {
    await ctx.reply("Нет доступа ❌");
    return;
  }

  const txt = ctx.message?.text || "";
  // поддержим /set и /set@имябота
  const payload = txt.replace(/^\/set(@\S+)?\s*/i, "");
  const parts = payload.split("|");
  const slug = (parts[0] || "").trim();
  const title = (parts[1] || "").trim();
  const body = parts.slice(2).join("|").trim();

  if (!slug || !title || !body) {
    await ctx.reply("Формат: /set slug|Заголовок|Текст");
    return;
  }

  const { data, error } = await supabase
    .from("content_blocks")
    .upsert({
      slug,
      title,
      body,
      updated_by: String(ctx.from.id),
    })
    .select()
    .single();

  if (error) {
    await ctx.reply("Ошибка: " + error.message);
    return;
  }

  console.log("[content_updated]", { slug, by: ctx.from.id });
  await ctx.reply(`OK: ${data.slug} обновлён`);
});

// === ЭКСПОРТ ВЕБХУКА ===
export const webhookCallback = bot.webhookCallback("/");
