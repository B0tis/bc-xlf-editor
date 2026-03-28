# Change Log
All notable changes to the BC XLF Editor extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).


## [1.1.0] - 2026-03-28

Localization and merge-editor layout fixes. **Changed** lists the **1.0.3** performance work (repeated here for convenience) **and** further performance improvements added after 1.0.3 (partial buffer updates, host-side filtering, conflict fast path). **[1.0.3]** below still records that tag on its own.

### Added

- **Localization:** Display language support for **English** and **German** via `package.nls.json` / `package.nls.de.json` (manifest, commands, settings) and runtime `vscode.l10n` bundles under `l10n/`. Merge editor webview strings are built in the extension host and injected into the HTML so the custom editor follows the same locale as VS Code.

### Changed

- **Performance — merge command:** Counting `trans-unit` entries for progress reporting no longer builds a giant array of regex matches on very large files.
- **Performance — XLF / Git conflicts:** Resolving all merge conflicts in one action applies replacements in a single pass instead of re-scanning the file after each block. Locating the owning `trans-unit` for each conflict uses one index of open tags plus binary search instead of re-scanning the prefix for every block. Files without `<<<<<<<` markers skip the conflict regex and strip step and go straight to SAX parsing.
- **Performance — merge editor:** Hot paths use a lightweight conflict-marker check instead of full conflict analysis. “Jump to AL” scans `.al` files in an order ranked by Xliff note path hints so likely matches are found sooner. The custom editor HTML template is read from disk once per process. Refresh work is queued so overlapping parse requests do not run in parallel.
- **Performance — webview:** The virtual list updates visible rows with `replaceChildren` instead of removing nodes one by one.
- **Performance — partial buffer updates (after 1.0.3):** Editing a `trans-unit` in the merge editor can replace only that unit’s XML span when the buffer still matches the indexed range, instead of re-serializing the whole file each time (`buildTransUnitSpanIndex`, `serializeTransUnit`).
- **Performance — host-side filters (after 1.0.3):** Target-state and text filters are applied in the extension host before posting rows to the webview, so fewer rows are sent to the virtual list on large files.
- **Performance — Git conflict fast path (after 1.0.3):** For the merge editor, when the buffer still contains Git conflict markers, `parseXlf` can supply conflict metadata for the UI without a full SAX parse; the merge command continues to use `forceFullParse` so merges always see the full document.
- **Performance — conflict-only UI (after 1.0.3):** Until conflicts are resolved, the view focuses on the conflict panel and a cheap `trans-unit` count instead of building the full row list.
- **Settings:** Merge strategy enum values show localized labels and descriptions in the settings UI (`enumItemLabels` / `enumDescriptions`).

### Fixed

- **Merge editor layout:** The help line under the filters no longer steals vertical flex space from the translation list; the main header fills the webview and the row list receives the remaining height.
- **Webview height:** Replaced `100vh` on the document with `html` / `body` height `100%` so the UI tracks the editor pane when the window or split is resized (embedded webviews should not rely on viewport `vh`).
- **Git merge conflict panel:** Removed the fixed `max-height` on the conflict list so the scrollable area grows with the panel instead of leaving a large empty band below the cards when the conflict UI is shown.

## [1.0.3] - 2026-03-27

### Changed

- **Performance — merge command:** Counting `trans-unit` entries for progress reporting no longer builds a giant array of regex matches on very large files.
- **Performance — XLF / Git conflicts:** Resolving all merge conflicts in one action applies replacements in a single pass instead of re-scanning the file after each block. Locating the owning `trans-unit` for each conflict uses one index of open tags plus binary search instead of re-scanning the prefix for every block. Files without `<<<<<<<` markers skip the conflict regex and strip step and go straight to SAX parsing.
- **Performance — merge editor:** Hot paths use a lightweight conflict-marker check instead of full conflict analysis. “Jump to AL” scans `.al` files in an order ranked by Xliff note path hints so likely matches are found sooner. The custom editor HTML template is read from disk once per process. Refresh work is queued so overlapping parse requests do not run in parallel.
- **Performance — webview:** The virtual list updates visible rows with `replaceChildren` instead of removing nodes one by one.

## [1.0.1] - 2026-03-27

### Changed

- Minimum supported VS Code version is now **1.85** (previously 1.110); `engines.vscode` and `@types/vscode` updated so the extension remains installable on slightly older VS Code and Cursor builds without using APIs that require the latest release.

## [0.0.1] - 2026-03-27

### Added

- MIT license ([LICENSE.md](LICENSE.md)).
- Merge workflow: combine a Business Central compiler base file (`.g.xlf`) with a custom translation file; result is written to the custom file.
- Optional custom editor for `.xlf` files to browse `trans-unit` rows in a virtualized list.
- Commands: **BC XLF: Merge Translation Files** (command palette; explorer and editor title context when an `.xlf` is selected), **BC XLF: Show Last Merge Summary**.
- Settings under **BC XLF Editor**: `bcXlf.defaultStrategy`, `bcXlf.sortById`, `bcXlf.preserveRemoved`, `bcXlf.openDiffAfterMerge`.
- SAX streaming parser and stable serializer aimed at predictable Git diffs; progress notification when parsing large files (more than 1000 `trans-unit` entries).
- Optional Git diff after merge when the Git extension is available.
- Jump from the merge editor to matching `.al` source (where applicable).

### Changed

- Extension display name and user-facing copy use the **BC XLF Editor** branding (Marketplace display name, settings section title, custom editor tab label, merge progress notification, session summary document title).
