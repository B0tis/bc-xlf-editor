# Change Log
All notable changes to the BC XLF Editor extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).


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
