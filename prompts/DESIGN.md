# Design

**Status: awaiting approved token plan.** Until the block in §4 is filled in, do not write
styling beyond an unstyled reading page. Propose the plan, get it approved, paste it here,
then build against it.

---

## 1. Position

Minimalist here means *precise*, not *empty*. The restraint has to be earned by typography,
spacing, and detail. Strip decoration and put nothing rigorous in its place and it reads as
unfinished rather than restrained.

Spend boldness in exactly one place. Everything around the signature element stays quiet.

## 2. Fixed constraints

Not up for redesign.

- Single measured column, 62–70 characters, centered.
- A defined type scale and baseline spacing scale. Not browser defaults scaled up.
- Light and dark both first-class. Neither pure white nor pure black.
- Only images, diagrams, and comparison tables break the measure. Nothing else.
- Motion 150–250ms, `prefers-reduced-motion` honoured.
- Responsive to 375px. Comparison tables scroll horizontally with a sticky first column —
  never a squashed reflow.
- Visible keyboard focus on every interactive element. Accessibility 100.
- No layout shift on load. Smooth cross-page transitions.

## 3. Avoid — these are AI-design tells, not choices

- cream `#F4F1EA` + high-contrast serif + terracotta accent
- near-black + one acid-green or vermilion accent
- broadsheet pastiche: hairline rules, zero radius, dense newspaper columns
- purple/blue gradients, glassmorphism, component-library defaults
- the depth control as generic pill tabs, an iOS segmented toggle, or a four-bar
  signal-strength icon

## 4. Token plan

Fill this in and get it approved before Phase 2. Then review your own plan and revise
anything that reads like the default you'd generate for any documentation site.

```
Palette          4–6 named hex values, each with a stated job
                 (surface, raised, text, muted, accent, and at most one more)

Type             display / body / mono, with why the pairing works
Scale            the ratio and the actual sizes
Rhythm           baseline unit and the spacing steps derived from it

Layout           the concept in one sentence

Signature        the one element the site is remembered by, and why it earns
                 the boldness budget
```

**On the signature element.** The depth control is the strongest candidate — it is the one
thing here no other reading site has, and it carries the product's whole premise. But argue
for it rather than defaulting to it. Two properties it must have either way: it should
communicate *how deep you have already been* on this topic, not just where you are now, and
it should read as a continuum rather than four unrelated tabs.

## 5. Component notes

- **ToC** — quiet. No border, no box, no background. Type and spacing only. In Level 2 it
  shows the fixed subsection vocabulary, which makes it a predictable rail.
- **Callouts** — four types plus notes' three. The `🎯 interview note` is the most
  distinctive one on the site; give it its own treatment rather than a fourth colour of the
  same box.
- **Verify chip** — inline, small, unmistakably provisional without being alarming. It
  marks honest uncertainty, which is a feature.
- **Deprecated vs current** — Level 3 pairs these constantly. Whatever you choose must be
  legible at a glance and in dark mode, and must not rely on colour alone.
