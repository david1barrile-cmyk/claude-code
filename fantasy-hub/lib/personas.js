// Team personas for the League Gazette: recurring characters with a voice, nickname,
// catchphrase and rival. Generated from how each team actually plays (trades, waiver
// activity, bench decisions, record, luck, titles), then overridable per team in
// data/personas.json so the league can write its own.
//
// Personas are characters of the *fantasy teams*: jokes stay on fantasy decisions,
// never anyone's real life.
import fs from 'node:fs';
import { config } from '../config.js';
import { cached } from './cache.js';
import * as S from './sleeper.js';
import { bestLineup } from './lineup.js';
import { getHistory } from './history.js';
import { gradeLeagueTrades } from './tradegrades.js';
import { leaguePicks } from './picks.js';

export const VOICES = {
  showman: { label: 'Swaggering Showman', catchphrase: 'Screenshot this.' },
  ceo: { label: 'Corporate CEO', catchphrase: "Let's circle back after the bye." },
  conspiracy: { label: 'Conspiracy Theorist', catchphrase: 'Follow the projections. Who benefits?' },
  zen: { label: 'Zen Philosopher', catchphrase: 'The standings are a river.' },
  optimist: { label: 'Delusional Optimist', catchphrase: "This is the week it turns around. I can feel it." },
  oldtimer: { label: 'Grizzled Old-Timer', catchphrase: 'Back in my day we set lineups on paper.' },
  nerd: { label: 'Analytics Nerd', catchphrase: 'Process over results. Check my all-play.' },
};

const ARCHETYPES = {
  dealer: { name: 'Wheeler-Dealer', voice: 'ceo', bio: (s) => `${s.trades} trades this year and counting. Has never met a roster that couldn't be "optimized."` },
  hawk: { name: 'Waiver Hawk', voice: 'nerd', bio: (s) => `${s.adds} pickups${s.faab ? ` and $${s.faab} of FAAB` : ''} this season. Refreshes the waiver wire the way other people check the weather.` },
  bench: { name: 'Bench Malpractice Artist', voice: 'oldtimer', bio: (s) => `Has left ${s.benchLeft} points on the bench this season, a league high. Calls it "trusting the guys."` },
  juggernaut: { name: 'The Juggernaut', voice: 'showman', bio: (s) => `${s.record} and ${s.rank === 1 ? 'first' : 'near the top'} in the standings. Already rehearsing the trophy speech.` },
  champ: { name: 'Reigning Champion', voice: 'showman', bio: (s) => `${s.titles > 1 ? `${s.titles}-time` : 'Defending'} league champion. Mentions it roughly every eleven minutes.` },
  cursed: { name: 'The Cursed', voice: 'conspiracy', bio: (s) => `${Math.abs(s.luck)} wins below what its scoring deserves. Believes the schedule maker has a personal vendetta.` },
  rebuilder: { name: 'The Rebuilder', voice: 'zen', bio: (s) => `${s.record}, holding ${s.picks1st || 'some'} future 1st${s.picks1st === 1 ? '' : 's'}, and at peace with all of it. Speaks of "the window" like it's a religious text.` },
  basement: { name: 'Basement Dweller', voice: 'optimist', bio: (s) => `${s.record}. Insists the turnaround starts next week, as it has every week since September.` },
  lucky: { name: "Fortune's Favorite", voice: 'showman', bio: (s) => `${s.luck} wins luckier than its scoring deserves. Calls it "clutch."` },
  steady: { name: 'The Professional', voice: 'nerd', bio: (s) => `${s.record}. Quietly competent, frustratingly reasonable, deeply boring to cover.` },
};

const norm = (s) => String(s || '').toLowerCase().trim();

function readOverrides() {
  try {
    const raw = JSON.parse(fs.readFileSync(config.personasFile, 'utf8'));
    return Array.isArray(raw) ? raw : raw.teams || [];
  } catch { return []; }
}

/** Score each team on each trait (0..1 within the league) and assign archetypes + voices. */
export function assignPersonas(stats) {
  const teams = Object.values(stats);
  const n = teams.length;
  const pct = (key, dir = 1) => {
    const sorted = [...teams].sort((a, b) => dir * (b[key] - a[key]));
    return (t) => (n > 1 ? 1 - sorted.indexOf(t) / (n - 1) : 0.5);
  };
  const p = { trades: pct('trades'), adds: pct('adds'), bench: pct('benchLeft'), wins: pct('winPct'), luck: pct('luck'), unluck: pct('luck', -1), loss: pct('winPct', -1) };
  const traits = (t) => [
    ['champ', t.titles > 0 && t.lastChamp ? 0.95 : 0],
    ['juggernaut', t.rank === 1 ? 0.9 : t.rank <= 2 ? 0.6 * p.wins(t) : 0],
    ['dealer', t.trades >= 6 ? p.trades(t) : 0],
    ['hawk', t.adds >= 10 ? p.adds(t) * 0.95 : 0],
    ['bench', p.bench(t) * 0.9],
    ['cursed', t.luck <= -1 ? p.unluck(t) * 0.9 : 0],
    ['lucky', t.luck >= 1 ? p.luck(t) * 0.85 : 0],
    ['basement', t.rank >= n - 1 ? 0.85 : 0],
    ['rebuilder', !t.contender && t.picks1st >= 2 ? 0.8 : !t.contender ? 0.4 : 0],
    ['steady', 0.3],
  ].sort((a, b) => b[1] - a[1]);

  // Strongest trait wins, but spread archetypes and voices so the cast isn't all one note.
  const usedArch = new Map(), usedVoice = new Map();
  const order = [...teams].sort((a, b) => traits(b)[0][1] - traits(a)[0][1]);
  const out = {};
  for (const t of order) {
    const ranked = traits(t);
    const [arch] = ranked.find(([a, sc]) => sc > 0 && !usedArch.has(a)) || ranked[0];
    usedArch.set(arch, true);
    let voice = ARCHETYPES[arch].voice;
    if (usedVoice.has(voice)) voice = Object.keys(VOICES).find((v) => !usedVoice.has(v)) || voice;
    usedVoice.set(voice, true);
    const secondary = ranked.find(([a, sc]) => a !== arch && sc >= 0.5)?.[0] ?? null;
    out[t.ownerId] = {
      team: t.team, ownerId: t.ownerId, archetype: ARCHETYPES[arch].name, archetypeKey: arch,
      secondary: secondary ? ARCHETYPES[secondary].name : null,
      voice, voiceLabel: VOICES[voice].label, catchphrase: VOICES[voice].catchphrase,
      nickname: `The ${ARCHETYPES[arch].name.replace(/^The /, '')}`,
      bio: ARCHETYPES[arch].bio(t), rival: t.rival ?? null, stats: t, source: 'auto',
    };
  }
  return out;
}

/** Apply league-written overrides from data/personas.json (matched by team name or Sleeper username). */
export function applyOverrides(personas, overrides) {
  for (const o of overrides) {
    const key = norm(o.team || o.owner);
    const p = Object.values(personas).find((x) => norm(x.team) === key || norm(x.stats?.owner) === key);
    if (!p) continue;
    for (const f of ['nickname', 'archetype', 'bio', 'catchphrase', 'rival', 'quotes', 'offLimits', 'signatureMove', 'nemesisPlayer', 'mascot']) if (o[f] != null) p[f] = o[f];
    if (o.voice && VOICES[o.voice]) { p.voice = o.voice; p.voiceLabel = VOICES[o.voice].label; if (o.catchphrase == null) p.catchphrase = VOICES[o.voice].catchphrase; }
    if (o.notes) p.notes = o.notes;
    p.source = 'league';
  }
  return personas;
}

export function getPersonas(ctx) {
  return cached(`personas:${ctx.league.league_id}`, 3 * 3600e3, async () => {
    const id = ctx.league.league_id;
    const weeks = ctx.completedWeeks;
    const [rosters, trades, hist, ...rest] = await Promise.all([
      S.getRosters(id), gradeLeagueTrades(ctx).catch(() => []), getHistory(id).catch(() => null),
      ...weeks.map((w) => S.getMatchups(id, w).catch(() => [])),
      ...weeks.map((w) => S.getTransactions(id, w).catch(() => [])),
    ]);
    const matchups = rest.slice(0, weeks.length), txs = rest.slice(weeks.length).flat();
    const rid2owner = Object.fromEntries(rosters.map((r) => [r.roster_id, r.owner_id]));
    const stats = {};
    ctx.teams.forEach((t, i) => {
      const g = t.wins + t.losses + t.ties;
      stats[t.ownerId] = { ownerId: t.ownerId, team: t.name, owner: t.owner, rank: i + 1, record: `${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ''}`,
        winPct: g ? (t.wins + t.ties / 2) / g : 0, contender: i < (ctx.league.settings?.playoff_teams || Math.ceil(ctx.teams.length / 2)),
        trades: 0, tradePartners: {}, adds: 0, faab: 0, benchLeft: 0, luck: 0, titles: 0, lastChamp: false, picks1st: 0 };
    });
    for (const t of trades) for (const s of t.sides) {
      const st = Object.values(stats).find((x) => x.team === s.team);
      if (!st) continue;
      st.trades++;
      for (const o of t.sides) if (o.team !== s.team) st.tradePartners[o.team] = (st.tradePartners[o.team] || 0) + 1;
    }
    for (const t of txs) {
      if (t.status !== 'complete' || t.type === 'trade') continue;
      for (const rid of Object.values(t.adds || {})) {
        const st = stats[rid2owner[rid]];
        if (st) { st.adds++; st.faab += t.settings?.waiver_bid || 0; }
      }
    }
    for (const rows of matchups) for (const r of rows || []) {
      const st = stats[rid2owner[r.roster_id]];
      if (!st || r.matchup_id == null) continue;
      const pp = r.players_points || {};
      const best = bestLineup(r.players || [], (pid) => ({ pos: ctx.players[pid]?.pos, pts: pp[pid] ?? 0 }), ctx.slots).total;
      st.benchLeft += Math.max(0, best - (r.points || 0));
    }
    if (hist) {
      const cur = hist.seasons.find((s) => String(s.season) === String(ctx.league.season));
      const lastDone = hist.seasons.find((s) => s.complete && s.champion);
      for (const st of Object.values(stats)) {
        const o = hist.owners.find((x) => x.ownerId === st.ownerId);
        st.titles = o?.titles ?? 0;
        st.lastChamp = lastDone?.champion === st.ownerId;
        const row = cur?.standings.find((x) => x.ownerId === st.ownerId);
        if (row && row.apW + row.apL) {
          const g = row.wins + row.losses + row.ties;
          st.luck = Math.round((row.wins + row.ties / 2 - (row.apW / (row.apW + row.apL)) * g) * 10) / 10;
        }
      }
    }
    const picks = await leaguePicks(ctx).catch(() => []);
    for (const t of ctx.teams) stats[t.ownerId].picks1st = picks.filter((pk) => pk.round === 1 && pk.owner === t.rosterId).length;
    for (const st of Object.values(stats)) {
      st.benchLeft = Math.round(st.benchLeft);
      const partners = Object.entries(st.tradePartners).sort((a, b) => b[1] - a[1]);
      st.rival = partners[0]?.[0] ?? null;
    }
    const personas = applyOverrides(assignPersonas(stats), readOverrides());
    return { personas, generatedAt: Date.now() };
  });
}

// ---------- quotes ----------
// situation: win | loss | blowoutWin | blowoutLoss | closeLoss | trade | bench | hot | cold | oddsUp | oddsDown
const QUOTES = {
  showman: {
    win: ['"I told everybody in August. Nobody listened. Now look."', '"Put it on a T-shirt. Actually, I already did."'],
    blowoutWin: ['"Was that a game? I thought it was a highlight reel."', '"I almost feel bad. Almost."'],
    loss: ['"Even legends take a week off. It\'s called load management."', '"A temporary dip in an otherwise flawless legacy."'],
    blowoutLoss: ['"I let them have that one. Charity is part of my brand."', '"Delete the box score. I\'m serious."'],
    closeLoss: ['"I lost by a rounding error. Morally, I won."'],
    trade: ['"I don\'t make trades. I make headlines."', '"You\'re welcome, everyone. That\'s how it\'s done."'],
    bench: ['"Those points weren\'t left on the bench. They were saved for the playoffs."'],
    hot: ['"Streak? I call it a lifestyle."'], cold: ['"The comeback documentary needs a dramatic middle act."'],
    oddsUp: ['"The computer finally caught up to what I\'ve been saying."'], oddsDown: ['"Simulations don\'t account for aura."'],
  },
  ceo: {
    win: ['"A strong quarter for the organization. Shareholders are pleased."', '"We executed on our core competencies this week."'],
    blowoutWin: ['"We exceeded guidance by a wide margin."'],
    loss: ['"We missed our targets, but the fundamentals remain strong."', '"We\'re reviewing the lineup process with all stakeholders."'],
    blowoutLoss: ['"This week does not reflect our values or our projections."'],
    closeLoss: ['"A narrow miss. We\'ll be leaning into accountability going forward."'],
    trade: ['"This acquisition creates real synergies across our skill-position portfolio."', '"We\'re excited to welcome new talent to the family. Integration starts Monday."'],
    bench: ['"We had untapped value on the bench. That\'s an opportunity, not a problem."'],
    hot: ['"Momentum is a leading indicator. We\'re bullish."'], cold: ['"We\'re pivoting. Everything is on the table, including the table."'],
    oddsUp: ['"Our forward-looking projections have been revised upward."'], oddsDown: ['"The market has priced in some short-term headwinds."'],
  },
  conspiracy: {
    win: ['"They let me win this one so I\'d stop asking questions. I won\'t."'],
    blowoutWin: ['"Interesting how the projections didn\'t see that coming. Very interesting."'],
    loss: ['"Same opponent scoring a season-high against me? Again? Sure. Coincidence."', '"I\'ve started a spreadsheet. The spreadsheet has started a spreadsheet."'],
    blowoutLoss: ['"I don\'t lose by that much without help."'],
    closeLoss: ['"Lost by a decimal. Who controls the decimals? Ask yourself that."'],
    trade: ['"I made this trade before they could make it impossible to make this trade."'],
    bench: ['"The app moved my players to the bench. I have no proof, and that IS the proof."'],
    hot: ['"Winning streak? That\'s exactly what they want me to think."'], cold: ['"The schedule was written by someone who knows where I live."'],
    oddsUp: ['"Ten thousand simulations and suddenly I\'m a contender. Convenient."'], oddsDown: ['"Ten thousand simulations. All of them against me. Do the math."'],
  },
  zen: {
    win: ['"A win is just a loss that hasn\'t happened yet."', '"I did not win. The week simply resolved in my favor."'],
    blowoutWin: ['"The scoreboard is loud. I am quiet."'],
    loss: ['"The loss is the teacher. I am a very educated man by now."', '"I am not 0-for-the-month. I am becoming."'],
    blowoutLoss: ['"To lose by that many points, you must first let go of points entirely."'],
    closeLoss: ['"A few points. A few breaths. The same thing, really."'],
    trade: ['"I did not trade a player. I released an attachment."', '"The 2028 first is not a pick. It is a promise."'],
    bench: ['"The bench and the lineup are one. Some weeks, the bench is more one."'],
    hot: ['"I do not count wins. They count themselves."'], cold: ['"The rebuild is a garden. I am simply watering it with losses."'],
    oddsUp: ['"The numbers rise. I remain."'], oddsDown: ['"Playoff odds are an illusion. The draft is real."'],
  },
  optimist: {
    win: ['"See?! SEE?! I said this was the week!"', '"Championship pace starts now. Mark it down."'],
    blowoutWin: ['"That\'s the team I drafted! Was it ever in doubt? (It was.)"'],
    loss: ['"Honestly a good loss. Lots to build on."', '"If you squint, we basically won."'],
    blowoutLoss: ['"That was rock bottom, which means everything is up from here!"', '"Great news: it can\'t get worse. (It can.)"'],
    closeLoss: ['"So close! Next week we win by that much, plus a lot."'],
    trade: ['"This trade changes everything. I can feel it in my bones."'],
    bench: ['"Those bench points show how deep we are! That\'s a positive!"'],
    hot: ['"Dynasty starts now. I\'m ordering the banner."'], cold: ['"Every great team had a losing streak. Probably. I assume."'],
    oddsUp: ['"The computers believe! Everyone believes!"'], oddsDown: ['"Zero percent is still a number, and numbers can change."'],
  },
  oldtimer: {
    win: ['"Set the lineup Tuesday, didn\'t touch it, won. That\'s how it\'s done."', '"Kids these days and their projections. I just watch the games."'],
    blowoutWin: ['"Old dog, same tricks. They still work."'],
    loss: ['"In my day you could lose a week and nobody wrote a newspaper about it."', '"I don\'t check the app. The app checks me."'],
    blowoutLoss: ['"Seen worse. Not recently. But I\'ve seen worse."'],
    closeLoss: ['"Lost by a field goal. We used to call that a moral victory. Still do."'],
    trade: ['"First trade I\'ve made since the flip phone. Don\'t get used to it."'],
    bench: ['"I set it and I forget it. Sometimes I forget it a little too well."'],
    hot: ['"Same lineup since Week 3. Why mess with it?"'], cold: ['"Streaks come and go. Mostly go."'],
    oddsUp: ['"Simulations. Back in my day we just said \'we\'ll see.\'"'], oddsDown: ['"Don\'t need a computer to tell me that. I have eyes."'],
  },
  nerd: {
    win: ['"Process held. Results finally agreed with the process."', '"Our all-play win rate was 86% this week. The H2H win was the least interesting part."'],
    blowoutWin: ['"Expected margin was nine. Actual margin was not nine. Variance is fun when it\'s yours."'],
    loss: ['"The lineup was +EV. The universe is -EV."', '"Small sample size. I\'m not changing anything."'],
    blowoutLoss: ['"Three-sigma event. Statistically, this was the opponent\'s problem too."'],
    closeLoss: ['"Lost by less than one standard deviation of noise. I\'m logging it as a push."'],
    trade: ['"The model liked this deal by 6%. I like the model."', '"Value-over-replacement says yes. My gut was not consulted."'],
    bench: ['"The bench points were within my projection interval. Barely. But within."'],
    hot: ['"Regression is coming for this streak and I will greet it like an old friend."'], cold: ['"My all-play record says I\'m fine. The standings disagree, rudely."'],
    oddsUp: ['"Finally, a simulation that respects sample size."'], oddsDown: ['"The confidence interval is wide. My confidence is not."'],
  },
};

const INTERVIEW_Q = {
  win: ['What was working for you this week?', 'Is this the start of something?'],
  blowoutWin: ['Did you feel bad at any point running up the score?', 'Is there anything your opponent could have done differently?'],
  loss: ['Walk us through the lineup decisions this week.', 'What do you say to fans who are worried?'],
  blowoutLoss: ['How do you bounce back from that?', 'At what point did you stop watching?'],
  closeLoss: ['How does it feel to lose by that little?', 'Any decision you would take back?'],
  trade: ['What made this the right deal for you?', 'Some say you lost this trade. Response?'],
  bench: ['Why were those points on the bench?', 'Will you be changing how you set lineups?'],
  hot: ['How long can this streak last?'], cold: ['Is it time to blow it up?'],
  oddsUp: ['The simulations love you now. Thoughts?'], oddsDown: ['The computer has given up on you. Have you?'],
};

function seeded(seed) { let x = seed >>> 0 || 1; return (arr) => { x = Math.imul(x ^ (x >>> 15), 2246822507) ^ Math.imul(x ^ (x >>> 13), 3266489909); x >>>= 0; return arr[x % arr.length]; }; }
const hashStr = (s) => [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0;

/** A quote in the team's voice for a situation (league-written quotes take priority). */
export function quoteFor(persona, situation, seedKey = '') {
  if (!persona) return null;
  const pick = seeded(hashStr(`${seedKey}:${persona.team}:${situation}`));
  const custom = persona.quotes?.[situation];
  if (Array.isArray(custom) && custom.length) return `"${pick(custom).replace(/^"|"$/g, '')}"`;
  const bank = QUOTES[persona.voice] || QUOTES.nerd;
  return pick(bank[situation] || bank.win);
}

/** Three-question mock interview for the week's featured team. */
export function mockInterview(persona, situations, seedKey = '') {
  if (!persona) return null;
  const pick = seeded(hashStr(`${seedKey}:${persona.team}:interview`));
  const qa = [];
  for (const sit of [...new Set(situations)].slice(0, 2)) {
    qa.push({ q: pick(INTERVIEW_Q[sit] || INTERVIEW_Q.win), a: quoteFor(persona, sit, `${seedKey}:${qa.length}`).replace(/^"|"$/g, '') });
  }
  qa.push({ q: 'Anything else you want to say to the league?', a: `${persona.catchphrase}` });
  return { team: persona.team, nickname: persona.nickname, voiceLabel: persona.voiceLabel, qa };
}

/** '"Quote."' + attribution -> '"Quote," said X' (keeps ! and ?). */
export function attribute(quote, who) {
  const q = quote.trim();
  const body = q.replace(/^"|"$/g, '');
  const end = /[!?]$/.test(body) ? body : `${body.replace(/[.,;:]$/, '')},`;
  return `"${end}" said ${who}.`;
}
