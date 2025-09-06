import express from "express";
import { bot, webhookCallback } from "./src/bot.js";
import { router as api } from "./src/routes.js";

const app = express();
app.use(express.json());

const secret = process.env.WEBHOOK_SECRET || "hook";
app.post(`/tg/${secret}`, webhookCallback);
app.use("/api", api);

import { addon as addonRoutes } from './src/routes.addon.js';
app.use('/api', addonRoutes);


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