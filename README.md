# BC XLF Merger

VS Code extension for merging **Business Central** XLIFF translation files: compiler output (`.g.xlf`) with existing locale files (`de-DE.xlf`, etc.). Parsing uses a streaming SAX pipeline; merge output is sorted and normalized for predictable Git diffs.

## Features

- **Merge** base `.g.xlf` into a target translation file (updates in place on the file you choose as “custom”).
- **Strategies** (`keep-translated` vs `prefer-source`) when source text changes.
- **Optional** “BC XLF Merge View” custom editor for browsing parsed `trans-unit` rows (virtualized list).
- **Progress** notification for large files (over 1000 `trans-unit` entries).

## Commands

| Command | Description |
|--------|-------------|
| **BC XLF: Merge Translation Files** | Pick base (`.g.xlf`) and custom (translation) file, then merge. |
| **BC XLF: Merge Translation Files** (from explorer/title) | Same flow; context menu passes the selected `.xlf` as the custom file when applicable. |
| **BC XLF: Show Last Merge Summary** | Opens a summary of the last merge in this session. |

## Settings (`bcXlf.*`)

| ID | Default | Description |
|----|---------|-------------|
| `bcXlf.defaultStrategy` | `keep-translated` | When source changes: keep translations (mark review) or prefer empty target. |
| `bcXlf.sortById` | `true` | Sort `trans-unit` by id in output. |
| `bcXlf.preserveRemoved` | `false` | Keep units only in the old translation file as `needs-review`. |
| `bcXlf.openDiffAfterMerge` | `true` | Try to open Git diff for the saved file after merge. |

## Requirements

- **VS Code** version compatible with `engines.vscode` in `package.json`.
- **Git** extension (optional): used only if you use “open diff” after merge.

## Build and package

From the repository root:

```bash
pnpm install
pnpm run compile
```

Create a `.vsix` installable package:

```bash
pnpm run vsix
```

Install locally: **Extensions** → **⋯** → **Install from VSIX…**, or `code --install-extension <path-to-vsix>`.

## Release notes

### 0.0.1

Initial published build: merge command, custom merge editor view, SAX-based parser, stable serializer.
