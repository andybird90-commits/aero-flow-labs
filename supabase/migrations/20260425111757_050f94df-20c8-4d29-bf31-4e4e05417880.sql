DELETE FROM public.library_items
WHERE id = 'dc289c43-b55c-449e-83e8-945da105e8ee'
   OR (
     kind IN ('aero_kit_mesh','concept_part_mesh','prototype_part_mesh','geometry_part_mesh','cad_part_mesh')
     AND (
       asset_url IS NULL
       OR asset_url = ''
       OR asset_url LIKE 'http://localhost%'
       OR asset_url LIKE 'http://127.%'
     )
   );