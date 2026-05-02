create table public.user_generated_parts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Custom Part',
  description text,
  original_mesh_url text not null,
  deformed_mesh_url text,
  thumbnail_url text,
  deformation_handles jsonb not null default '[]',
  is_for_sale boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_generated_parts enable row level security;

create policy "Users see own parts"
  on public.user_generated_parts for select
  using (auth.uid() = user_id);

create policy "Users insert own parts"
  on public.user_generated_parts for insert
  with check (auth.uid() = user_id);

create policy "Users update own parts"
  on public.user_generated_parts for update
  using (auth.uid() = user_id);

create policy "Users delete own parts"
  on public.user_generated_parts for delete
  using (auth.uid() = user_id);

create trigger update_user_generated_parts_updated_at
  before update on public.user_generated_parts
  for each row execute function public.update_updated_at_column();