import { Router } from "express";
import { supabase } from "./db.js";

export const router = Router();

router.get("/health", (req, res) => res.json({ ok: true }));

router.get("/content/:slug", async (req, res) => {
  const slug = req.params.slug;
  const { data, error } = await supabase
    .from("content_blocks")
    .select("slug,title,body,updated_at")
    .eq("slug", slug)
    .single();
  if (error) return res.status(404).json({ error: "Not found" });
  res.json(data);
});