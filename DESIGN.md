# Asset Evaluator Design System

## Product Tone

Asset Evaluator is a quiet production console for creative judgment. It should feel like a focused workspace for comparing visual evidence, not like a marketing dashboard or an AI toy.

## Layout

- Desktop-only v1. Editing and evaluation are blocked below `1024px`.
- The primary workspace has three fixed zones: left style profile navigation, center comparison workspace, right judgment panel.
- The default workspace mode is review, not setup. New profile and new context controls stay collapsed unless needed.
- The current candidate is the center workspace's main visual anchor. Source evidence appears near the candidate as a compact strip, never as a large grid that pushes the candidate below the first viewport.
- Candidate queue lives inside the candidate stage and shows per-candidate state: `Unevaluated`, `Draft`, `Saved`, or `Failed`.
- Profile references and saved history are secondary memory. Keep them available behind a collapsed tab or drawer so they do not compete with the active judgment cockpit.
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
- Internal data labels must be translated for the workspace UI: `profile_reference` -> `From profile`, `context_upload` -> `Uploaded for this context`, `root` -> `Base attempt`, `child` -> `Follow-up attempt`, and `source` -> `From saved guidance`.
- Low-confidence guidance must be visually distinct and never presented as final truth.
- Missing prompt and weak reference set states use inline warnings, not modal interruption.
- Candidate queue rows, prompt revision rows, and source evidence controls must be keyboard reachable with visible focus states.

## States

- Empty style profile: show a reference upload target and explain through field labels only.
- No candidate: keep the candidate well visible with upload and paste affordances.
- Evaluating: disable only the evaluate button and preserve manual judgment inputs.
- Model failure: keep Save Judgment available and show retry affordance.
- Invalid model JSON: preserve raw failure internally and show a concise recoverable error.
