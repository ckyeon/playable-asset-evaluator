# Asset Evaluator Design System

## Product Tone

Asset Evaluator is a quiet production console for creative judgment. It should feel like a focused workspace for comparing visual evidence, not like a marketing dashboard or an AI toy.

## Layout

- Desktop-only v1. Editing and evaluation are blocked below `1024px`.
- The primary workspace has three fixed zones: left style profile navigation, center comparison workspace, right judgment panel.
- Reference assets appear before the candidate so the user judges fit against a visible style memory.
- Cards use small radius, compact padding, and predictable scan lines.

## Visual Tokens

- Background: `#f5f2ec`
- Surface: `#fffdf8`
- Raised surface: `#ffffff`
- Border: `#d8d1c4`
- Text: `#24211c`
- Muted text: `#6f675c`
- Accent: `#2f6f73`
- Accent strong: `#1e5356`
- Positive: `#2f7a4f`
- Warning: `#a66a16`
- Negative: `#a63f3f`
- Radius: `8px` max for cards, `6px` for controls
- Font: system sans-serif, no viewport-scaled type

## Components

- Buttons use icons where they represent familiar actions such as upload, copy, save, evaluate, and export.
- Fit score is shown as a compact numeric badge plus criterion rows, not a decorative gauge.
- Decision labels are `Good`, `Needs edit`, and `Reject`.
- Low-confidence guidance must be visually distinct and never presented as final truth.
- Missing prompt and weak reference set states use inline warnings, not modal interruption.

## States

- Empty style profile: show a reference upload target and explain through field labels only.
- No candidate: keep the candidate well visible with upload and paste affordances.
- Evaluating: disable only the evaluate button and preserve manual judgment inputs.
- Model failure: keep Save Judgment available and show retry affordance.
- Invalid model JSON: preserve raw failure internally and show a concise recoverable error.
