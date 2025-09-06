import { Telegraf } from "telegraf";
import { supabase } from "./db.js";
import { logger } from "./logger.js";

const token = process.env.BOT_TOKEN;
if (!token) throw new Error("BOT_TOKEN is missing");
export const bot = new Telegraf(token);

async function isAdmin(userId) {
  const { data, error } = await supabase
    .from("admins")
    .select("user_id")
    .eq("user_id", userId)
    .limit(1);
  return !error && data && data.length === 1;
}

bot.use(async (ctx, next) => {
  await logger.info("update_in", { from: ctx.from?.id, type: ctx.updateType });
  return next();
});

bot.start(async (ctx) => {
  await ctx.reply("Привет! Я рабочий бот. Напиши /help");
});

bot.command("help", async (ctx) => {
  await ctx.reply([
    "Команды:",
    "/get <slug> — показать блок контента",
    "/set <slug>|Заголовок|Текст — обновить/создать блок (только админ)",
    "/admin — проверить доступ",
    "/list — список блоков (админ)",
  ].join("\n"));
});

bot.command("admin", async (ctx) => {
  const ok = await isAdmin(ctx.from.id);
  await ctx.reply(ok ? "Ты админ ✅" : "Нет доступа ❌");
});

bot.command("list", async (ctx) => {
  if (!await isAdmin(ctx.from.id)) return ctx.reply("Нет доступа ❌");
  const { data, error } = await supabase
    .from("content_blocks")
    .select("slug,title,updated_at")
    .order("updated_at", { ascending: false })
    .limit(30);
  if (error) return ctx.reply("Ошибка: " + error.message);
  if (!data?.length) return ctx.reply("Пусто");
  await ctx.reply(data.map(r => `• ${r.slug} — ${r.title}`).join("\n"));
});

bot.hears(/^\/get\s+(.+)/, async (ctx) => {
  const slug = ctx.match[1].trim();
  const { data, error } = await supabase
    .from("content_blocks")
    .select("*")
    .eq("slug", slug)
    .single();
  if (error || !data) return ctx.reply("Не найдено");
  await ctx.reply(`*${data.title}*\n\n${data.body}`, { parse_mode: "Markdown" });
});

bot.hears(/^\/set\s+(.+)/, async (ctx) => {
  if (!await isAdmin(ctx.from.id)) return ctx.reply("Нет доступа ❌");
  const payload = ctx.match[1];
  const parts = payload.split("|");
  const slug = (parts[0] || "").trim();
  const title = (parts[1] || "").trim();
  const body = parts.slice(2).join("|").trim();
  if (!slug || !title || !body) {
    return ctx.reply("Формат: /set slug|Заголовок|Текст");
  }
  const { data, error } = await supabase
    .from("content_blocks")
    .upsert({
      slug, title, body, updated_by: String(ctx.from.id)
    })
    .select()
    .single();
  if (error) return ctx.reply("Ошибка: " + error.message);
  await logger.info("content_updated", { slug, by: ctx.from.id });
  await ctx.reply(`OK: ${data.slug} обновлён`);
});

export const webhookCallback = bot.webhookCallback("/");