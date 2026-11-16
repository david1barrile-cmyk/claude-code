// Optional AI writer for the League Gazette. Enabled when ANTHROPIC_API_KEY is set.
// One request per completed week; the result is cached on disk by gazette.js.
import Anthropic from '@anthropic-ai/sdk';

export const GAZETTE_MODEL = 'claude-opus-5-5';

const STORY = {
  type: 'object',
  properties: { kicker: { type: 'string' }, headline: { type: 'string' }, body: { type: 'string' } },
  required: ['kicker', 'headline', 'body'],
  additionalProperties: false,
};
const SCHEMA = {
  type: 'object',
  properties: {
    lead: STORY,
    stories: { type: 'array', items: STORY },
    briefs: { type: 'array', items: { type: 'string' } },
    lookahead: {
      type: 'array',
      items: { type: 'object', properties: { headline: { type: 'string' }, body: { type: 'string' } }, required: ['headline', 'body'], additionalProperties: false },
    },
    tradeDesk: {
      type: 'array',
      items: { type: 'object', properties: { headline: { type: 'string' }, body: { type: 'string' } }, required: ['headline', 'body'], additionalProperties: false },
    },
    interview: {
      type: 'object',
      properties: {
        team: { type: 'string' },
        qa: { type: 'array', items: { type: 'object', properties: { q: { type: 'string' }, a: { type: 'string' } }, required: ['q', 'a'], additionalProperties: false } },
      },
      required: ['team', 'qa'],
      additionalProperties: false,
    },
  },
  required: ['lead', 'stories', 'briefs', 'lookahead', 'tradeDesk', 'interview'],
  additionalProperties: false,
};

const SYSTEM = `You write a weekly satirical newspaper for a private fantasy football league, in the spirit of The Onion: deadpan headlines, mock-serious reporting, invented quotes from obviously fictional "sources", "experts" and "league officials".

You will receive one week's facts as JSON. Write the edition from those facts.

Rules:
- Every score, record, margin, player stat line, transaction and probability you mention must come from the facts. Never invent results, injuries, trades or numbers.
- Roast fantasy decisions and results only: lineups, luck, records, waiver spending, trades. Keep it good-natured; this is read by friends. No profanity, no insults about anyone's real life, appearance, job, family or identity.
- Team names are how managers are known; refer to teams by name. NFL players may be mentioned only in terms of their fantasy output in the facts; do not invent off-field events about them.
- "lead": the week's biggest story (an upset, blowout, nail-biter, or bench disaster). "stories": 4-6 more, each a different angle, covering as many different teams as the facts allow. "briefs": 4-6 one-sentence items. "lookahead": 2-3 items previewing next week and the playoff race (empty if there is no next week).
- "tradeDesk": exactly one item per entry in the facts' "tradeDesk" array, in the same order (empty array if there are none). Each is a satirical headline plus 3-5 sentences of trade analysis that uses the provided grades, value edges, lineup changes and notes. Never change or invent a grade; quote the grades given.
- "personas" gives each team a recurring character: nickname, voice, catchphrase, bio, rival, and sometimes a signature move, nemesis player, mascot or sample quotes written by the manager. Quote teams in their persona's voice, use nicknames and rivalries for running jokes, and reuse their own sample quotes when they fit. Never mention anything in a team's "offLimits" list, not even indirectly.
- "interview": a 3-question mock "Locker Room" interview with the team behind the lead story, answered fully in that team's persona voice, ending with its catchphrase.
- "kicker" is a 1-3 word section label (e.g. "Upset Alert", "Manager Malpractice", "Transactions").
- Headlines in Title Case, under 16 words. Bodies 2-4 sentences.`;

/** Returns a function (facts) => edition, or null if no API key is configured. */
export function makeAiWriter({ apiKey = process.env.ANTHROPIC_API_KEY, client } = {}) {
  if (!client && !apiKey) return null;
  const anthropic = client ?? new Anthropic({ apiKey });
  return async function writeEdition(facts) {
    const { scoreboard, ...rest } = facts;
    const clean = JSON.parse(JSON.stringify({ ...rest, scoreboard: scoreboard.map(({ owner, ...s }) => s) }, (k, v) => (k === 'owner' || k === 'winnerOwner' || k === 'loserOwner' ? undefined : v)));
    const response = await anthropic.beta.messages.create({
      model: GAZETTE_MODEL,
      max_tokens: 16000,
      // Server-side refusal fallback: if the model declines, the API reruns the request on a fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content: `Week ${facts.week} facts for ${facts.league} (${facts.season}):\n\n${JSON.stringify(clean)}` }],
    });
    if (response.stop_reason === 'refusal') throw new Error(`model declined (${response.stop_details?.category ?? 'unspecified'})`);
    if (response.stop_reason === 'max_tokens') throw new Error('response truncated');
    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const edition = validate(JSON.parse(text));
    return { generator: 'claude', model: response.model, ...edition };
  };
}

const str = (x) => typeof x === 'string' && x.trim().length > 0;
export function validate(e) {
  const story = (s) => s && str(s.kicker) && str(s.headline) && str(s.body);
  if (!story(e?.lead)) throw new Error('edition missing lead story');
  return {
    lead: e.lead,
    stories: (Array.isArray(e.stories) ? e.stories : []).filter(story).slice(0, 8),
    briefs: (Array.isArray(e.briefs) ? e.briefs : []).filter(str).slice(0, 8),
    lookahead: (Array.isArray(e.lookahead) ? e.lookahead : []).filter((x) => x && str(x.headline) && str(x.body)).slice(0, 4),
    tradeDesk: (Array.isArray(e.tradeDesk) ? e.tradeDesk : []).filter((x) => x && str(x.headline) && str(x.body)),
    interview: e.interview && str(e.interview.team) && Array.isArray(e.interview.qa) && e.interview.qa.some((x) => str(x?.q) && str(x?.a))
      ? { team: e.interview.team, qa: e.interview.qa.filter((x) => str(x?.q) && str(x?.a)).slice(0, 5) } : null,
  };
}
