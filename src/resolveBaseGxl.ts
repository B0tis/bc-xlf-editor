import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Lists candidate `.g.xlf` base files for a locale translation file (deduplicated, sorted by path).
 * Used to auto-pick a single file or show a Quick Pick when several exist.
 */
export async function listBaseGxlCandidates(
  customUri: vscode.Uri,
  customContent: string
): Promise<vscode.Uri[]> {
  const seen = new Set<string>();
  const out: vscode.Uri[] = [];
  const pushFs = (p: string): void => {
    const norm = path.normalize(p);
    if (seen.has(norm)) {
      return;
    }
    seen.add(norm);
    out.push(vscode.Uri.file(norm));
  };

  const dir = path.dirname(customUri.fsPath);
  const baseName = path.basename(customUri.fsPath);
  if (/\.g\.xlf$/i.test(baseName)) {
    return [];
  }

  const stem = baseName.replace(/\.xlf$/i, '');
  const localeMatch = stem.match(/^(.+)\.([a-z]{2}(?:-[A-Z]{2})?)$/i);
  if (localeMatch) {
    const appStem = localeMatch[1];
    const candidate = path.join(dir, `${appStem}.g.xlf`);
    if (await fileExists(candidate)) {
      pushFs(candidate);
    }
  }

  const origMatch = customContent.match(/<file\b[^>]*\boriginal\s*=\s*"([^"]*)"/i);
  const orig = origMatch?.[1]?.trim();
  if (orig) {
    const lastSeg = orig.replace(/\\/g, '/').split('/').pop() ?? orig;
    const withoutExt = lastSeg.replace(/\.[^.]+$/, '');
    for (const name of [`${withoutExt}.g.xlf`, `${lastSeg}.g.xlf`]) {
      const candidate = path.join(dir, name);
      if (await fileExists(candidate)) {
        pushFs(candidate);
      }
    }
  }

  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return out.sort((a, b) => a.fsPath.localeCompare(b.fsPath));
  }
  const gxlf = entries.filter((e) => /\.g\.xlf$/i.test(e)).sort((a, b) => a.localeCompare(b));
  for (const f of gxlf) {
    pushFs(path.join(dir, f));
  }

  return out.sort((a, b) => a.fsPath.localeCompare(b.fsPath));
}
