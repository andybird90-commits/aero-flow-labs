

## Tidy workflow: Brief → Concepts only

Strip the studio down to the two steps you actually use (**Brief** and **Concepts**), and surface both export paths directly inside Concepts so there's no need for separate Parts / Refine / Library / Exports pages.

### What changes

**1. Sidebar + step nav (`AppSidebar.tsx`, `WorkspaceShell.tsx`)**

Studio steps reduce from 6 down to 2:

```text
Workspace
└─ Projects

Studio
├─ 1. Brief
└─ 2. Concepts
```

Remove from the visible nav: **Fitted Parts**, **Refine**, **Library**, **Exports**.

**2. Concepts page becomes the export hub (`Concepts.tsx`)**

Each concept card already has the two export paths — keep them, but make them clearer:

- **Pick parts** button (existing) → click any part on the render → "extracted" mesh STL download. This is the "usual method of grabbing".
- **Build aero kit from real STL** button (existing) → boolean subtract path. When ready, replace the current "View kit in Library →" link with an inline **Download combined kit STL** button right on the concept card.

Remove the post-approval banner that says "Generate parts → /parts" — no longer relevant.

**3. Routes (`App.tsx`)**

Redirect the removed pages to `/concepts` so old bookmarks don't 404:

```text
/parts    → /concepts
/refine   → /concepts
/library  → /concepts
/exports  → /concepts
```

Keep the page files in the repo (don't delete) so we can revive them later if needed — they just become unreachable from the UI.

**4. Misc cleanup**

- Remove `<Link to="/library">` / `/parts` / `/refine` references inside Concepts and any other surviving pages.
- `WorkspaceShell` `steps` array trimmed to Brief + Concepts.

### What stays untouched

- Brief page, full concept generation pipeline, Hyper3D Rodin meshify, hero-STL admin, boolean aero-kit edge functions, and the `concept_parts` / `concepts.aero_kit_url` data model — all unchanged.
- Old page files (`Parts.tsx`, `Refine.tsx`, `Library.tsx`, `Exports.tsx`) stay on disk but are unlinked from navigation.

### Result

A two-step flow: write the brief, generate concepts, then on each concept either pick individual parts (downloads STL) or hit "Build aero kit" (downloads a boolean-subtracted combined kit STL). No detours.

