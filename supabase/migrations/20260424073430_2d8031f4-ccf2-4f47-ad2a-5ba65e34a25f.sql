-- Unstick concept_sets that have at least one rendered concept but are still flagged generating.
-- Also covers the specific stuck set in this project.
UPDATE public.concept_sets cs
SET status = 'ready', updated_at = now()
WHERE cs.status = 'generating'
  AND cs.created_at < now() - interval '3 minutes'
  AND EXISTS (
    SELECT 1 FROM public.concepts c
    WHERE c.concept_set_id = cs.id
      AND c.render_front_url IS NOT NULL
  );