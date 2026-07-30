# BC XLF Editor

Merge / update from a generated **base** `.g.xlf` into existing locale XLIFF files. Parsing uses a streaming SAX pipeline; merge output is sorted and normalized for predictable Git diffs.

Matching follows the same order as [XLIFF Sync](https://github.com/rvanbekkum/vsc-xliff-sync): **id**, then Xliff Generator note (+ source / developer note), then optional copy by source, then parse-from-developer-note / copy-from-source. That keeps translations when Business Central regenerates new `trans-unit` hash ids.

## Features

- **Merge** base `.g.xlf` into a target translation file (updates in place on the file you choose as “custom”).
- **Strategies** (`keep-translated` vs `prefer-source`) when source text changes.
- **Optional** “BC XLF Editor” custom editor for browsing parsed `trans-unit` rows (virtualized list).
- **Git merge conflicts** in an `.xlf` file: a built-in panel shows **ours** vs **theirs** for each conflict block so you can pick a side without hand-editing markers first.
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
| `bcXlf.defaultStrategy` | `keep-translated` | When source changes: keep translations (`needs-adaptation`) or clear target. |
| `bcXlf.sortById` | `true` | Sort `trans-unit` by id in output. |
| `bcXlf.preserveRemoved` | `false` | Keep units only in the old translation file as `needs-review`. |
| `bcXlf.openDiffAfterMerge` | `true` | Try to open Git diff for the saved file after merge. |
| `bcXlf.findByXliffGeneratorNoteAndSource` | `true` | Rematch by Xliff Generator note + source when id changed. |
| `bcXlf.findByXliffGeneratorAndDeveloperNote` | `true` | Rematch by Xliff Generator note + developer note. |
| `bcXlf.findByXliffGeneratorNote` | `true` | Rematch by Xliff Generator note alone. |
| `bcXlf.findBySource` / `findBySourceAndDeveloperNote` | `false` | Copy translation from another unit with the same source (optional + developer note). |
| `bcXlf.detectSourceTextChanges` | `true` | Mark units when source text changed. |
| `bcXlf.parseFromDeveloperNote` | `false` | Parse `lang=text` entries from developer notes. |
| `bcXlf.copyFromSourceForSameLanguage` | `false` | Copy source → target when languages match. |

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
