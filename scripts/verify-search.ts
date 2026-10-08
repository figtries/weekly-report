/**
 * The one search rule (lib/search.ts), asserted. Every search box in the app
 * goes through it, so a box that "finds nothing" for a word that is plainly on
 * screen fails here first. Written 8 Oct 2026, when "ci" on Document Control's
 * Data showed an empty list beside a group called Civil.
 *
 *   node scripts/verify-search.ts
 */
import assert from 'node:assert/strict';

import { matchesSearch, searchWords } from '../lib/search.ts';

const find = (q: string, ...fields: (string | null)[]) => matchesSearch(searchWords(q), ...fields);

// A group's name counts for the documents filed under it.
assert.ok(find('ci', 'Foundation Plan', 'MRB-GPF-CV-DWG-001', 'Civil'));
assert.ok(find('CIVIL', 'Foundation Plan', null, 'Civil'));
// Every word, any order, any field.
assert.ok(find('foundation civil', 'Foundation Plan', null, 'Civil'));
assert.ok(!find('foundation piping', 'Foundation Plan', null, 'Civil'));
// Separators typed differently from the stored number.
assert.ok(find('mrb gpf 001', 'Instrument Index', 'MRB-GPF-IN-RPT-001'));
assert.ok(find('MRB-GPF-IN', 'Instrument Index', 'MRB-GPF-IN-RPT-001'));
assert.ok(find('rpt_001', 'Instrument Index', 'MRB-GPF-IN-RPT-001'));
// Accents and case.
assert.ok(find('pondasi tangki', 'Pondasi Tangki Timbun'));
assert.ok(find('cafe', 'Café Building'));
// Outline codes keep their dots.
assert.ok(find('1.4.3', 'Pipe rack', '1.4.3.2'));
assert.ok(!find('1.5', 'Pipe rack', '1.4.3.2'));
// Nothing typed matches everything; a word that is nowhere matches nothing.
assert.ok(find('   ', 'anything'));
assert.ok(!find('zzz', 'Foundation Plan', 'MRB-GPF-CV-DWG-001', 'Civil'));

console.log('verify-search: ok');
