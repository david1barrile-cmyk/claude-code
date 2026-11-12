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
