import { Telegraf } from "telegraf";
import { supabase } from "./db.js";
import { logger } from "./logger.js";

bot.command('ping', (ctx) => ctx.reply('pong'));
bot.on('text', (ctx, next) => {
  // Лог для диагностики: что реально приходит
  console.log('[text]', ctx.message?.text, 'from', ctx.from?.id);
  return next();
});

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

bot.command('get', async (ctx) => {
  const txt = ctx.message?.text || '';
  // поддержим /get и /get@имябота
  const payload = txt.replace(/^\/get(@\S+)?\s*/i, '');
  const slug = payload.trim();
  if (!slug) return ctx.reply('Формат: /get slug');

  const { data, error } = await supabase
    .from('content_blocks')
    .select('*')
    .eq('slug', slug)
    .single();

  if (error || !data) return ctx.reply('Не найдено');
  await ctx.reply(`*${data.title}*\n\n${data.body}`, { parse_mode: 'Markdown' });
});

bot.command('set', async (ctx) => {
  // проверка админа
  const { data: a } = await supabase
    .from('admins').select('user_id').eq('user_id', ctx.from.id).limit(1);
  if (!a || a.length !== 1) return ctx.reply('Нет доступа ❌');

  const txt = ctx.message?.text || '';
  // поддержим /set и /set@имябота
  const payload = txt.replace(/^\/set(@\S+)?\s*/i, '');
  const parts = payload.split('|');
  const slug = (parts[0] || '').trim();
  const title = (parts[1] || '').trim();
  const body  = parts.slice(2).join('|').trim();
  if (!slug || !title || !body) {
    return ctx.reply('Формат: /set slug|Заголовок|Текст');
  }

  const { data, error } = await supabase
    .from('content_blocks')
    .upsert({ slug, title, body, updated_by: String(ctx.from.id) })
    .select()
    .single();

  if (error) return ctx.reply('Ошибка: ' + error.message);
  console.log('[content_updated]', { slug, by: ctx.from.id });
  await ctx.reply(`OK: ${data.slug} обновлён`);
});
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
