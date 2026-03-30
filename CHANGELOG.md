# Changelog

All notable changes to **BC XLF Editor** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.2.0] — 2026-03-30

### Added

- **Update translation from `.g.xlf`** — The merge command is renamed and clarified: it syncs a locale file with a generated base (`.g.xlf`), not a generic “merge” of two arbitrary files.
- **Automatic base file resolution** — When you run the update from the palette or from the explorer, the extension tries to find the matching `.g.xlf` in the same folder (stem / `original` / single candidate). If several `.g.xlf` files exist, a **Quick Pick** lets you choose; if none match, the file dialog opens (defaulting to the translation file’s folder).
- **Surgical writes** — Update and custom-editor saves can rewrite **only changed `trans-unit` blocks** (plus header line and appends for new units), instead of re-serializing the whole file. Improves Git diffs. Falls back to full serialize if a surgical write fails. Controlled with `bcXlf.surgicalMerge` (default: on).
- **DeepL translation** — Per-row **DeepL** button in the BC XLF Editor; uses the XLF target language and optional **`source_lang`** from the file’s `source-language`. API key is stored with **BC XLF: Set DeepL API Key** / **Clear DeepL API Key** (secret storage, not settings). Settings: `bcXlf.deeplUseFreeApi`, `bcXlf.deeplTargetState`.
- **Filter: empty target only** — Checkbox to list rows where the target text is blank (whitespace only), independent of `target` state (useful when state and content disagree).
- **AL “Jump to source”** — Progress notification with file counts; **cancel** support; optional **narrow search** via Xliff Generator object hints (`**/*ObjectName*.al`) before scanning all `*.al` files.
- **Scroll / reveal** — `scrollToId` when the same XLF is open in a text editor (e.g. search/split); **XLF** reveal moves the cursor to the **`<target`** opening tag when possible.
- **Deferred buffer writes** — `bcXlf.applyEditsOnSaveOnly` (default: **on**): list edits and DeepL results stay in the panel model until **Save (Ctrl+S)**; the XML buffer is flushed in `onWillSaveTextDocument`. Panel title shows a **●** prefix while changes are pending; status line explains the behavior. Set to **off** for immediate buffer updates after each edit (previous behavior).

### Changed

- Command titles and messaging now say **update** / **translation from `.g.xlf`** instead of “merge” where it was misleading.
- **Reveal in XLF** uses `TextEditorRevealType.InCenterIfOutsideViewport` when jumping to the target region.
- README-oriented description in `package.json` / nls updated to describe “update from `.g.xlf`” rather than generic merge.

### Fixed (behavior / UX)

- Git diffs after update are much smaller when surgical merge is used and `sortById` does not force a full reorder in that path (surgical path preserves document order for existing units; new units are appended before `</group>`).

## [1.1.1]

### Added

- Extension **marketplace icon** (`images/icon.png`).

## [1.1.0]

### Changed

- Release version bump and packaging alignment with the feature set below (no functional changelog was maintained separately before 1.2.0).

### Notes (feature set at 1.1.x)

At this version the extension already included:

- **Merge** command: pick base `.g.xlf` and locale `.xlf`, merge in place with streaming SAX parsing.
- **Strategies** when source text changes: `keep-translated` vs `prefer-source` (`bcXlf.defaultStrategy`).
- **Sort** trans-units by id (`bcXlf.sortById`), **preserve removed** units (`bcXlf.preserveRemoved`).
- **Open Git diff** after merge (`bcXlf.openDiffAfterMerge`).
- **BC XLF Editor** custom editor: virtualized list of `trans-unit` rows, edit target and state, **AL** / **XLF** jump actions.
- **Git merge conflicts** in `.xlf`: panel with ours/theirs per block and accept-all.
- **Progress** notification when parsing/merging large files (over 1000 trans-units).

## [1.0.4]

### Changed

- Version / release housekeeping.

## [1.0.3]

### Changed

- Version / release housekeeping.
- Removed bundled `Translations` sample directory from the repo (extension behavior unchanged).

## [1.0.2]

### Added

- `repository` and `homepage` fields in `package.json` for marketplace / vsce links.

### Changed

- **MIT** license, **BC XLF Editor** display name and branding.
- **VS Code** engine raised to **^1.85.0**.

## [1.0.1]

### Changed

- Release and packaging fixes.

## [1.0.0]

### Added

- Initial **BC XLF Editor** extension: merge Business Central `.g.xlf` with locale `.xlf` files.
- Custom editor with list UI, conflict handling, and **jump to AL** (caption / ToolTip / Label literals in `.al` files).
- GitHub **release workflow** for packaging.

### Fixed

- **Jump to AL** behavior and related fixes.

[1.2.0]: https://github.com/B0tis/bc-xlf-editor/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/B0tis/bc-xlf-editor/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/B0tis/bc-xlf-editor/compare/v1.0.4...v1.1.0
[1.0.4]: https://github.com/B0tis/bc-xlf-editor/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/B0tis/bc-xlf-editor/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/B0tis/bc-xlf-editor/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/B0tis/bc-xlf-editor/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/B0tis/bc-xlf-editor/releases/tag/v1.0.0
