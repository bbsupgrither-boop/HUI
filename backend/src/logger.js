import { supabase } from "./db.js";
export async function log(level, message, context = null) {
  console.log(`[${level}]`, message, context || "");
  try {
    await supabase.from("logs").insert([{ level, message, context }]);
  } catch (e) {
    console.error("[log->supabase] error:", e.message);
  }
}
export const logger = {
  info: (msg, ctx) => log("info", msg, ctx),
  error: (msg, ctx) => log("error", msg, ctx),
};