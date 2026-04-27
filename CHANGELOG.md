# Changelog

## [0.1.1.0] - 2026-04-27

### Added
- Added a candidate queue inside the workspace review stage so users can scan every candidate's evaluation state without leaving the active judgment flow.
- Added a collapsed secondary memory area for profile references and saved judgment history, keeping the first viewport focused on the current candidate.

### Changed
- Reworked the workspace layout around a review-first flow with compact source evidence, a larger candidate visual anchor, and clearer saved/draft/failed judgment state.
- Renamed prompt lineage controls and labels to user-facing language such as `New base`, `Follow-up`, `Guidance`, and `Base attempt`.
- Collapsed new profile and new context setup controls by default so routine evaluation starts from the active context.

### Fixed
- Preserved `Follow-up` lineage mode while typing prompt text, preventing accidental new base revisions.
- Stabilized Playwright and CLI timeout tests so local startup and child process timing do not create false failures.
