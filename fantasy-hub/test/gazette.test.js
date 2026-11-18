import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.MOCK = '1';
process.env.CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fh-gz-'));
const { getLeagueContext } = await import('../lib/league.js');
const { weekFacts, templateEdition, getEdition, editionWeeks } = await import('../lib/gazette.js');
const { makeAiWriter, validate, GAZETTE_MODEL } = await import('../lib/gazette-ai.js');

let ctx;
before(async () => { ctx = await getLeagueContext('9001'); });

test('weekFacts summarizes a completed week from league data', async () => {
  assert.deepEqual(editionWeeks(ctx), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const f = await weekFacts(ctx, 5);
  assert.equal(f.week, 5);
  assert.equal(f.scoreboard.length, 12);
  assert.equal(f.games.length, 6);
  assert.ok(f.games.every((g) => g.wPts >= g.lPts && g.margin >= 0));
  assert.equal(f.standings.length, 12);
  assert.ok(f.studs.length === 3 && f.studs[0].pts >= f.studs[1].pts);
  assert.equal(f.lookahead.week, 6);
  assert.ok(f.lookahead.gameOfWeek && f.race.spots > 0);
});

test('template edition is complete and stable for a given week', async () => {
  const f = await weekFacts(ctx, 5);
  const a = templateEdition(f, 'L'), b = templateEdition(f, 'L');
  assert.deepEqual(a, b);
  assert.equal(a.generator, 'templates');
  assert.ok(a.lead.headline && a.lead.body);
  assert.ok(a.stories.length >= 2 && a.briefs.length >= 1 && a.lookahead.length >= 1);
  // Facts make it into the copy.
  assert.ok(JSON.stringify(a).includes(f.highest.team));
});

const fakeClient = (reply, sink = {}) => ({
  beta: { messages: { create: async (params) => { sink.params = params; return reply; } } },
});
const goodEdition = {
  lead: { kicker: 'Upset Alert', headline: 'Team A Stuns Team B', body: 'It happened.' },
  stories: [{ kicker: 'Blowout', headline: 'Big Win', body: 'Very big.' }, { kicker: 'x', headline: '', body: 'dropped: empty headline' }],
  briefs: ['One.', ''], lookahead: [{ headline: 'Next Week', body: 'Soon.' }],
};

test('AI writer sends a structured-output request with refusal fallbacks', async () => {
  const sink = {};
  const writer = makeAiWriter({ client: fakeClient({ stop_reason: 'end_turn', model: GAZETTE_MODEL, content: [{ type: 'text', text: JSON.stringify(goodEdition) }] }, sink) });
  const f = await weekFacts(ctx, 5);
  const out = await writer(f);
  assert.equal(sink.params.model, 'claude-opus-5-5');
  assert.equal(sink.params.fallbacks, 'default');
  assert.deepEqual(sink.params.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(sink.params.output_config.format.type, 'json_schema');
  assert.equal(sink.params.output_config.effort, 'medium');
  assert.ok(!sink.params.messages[0].content.includes('"owner"'), 'internal ids are not sent');
  assert.equal(out.generator, 'claude');
  assert.equal(out.stories.length, 1); // invalid story filtered
  assert.deepEqual(out.briefs, ['One.']);
  assert.equal(makeAiWriter({ apiKey: '' }), null);
});

test('refusals and bad output fall back to the template writer', async () => {
  assert.throws(() => validate({ stories: [] }), /lead/);
  const refusing = makeAiWriter({ client: fakeClient({ stop_reason: 'refusal', stop_details: { category: 'general_harms' }, content: [] }) });
  await assert.rejects(refusing(await weekFacts(ctx, 5)), /declined/);
  const ed = await getEdition(ctx, 6, { aiWriter: refusing });
  assert.equal(ed.generator, 'templates');
  const garbage = makeAiWriter({ client: fakeClient({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'not json' }] }) });
  assert.equal((await getEdition(ctx, 7, { aiWriter: garbage })).generator, 'templates');
  const good = makeAiWriter({ client: fakeClient({ stop_reason: 'end_turn', model: GAZETTE_MODEL, content: [{ type: 'text', text: JSON.stringify(goodEdition) }] }) });
  const ai = await getEdition(ctx, 8, { aiWriter: good });
  assert.equal(ai.generator, 'claude');
  assert.equal(ai.scoreboard.length, 12); // scoreboard always comes from real data
});

const { assignPersonas, applyOverrides, quoteFor, mockInterview, VOICES } = await import('../lib/personas.js');
test('personas come from how teams play, spread voices, and accept league overrides', () => {
  const mk = (i, o) => ({ ownerId: `o${i}`, team: `T${i}`, owner: `m${i}`, rank: i, record: '5-5', winPct: 1 - i / 10, contender: i <= 4, trades: 1, adds: 2, faab: 0, benchLeft: 50, luck: 0, titles: 0, lastChamp: false, picks1st: 0, ...o });
  const stats = { o1: mk(1, {}), o2: mk(2, { trades: 12 }), o3: mk(3, { luck: -3 }), o4: mk(4, { benchLeft: 300 }), o5: mk(5, { adds: 40, faab: 90 }), o6: mk(6, {}), o7: mk(7, {}), o8: mk(8, {}) };
  const p = assignPersonas(stats);
  assert.equal(p.o1.archetype, 'The Juggernaut');
  assert.equal(p.o2.archetype, 'Wheeler-Dealer');
  assert.equal(p.o3.archetype, 'The Cursed');
  assert.equal(p.o5.archetype, 'Waiver Hawk');
  const voices = Object.values(p).map((x) => x.voice);
  assert.ok(new Set(voices).size >= Object.keys(VOICES).length - 1, 'voices spread across the cast');
  applyOverrides(p, [{ team: 't2', nickname: 'The Fleece Merchant', voice: 'zen', quotes: { trade: ['Nobody fleeces the fleecer.'] }, offLimits: ['2024 draft'] }]);
  assert.equal(p.o2.nickname, 'The Fleece Merchant');
  assert.equal(p.o2.voice, 'zen');
  assert.equal(p.o2.source, 'league');
  assert.equal(quoteFor(p.o2, 'trade'), '"Nobody fleeces the fleecer."');
  assert.equal(quoteFor(p.o1, 'win', 'x'), quoteFor(p.o1, 'win', 'x')); // stable
  const iv = mockInterview(p.o3, ['blowoutLoss', 'oddsDown'], 'k');
  assert.equal(iv.qa.length, 3);
  assert.equal(iv.qa[2].a, p.o3.catchphrase);
});

test('editions include a locker-room interview and the cast', async () => {
  const ed = await getEdition(ctx, 9, {});
  assert.ok(ed.interview && ed.interview.qa.length === 3);
  assert.equal(ed.cast.length, 12);
  assert.ok([ed.lead, ...ed.stories].some((s) => / said .+, known around the league as /.test(s.body)));
});
test('quote attribution punctuation', async () => {
  const { attribute } = await import('../lib/personas.js');
  assert.equal(attribute('"Seen worse."', 'X'), '"Seen worse," said X.');
  assert.equal(attribute('"See?! SEE?!"', 'X'), '"See?! SEE?!" said X.');
});
