create extension if not exists pgcrypto;

create table if not exists public.logs (
  id uuid primary key default gen_random_uuid(),
  level text not null,
  message text not null,
  context jsonb,
  created_at timestamptz not null default now()
);
alter table public.logs enable row level security;
create policy if not exists "read logs" on public.logs for select using (true);

create table if not exists public.admins (
  user_id bigint primary key,
  note text,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;
create policy if not exists "read admins" on public.admins for select using (true);

create table if not exists public.content_blocks (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  body text not null,
  updated_by text,
  updated_at timestamptz not null default now()
);
create or replace function public.touch_content_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end; $$;

drop trigger if exists trg_touch_content on public.content_blocks;
create trigger trg_touch_content
before insert or update on public.content_blocks
for each row execute function public.touch_content_updated_at();

alter table public.content_blocks enable row level security;
create policy if not exists "read content" on public.content_blocks for select using (true);

-- Make yourself admin (replace 123456789 with your Telegram user id)
-- insert into public.admins(user_id, note) values (123456789, 'owner');