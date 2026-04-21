
## Fix concept generation so it actually responds to the brief

The Concepts step is producing near-stock cars even when the brief says "aggressive time attack". Looking at the screenshot: an aggressive time attack request returned two essentially OEM Audi TTs labeled "OEM+ refined". That means the brief intent (aggressiveness, build style, target discipline) is either being ignored, overridden by a default "subtle" template, or not being injected into the per-variation prompts.

This plan fixes the concept generator so the brief drives the output and adds visible controls so you can steer it.

## What's going wrong

There are three likely causes, all in `supabase/functions/generate-concepts`:

1. The variation labels (e.g. "OEM+ refined", "Track-focused", "Wide-body") are hardcoded and each one carries its own restrictive description ("subtle, road-friendly, no giant wing, no flared arches"). Those per-variation rules are overriding the brief.
2. The brief's aggression level / discipline (time attack, drift, stance, GT, rally) is not being weighted strongly enough in the prompt, or is appended after the variation template so the template wins.
3. The image model is being told to "preserve factory identity" globally, which kills aggressive transformations.

## What to build

### 1. Make the brief the primary driver, not the variation label

Rewrite the prompt assembly in `generate-concepts` so the order of authority is:

```text
1. Discipline (time attack / drift / stance / GT / rally / show)
2. Aggression level (subtle / moderate / aggressive / extreme)
3. User's free-text brief
4. Variation flavor (only used to differentiate the 4 tiles)
5. Car identity (only to keep it the same model + colour)
```

If the brief says "aggressive time attack", every variation must respect that. The variations then differ by *approach* (e.g. "GT3-style aero", "JDM time attack", "Euro touring car", "minimal track day") — not by aggression.

### 2. Replace the fixed "OEM+ refined / Track / Wide-body / Show" set with brief-aware variations

Generate the 4 variation labels and descriptions dynamically from the brief, using a quick text model call before the image calls:

- Input: discipline + aggression + brief text + car info
- Output: 4 short variation specs, each with `{ label, short_description, key_aero_features[] }`
- These are then used as the per-tile prompt seeds

This stops the situation where you ask for time attack and still get an "OEM+ refined" tile with "no giant wing".

### 3. Strip the "preserve factory identity" language for aggressive briefs

Conditionally swap the system prompt:

- subtle → keep current "preserve factory identity, restrained" wording
- moderate → "noticeably modified but street legal"
- aggressive → "heavily modified track car, factory identity is secondary to function"
- extreme → "full silhouette/wide-body/time attack build, OEM only as a starting point"

### 4. Add explicit aero requirements per discipline

When discipline = time attack, the prompt should require (unless the user says otherwise):
- large rear wing
- front splitter with canards
- hood vents or louvers
- wide fenders or over-fenders
- side skirts with strakes
- aggressive stance

Same approach for drift / stance / GT / rally — each discipline gets a baseline aero kit list that the model must include.

### 5. Surface the controls in the UI so you can override

In the Brief / Concepts UI, add explicit selectors instead of relying only on free text:

- **Discipline**: Time attack, Drift, Stance, GT, Rally, Show, Street
- **Aggression**: Subtle, Moderate, Aggressive, Extreme
- **Must include** (chips): Big wing, Wide body, Splitter, Canards, Diffuser, Hood vents, Roof scoop
- **Must avoid** (chips): same list, inverted

These map directly into the prompt. They are pre-filled from the brief text via a quick AI parse, but you can override.

### 6. Add a "Regenerate this tile" with a stronger steer

On each concept card, add a small **"More aggressive"** / **"Different direction"** button that re-runs only that tile with a stronger modifier appended. Avoids regenerating all 4.

### 7. Show the actual prompt used per tile

Add a small "View prompt" disclosure under each concept card. This makes it obvious when the prompt is the problem vs the model. Useful for you while we tune this.

## Files touched

- `supabase/functions/generate-concepts/index.ts` — prompt rewrite, dynamic variation generation, discipline/aggression branching
- `src/pages/Brief.tsx` — discipline + aggression + must-include/avoid controls
- `src/pages/Concepts.tsx` — per-tile regenerate, "view prompt" disclosure
- `src/lib/repo.ts` — pass new brief fields through
- `supabase/migrations/*` — add `discipline`, `aggression`, `must_include[]`, `must_avoid[]` to the brief/project record, plus `prompt_used` on the concept row

## Resulting behaviour

For a brief like "super aggressive time attack build":

- All 4 tiles arrive with big wings, splitters, canards, wide arches.
- Tiles differ by *style* (GT3 / JDM / Euro touring / minimal track) not by *aggressiveness*.
- "OEM+ refined" no longer appears unless aggression is set to subtle.
- You can click "More aggressive" on a single tile to push it further.
- You can see the exact prompt that produced each tile.

## Recommended first slice

1. Backend prompt rewrite in `generate-concepts` (biggest impact, fixes the immediate bug).
2. Dynamic variation labels from the brief.
3. Discipline + aggression selectors in the Brief UI.
4. Per-tile regenerate + "view prompt".
