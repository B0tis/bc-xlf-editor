# Change Log

All notable changes to the BC XLF Editor extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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
