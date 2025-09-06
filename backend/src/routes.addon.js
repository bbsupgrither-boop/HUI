import { Router } from 'express';
import { supabase } from './db.js';
import { validateInitData } from './telegramAuth.js';

export const addon = Router();

addon.post('/auth/telegram', async (req, res) => {
  const { initData } = req.body || {};
  if (!initData) return res.status(400).json({ error: 'initData required' });
  const ok = validateInitData(initData, process.env.BOT_TOKEN);
  if (!ok) return res.status(401).json({ error: 'invalid initData' });
  const params = new URLSearchParams(initData);
  const userJson = params.get('user');
  const user = JSON.parse(userJson);

  const up = await supabase
    .from('users')
    .upsert({
      tg_id: user.id,
      username: user.username || null,
      first_name: user.first_name || null,
      last_name: user.last_name || null,
      lang: user.language_code || null,
      photo_url: user.photo_url || null
    })
    .select('tg_id,username,first_name,last_name')
    .single();
  if (up.error) return res.status(500).json({ error: up.error.message });

  res.json({ user: { id: up.data.tg_id, username: up.data.username, name: [up.data.first_name, up.data.last_name].filter(Boolean).join(' ') } });
});

addon.post('/messages/send', async (req, res) => {
  const { toUserId, text } = req.body || {};
  if (!toUserId || !text) return res.status(400).json({ error: 'toUserId and text required' });
  const { error } = await supabase.from('messages').insert([{ to_tg_id: toUserId, text }]);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

addon.get('/messages/inbox', async (req, res) => {
  const { data, error } = await supabase.from('messages').select('*').order('created_at', { ascending: false }).limit(20);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ items: data });
});