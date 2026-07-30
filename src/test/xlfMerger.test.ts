import * as assert from 'assert';
import { mergeXlf } from '../xlfMerger';
import { defaultMergeOptions, TransUnit, XlfDocument } from '../types';
import { applyMergeSurgically } from '../xlfSurgicalMerge';

function unit(partial: Partial<TransUnit> & Pick<TransUnit, 'id' | 'source'>): TransUnit {
  return {
    target: '',
    targetState: 'needs-translation',
    ...partial
  };
}

function doc(
  units: TransUnit[],
  langs: { source?: string; target?: string } = {}
): XlfDocument {
  const map = new Map<string, TransUnit>();
  const orderedIds: string[] = [];
  for (const u of units) {
    map.set(u.id, u);
    orderedIds.push(u.id);
  }
  return {
    sourceLanguage: langs.source ?? 'en-US',
    targetLanguage: langs.target ?? 'de-DE',
    original: 'App',
    datatype: 'xml',
    units: map,
    orderedIds
  };
}

suite('XLIFF Sync matching (mergeXlf)', () => {
  test('matches by id and keeps translation', () => {
    const base = doc([unit({ id: 'a', source: 'Hello', note: 'Table 1 - Field 1' })]);
    const custom = doc([
      unit({
        id: 'a',
        source: 'Hello',
        target: 'Hallo',
        targetState: 'translated',
        note: 'Table 1 - Field 1'
      })
    ]);
    const result = mergeXlf(base, custom, defaultMergeOptions({ sortOutput: false }));
    assert.strictEqual(result.units.get('a')?.target, 'Hallo');
    assert.strictEqual(result.stats.unchanged, 1);
    assert.strictEqual(result.stats.added.length, 0);
  });

  test('rematches by Xliff Generator note + source when id changed', () => {
    const base = doc([
      unit({ id: 'new-hash', source: 'Customer', note: 'Table Customer - Field Name' })
    ]);
    const custom = doc([
      unit({
        id: 'old-hash',
        source: 'Customer',
        target: 'Kunde',
        targetState: 'translated',
        note: 'Table Customer - Field Name'
      })
    ]);
    const result = mergeXlf(base, custom, defaultMergeOptions({ sortOutput: false }));
    const merged = result.units.get('new-hash');
    assert.ok(merged);
    assert.strictEqual(merged.target, 'Kunde');
    assert.strictEqual(merged.targetState, 'translated');
    assert.deepStrictEqual(result.stats.remapped, [{ fromId: 'old-hash', toId: 'new-hash' }]);
    assert.strictEqual(result.stats.added.length, 0);
    assert.strictEqual(result.stats.removed.length, 0);
    assert.ok(!result.units.has('old-hash'));
  });

  test('rematches by Xliff Generator note alone', () => {
    const base = doc([
      unit({ id: 'id2', source: 'New caption', note: 'Page Sales - Control OK' })
    ]);
    const custom = doc([
      unit({
        id: 'id1',
        source: 'Old caption',
        target: 'OK',
        targetState: 'translated',
        note: 'Page Sales - Control OK'
      })
    ]);
    const result = mergeXlf(
      base,
      custom,
      defaultMergeOptions({
        sortOutput: false,
        findByXliffGeneratorNoteAndSource: false,
        findByXliffGeneratorAndDeveloperNote: false,
        findByXliffGeneratorNote: true,
        detectSourceTextChanges: false
      })
    );
    assert.strictEqual(result.units.get('id2')?.target, 'OK');
    assert.deepStrictEqual(result.stats.remapped, [{ fromId: 'id1', toId: 'id2' }]);
  });

  test('marks needs-adaptation when source changed (keep-translated)', () => {
    const base = doc([unit({ id: 'a', source: 'Hello world', note: 'n' })]);
    const custom = doc([
      unit({
        id: 'a',
        source: 'Hello',
        target: 'Hallo',
        targetState: 'translated',
        note: 'n'
      })
    ]);
    const result = mergeXlf(base, custom, defaultMergeOptions());
    const merged = result.units.get('a')!;
    assert.strictEqual(merged.target, 'Hallo');
    assert.strictEqual(merged.targetState, 'needs-adaptation');
    assert.strictEqual(merged.syncNote, 'Source text has changed. Please review the translation.');
    assert.deepStrictEqual(result.stats.conflicts, ['a']);
  });

  test('clears target when source changed (prefer-source)', () => {
    const base = doc([unit({ id: 'a', source: 'Hello world', note: 'n' })]);
    const custom = doc([
      unit({
        id: 'a',
        source: 'Hello',
        target: 'Hallo',
        targetState: 'translated',
        note: 'n'
      })
    ]);
    const result = mergeXlf(
      base,
      custom,
      defaultMergeOptions({ strategy: 'prefer-source' })
    );
    const merged = result.units.get('a')!;
    assert.strictEqual(merged.target, '');
    assert.strictEqual(merged.targetState, 'needs-translation');
    assert.strictEqual(merged.syncNote, undefined);
  });

  test('copies translation by source when findBySource is enabled', () => {
    const base = doc([
      unit({ id: 'new1', source: 'Save', note: 'Action Save A' }),
      unit({ id: 'new2', source: 'Cancel', note: 'Action Cancel' })
    ]);
    const custom = doc([
      unit({
        id: 'old1',
        source: 'Save',
        target: 'Speichern',
        targetState: 'translated',
        note: 'Action Save B'
      })
    ]);
    const result = mergeXlf(
      base,
      custom,
      defaultMergeOptions({
        sortOutput: false,
        findByXliffGeneratorNoteAndSource: false,
        findByXliffGeneratorAndDeveloperNote: false,
        findByXliffGeneratorNote: false,
        findBySource: true
      })
    );
    assert.strictEqual(result.units.get('new1')?.target, 'Speichern');
    assert.strictEqual(result.units.get('new1')?.targetState, 'translated');
    assert.strictEqual(result.units.get('new2')?.targetState, 'needs-translation');
  });

  test('parses translation from developer note', () => {
    const base = doc([
      unit({
        id: 'a',
        source: 'Hello',
        note: 'Label Hello',
        developerNote: 'en-US=Hello|de-DE=Hallo aus Kommentar'
      })
    ]);
    const custom = doc([], { target: 'de-DE' });
    const result = mergeXlf(
      base,
      custom,
      defaultMergeOptions({ parseFromDeveloperNote: true, sortOutput: false })
    );
    assert.strictEqual(result.units.get('a')?.target, 'Hallo aus Kommentar');
    assert.strictEqual(result.units.get('a')?.targetState, 'translated');
  });

  test('copies from source when languages match', () => {
    const base = doc([unit({ id: 'a', source: 'Invoice', note: 'n' })], {
      source: 'en-US',
      target: 'en-US'
    });
    const custom = doc([], { source: 'en-US', target: 'en-US' });
    const result = mergeXlf(
      base,
      custom,
      defaultMergeOptions({ copyFromSourceForSameLanguage: true })
    );
    assert.strictEqual(result.units.get('a')?.target, 'Invoice');
    assert.strictEqual(result.units.get('a')?.targetState, 'translated');
  });

  test('adds truly new units as needs-translation', () => {
    const base = doc([unit({ id: 'only-base', source: 'New', note: 'n' })]);
    const custom = doc([
      unit({
        id: 'only-custom',
        source: 'Gone',
        target: 'Weg',
        targetState: 'translated',
        note: 'other'
      })
    ]);
    const result = mergeXlf(base, custom, defaultMergeOptions({ preserveRemoved: false }));
    assert.strictEqual(result.units.get('only-base')?.targetState, 'needs-translation');
    assert.deepStrictEqual(result.stats.added, ['only-base']);
    assert.deepStrictEqual(result.stats.removed, ['only-custom']);
    assert.ok(!result.units.has('only-custom'));
  });

  test('surgical merge replaces remapped id in place', () => {
    const buffer = `<?xml version="1.0" encoding="utf-8"?>
<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">
  <file source-language="en-US" target-language="de-DE" original="App" datatype="xml">
    <body>
      <group id="body">
        <trans-unit id="old-hash" size-unit="char" translate="yes" xml:space="preserve">
          <source>Customer</source>
          <target state="translated">Kunde</target>
          <note from="Developer" annotates="general" priority="2"></note>
          <note from="Xliff Generator" annotates="general" priority="3">Table Customer - Field Name</note>
        </trans-unit>
      </group>
    </body>
  </file>
</xliff>`;
    const base = doc([
      unit({ id: 'new-hash', source: 'Customer', note: 'Table Customer - Field Name' })
    ]);
    const custom = doc([
      unit({
        id: 'old-hash',
        source: 'Customer',
        target: 'Kunde',
        targetState: 'translated',
        note: 'Table Customer - Field Name'
      })
    ]);
    const options = defaultMergeOptions({ sortOutput: false });
    const result = mergeXlf(base, custom, options);
    const header = {
      ...base,
      targetLanguage: custom.targetLanguage,
      original: custom.original || base.original
    };
    const out = applyMergeSurgically(buffer, custom, result, result.stats, options, header);
    assert.ok(out.includes('id="new-hash"'), out);
    assert.ok(!out.includes('id="old-hash"'), out);
    assert.ok(out.includes('Kunde'), out);
  });
});
