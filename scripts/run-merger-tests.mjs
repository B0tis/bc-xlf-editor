/**
 * Runs merger unit tests without launching VS Code (Cloud / CI friendly).
 */
import * as assert from 'assert';
import { mergeXlf } from '../out/xlfMerger.js';
import { defaultMergeOptions } from '../out/types.js';
import { applyMergeSurgically } from '../out/xlfSurgicalMerge.js';

function unit(partial) {
  return {
    target: '',
    targetState: 'needs-translation',
    ...partial
  };
}

function doc(units, langs = {}) {
  const map = new Map();
  const orderedIds = [];
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

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

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
  assert.strictEqual(result.units.get('new-hash')?.target, 'Kunde');
  assert.deepStrictEqual(result.stats.remapped, [{ fromId: 'old-hash', toId: 'new-hash' }]);
  assert.strictEqual(result.stats.added.length, 0);
  assert.strictEqual(result.stats.removed.length, 0);
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
  const merged = result.units.get('a');
  assert.strictEqual(merged.target, 'Hallo');
  assert.strictEqual(merged.targetState, 'needs-adaptation');
  assert.strictEqual(merged.syncNote, 'Source text has changed. Please review the translation.');
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
  const result = mergeXlf(base, custom, defaultMergeOptions({ strategy: 'prefer-source' }));
  assert.strictEqual(result.units.get('a').target, '');
  assert.strictEqual(result.units.get('a').targetState, 'needs-translation');
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
  assert.strictEqual(result.units.get('new1').target, 'Speichern');
  assert.strictEqual(result.units.get('new2').targetState, 'needs-translation');
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
  assert.strictEqual(result.units.get('a').target, 'Hallo aus Kommentar');
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

test('surgical update does not double-indent or insert blank lines', () => {
  const buffer = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">',
    '  <file source-language="en-US" target-language="de-DE" original="App" datatype="xml">',
    '    <body>',
    '      <group id="body">',
    '        <trans-unit id="a" translate="yes" xml:space="preserve">',
    '          <source>Hello</source>',
    '          <target state="translated" match-percent="100" origin-type="mt">Hallo</target>',
    '          <note from="Developer" annotates="general" priority="2"></note>',
    '          <note from="Xliff Generator" annotates="general" priority="3">Label Hello</note>',
    '        </trans-unit>',
    '        <trans-unit id="b" translate="yes" xml:space="preserve">',
    '          <source>Bye</source>',
    '          <target state="translated">Tschüss</target>',
    '          <note from="Developer" annotates="general" priority="2"></note>',
    '          <note from="Xliff Generator" annotates="general" priority="3">Label Bye</note>',
    '        </trans-unit>',
    '      </group>',
    '    </body>',
    '  </file>',
    '</xliff>'
  ].join('\n');

  const base = doc([
    unit({ id: 'a', source: 'Hello world', note: 'Label Hello' }),
    unit({ id: 'b', source: 'Bye', note: 'Label Bye' })
  ]);
  const custom = doc([
    unit({
      id: 'a',
      source: 'Hello',
      target: 'Hallo',
      targetState: 'translated',
      note: 'Label Hello',
      targetAttrs: { 'match-percent': '100', 'origin-type': 'mt' }
    }),
    unit({
      id: 'b',
      source: 'Bye',
      target: 'Tschüss',
      targetState: 'translated',
      note: 'Label Bye'
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

  assert.ok(out.includes('        <trans-unit id="a"'), out);
  assert.ok(!out.includes('              <trans-unit'), out);
  assert.ok(out.includes('match-percent="100"'), out);
  assert.ok(out.includes('origin-type="mt"'), out);
  assert.ok(out.includes('needs-adaptation'), out);
  assert.ok(out.includes('</trans-unit>\n        <trans-unit id="b"'), out);
  assert.ok(!out.includes('</trans-unit>\n\n        <trans-unit'), out);
});

test('preserves match-percent / origin-* on target through merge + surgical write', () => {
  const buffer = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">',
    '  <file source-language="en-US" target-language="de-DE" original="App" datatype="xml">',
    '    <body>',
    '      <group id="body">',
    '        <trans-unit id="a" size-unit="char" translate="yes" xml:space="preserve">',
    '          <source>Invoice</source>',
    '          <target state="translated" match-percent="100" origin-type="tm" origin-system="UI_ALL_DevOps">Rechnung</target>',
    '          <note from="Developer" annotates="general" priority="2"></note>',
    '          <note from="Xliff Generator" annotates="general" priority="3">Table Sales - Field Invoice</note>',
    '        </trans-unit>',
    '      </group>',
    '    </body>',
    '  </file>',
    '</xliff>'
  ].join('\n');

  const custom = doc([
    unit({
      id: 'a',
      source: 'Invoice',
      target: 'Rechnung',
      targetState: 'translated',
      note: 'Table Sales - Field Invoice',
      targetAttrs: {
        'match-percent': '100',
        'origin-type': 'tm',
        'origin-system': 'UI_ALL_DevOps'
      }
    })
  ]);
  const options = defaultMergeOptions({ sortOutput: false });
  const base2 = doc([
    unit({ id: 'a', source: 'Sales Invoice', note: 'Table Sales - Field Invoice' })
  ]);
  const result2 = mergeXlf(base2, custom, options);
  const header = {
    ...base2,
    targetLanguage: custom.targetLanguage,
    original: custom.original || base2.original
  };
  const out = applyMergeSurgically(buffer, custom, result2, result2.stats, options, header);
  assert.ok(out.includes('match-percent="100"'), out);
  assert.ok(out.includes('origin-type="tm"'), out);
  assert.ok(out.includes('origin-system="UI_ALL_DevOps"'), out);
  assert.ok(out.includes('state="needs-adaptation"'), out);
  assert.ok(out.includes('>Rechnung</target>'), out);
});

let failed = 0;
for (const t of tests) {
  try {
    t.fn();
    console.log(`ok - ${t.name}`);
  } catch (e) {
    failed++;
    console.error(`not ok - ${t.name}`);
    console.error(e);
  }
}
if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log(`\n${tests.length} passed`);
