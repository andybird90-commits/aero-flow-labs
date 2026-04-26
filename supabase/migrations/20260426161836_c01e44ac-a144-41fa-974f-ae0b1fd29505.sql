-- Public bucket so the 3D viewport can fetch HDRIs without signed URLs
insert into storage.buckets (id, name, public)
values ('hdri-backdrops', 'hdri-backdrops', true)
on conflict (id) do update set public = true;

-- Public read
create policy "HDRI backdrops are publicly readable"
on storage.objects
for select
to public
using (bucket_id = 'hdri-backdrops');

-- Authenticated users may upload into their own project folder (first folder
-- segment must be a project they own).
create policy "Users upload HDRIs into their own project folder"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'hdri-backdrops'
  and exists (
    select 1 from public.projects p
    where p.id::text = (storage.foldername(name))[1]
      and p.user_id = auth.uid()
  )
);

create policy "Users update HDRIs in their own project folder"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'hdri-backdrops'
  and exists (
    select 1 from public.projects p
    where p.id::text = (storage.foldername(name))[1]
      and p.user_id = auth.uid()
  )
);

create policy "Users delete HDRIs in their own project folder"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'hdri-backdrops'
  and exists (
    select 1 from public.projects p
    where p.id::text = (storage.foldername(name))[1]
      and p.user_id = auth.uid()
  )
);