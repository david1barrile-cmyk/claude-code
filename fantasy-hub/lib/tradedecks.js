// Trade pitch decks: every trade in the league's history as a mock "investor presentation"
// from one team's side, in the style of the deck a league manager built for a real trade.
//
// Slides: cover, forward-looking-statements disclaimer, the transaction, a spotlight per key
// asset received (stats as of the deal), strategic rationale (hold vs. execute timeline), a
// case study when this trade was funded by an asset from an earlier trade, the "scoreboard"
// for that chain of trades, and analyst coverage (today's market values and what has happened
// since). The numbers are real; the corporate voice is satire.
import { cached } from './cache.js';
import * as S from './sleeper.js';
import { leagueChain, getHistory } from './history.js';
import { hubWithPickLinks, getPickLinks } from './picklink.js';
import { scorePoints } from './metrics.js';
import { gradeLeagueTrades } from './tradegrades.js';
import { getPersonas, quoteFor, attribute } from './personas.js';
import { consolidatedTotal } from './leagueadjust.js';
import { draftSeason } from './picks.js';
import { getRookieBoard } from './rookies.js';

const median = (xs) => { const v = xs.filter((x) => x != null).sort((a, b) => a - b); return !v.length ? null : v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2; };
const r1 = (x) => Math.round(x * 10) / 10;
const ord = (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
const ROUND = ['', 'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const commas = (n) => Math.round(n).toLocaleString('en-US');
const hash = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
const pickOne = (arr, seed) => arr[hash(seed) % arr.length];

export const NFL = {
  ARI: ['Arizona Cardinals', '#97233F'], ATL: ['Atlanta Falcons', '#A71930'], BAL: ['Baltimore Ravens', '#241773'], BUF: ['Buffalo Bills', '#00338D'],
  CAR: ['Carolina Panthers', '#0085CA'], CHI: ['Chicago Bears', '#0B162A'], CIN: ['Cincinnati Bengals', '#FB4F14'], CLE: ['Cleveland Browns', '#311D00'],
  DAL: ['Dallas Cowboys', '#041E42'], DEN: ['Denver Broncos', '#FB4F14'], DET: ['Detroit Lions', '#0076B6'], GB: ['Green Bay Packers', '#203731'],
  HOU: ['Houston Texans', '#03202F'], IND: ['Indianapolis Colts', '#002C5F'], JAX: ['Jacksonville Jaguars', '#006778'], KC: ['Kansas City Chiefs', '#E31837'],
  LV: ['Las Vegas Raiders', '#000000'], LAC: ['Los Angeles Chargers', '#0080C6'], LAR: ['Los Angeles Rams', '#003594'], MIA: ['Miami Dolphins', '#008E97'],
  MIN: ['Minnesota Vikings', '#4F2683'], NE: ['New England Patriots', '#002244'], NO: ['New Orleans Saints', '#9F8958'], NYG: ['New York Giants', '#0B2265'],
  NYJ: ['New York Jets', '#125740'], PHI: ['Philadelphia Eagles', '#004C54'], PIT: ['Pittsburgh Steelers', '#101820'], SF: ['San Francisco 49ers', '#AA0000'],
  SEA: ['Seattle Seahawks', '#002244'], TB: ['Tampa Bay Buccaneers', '#D50A0A'], TEN: ['Tennessee Titans', '#0C2340'], WAS: ['Washington Commanders', '#5A1414'],
};

// ---------- every trade across the league's seasons ----------
function chainTrades(ctx) {
  return cached(`deck:trades:${ctx.league.league_id}`, 30 * 60e3, async () => {
    const chain = await leagueChain(ctx.league.league_id);
    const out = [];
    for (const lg of chain) {
      const isCurrent = lg.league_id === ctx.league.league_id;
      const [rosters, ...weeks] = await Promise.all([
        S.getRosters(lg.league_id).catch(() => []),
        ...Array.from({ length: 18 }, (_, i) => S.getTransactions(lg.league_id, i + 1).catch(() => [])),
      ]);
      const owner = Object.fromEntries((rosters || []).map((r) => [r.roster_id, r.owner_id]));
      const start = Date.parse((isCurrent && ctx.state.season_start_date) || `${lg.season}-09-04`);
      const seen = new Set();
      for (const t of weeks.flat()) {
        if (t?.type !== 'trade' || t.status !== 'complete' || seen.has(t.transaction_id)) continue;
        seen.add(t.transaction_id);
        const at = t.status_updated || t.created;
        const offseason = at < start;
        const pickKey = (p) => `${p.season}:${p.round}:${owner[p.roster_id] ?? `r${p.roster_id}`}`;
        const sides = (t.roster_ids || []).map((rid) => {
          const side = { rosterId: rid, ownerId: owner[rid] ?? `r${rid}`, received: [], sent: [], faabIn: 0, faabOut: 0 };
          for (const [pid, to] of Object.entries(t.adds || {})) if (to === rid) side.received.push({ kind: 'player', id: pid, fromRid: t.drops?.[pid] ?? null });
          for (const [pid, from] of Object.entries(t.drops || {})) if (from === rid) side.sent.push({ kind: 'player', id: pid, toRid: t.adds?.[pid] ?? null });
          for (const p of t.draft_picks || []) {
            const pk = { kind: 'pick', season: Number(p.season), round: p.round, origOwner: owner[p.roster_id] ?? `r${p.roster_id}`, key: pickKey(p) };
            if (p.owner_id === rid) side.received.push({ ...pk, fromRid: p.previous_owner_id });
            if (p.previous_owner_id === rid) side.sent.push({ ...pk, toRid: p.owner_id });
          }
          for (const b of t.waiver_budget || []) {
            if (b.receiver === rid) side.faabIn += b.amount;
            if (b.sender === rid) side.faabOut += b.amount;
          }
          for (const a of [...side.received, ...side.sent]) {
            if (a.fromRid != null) a.fromOwner = owner[a.fromRid] ?? null;
            if (a.toRid != null) a.toOwner = owner[a.toRid] ?? null;
          }
          return side;
        });
        out.push({ id: t.transaction_id, leagueId: lg.league_id, season: String(lg.season), at, week: offseason ? 0 : t.leg, offseason, sides });
      }
    }
    return out.sort((a, b) => a.at - b.at);
  });
}

// Every completed draft in the chain: "season:round:origOwner" -> { playerId, slot }.
function chainDrafted(ctx) {
  return cached(`deck:drafted:${ctx.league.league_id}`, 6 * 3600e3, async () => {
    const chain = await leagueChain(ctx.league.league_id);
    const out = {};
    for (const lg of chain) {
      const [drafts, rosters] = await Promise.all([S.getLeagueDrafts(lg.league_id).catch(() => []), S.getRosters(lg.league_id).catch(() => [])]);
      const owner = Object.fromEntries((rosters || []).map((r) => [r.roster_id, r.owner_id]));
      for (const d of drafts || []) {
        if (d.status !== 'complete') continue;
        const [full, picks] = await Promise.all([S.getDraft(d.draft_id).catch(() => null), S.getDraftPicks(d.draft_id).catch(() => [])]);
        const slotRid = full?.slot_to_roster_id || {};
        for (const p of picks || []) {
          const orig = owner[slotRid[p.draft_slot]];
          if (orig && p.player_id) out[`${d.season}:${p.round}:${orig}`] = { playerId: p.player_id, slot: p.draft_slot };
        }
      }
    }
    return out;
  });
}

// Raw season stats through a given week, plus positional ranks in league scoring.
function statsThrough(season, through, scoring) {
  return cached(`deck:stats:${season}:${through}:${hash(JSON.stringify(scoring))}`, 6 * 3600e3, async () => {
    const weeks = await Promise.all(Array.from({ length: through }, (_, i) => S.getWeekStats(season, i + 1, true).then((s) => ({ week: i + 1, s })).catch(() => ({ week: i + 1, s: {} }))));
    const P = {};
    for (const { week, s } of weeks) {
      for (const [pid, st] of Object.entries(s)) {
        if (!(st.off_snp > 0 || st.pass_att || st.rush_att || st.rec_tgt)) continue;
        const p = (P[pid] ||= { gp: 0, pts: 0, games: [], sum: {} });
        const pts = scorePoints(st, scoring);
        p.gp++; p.pts += pts;
        for (const k of ['pass_yd', 'pass_td', 'pass_att', 'rush_yd', 'rush_td', 'rush_att', 'rec', 'rec_yd', 'rec_td', 'rec_tgt', 'off_snp', 'tm_off_snp']) p.sum[k] = (p.sum[k] || 0) + (st[k] || 0);
        p.games.push({ week, pts: r1(pts), passYd: st.pass_yd || 0, rushYd: st.rush_yd || 0, recYd: st.rec_yd || 0, td: (st.pass_td || 0) + (st.rush_td || 0) + (st.rec_td || 0), rushTd: st.rush_td || 0, recTd: st.rec_td || 0 });
      }
    }
    return { season, through, players: P };
  });
}

// ---------- copy ----------
const pickTitle = (a) => `${a.season} ${ROUND[a.round] || ord(a.round)}-Round Pick`;
function headline(a, presenter) {
  if (a.kind === 'player') return a.name;
  if (a.became?.prospect) return a.became.name;
  if (a.became) return `${a.season} ${a.round}.${String(a.became.slot).padStart(2, '0')} (${a.became.name})`;
  return a.origOwner === presenter.ownerId ? `${presenter.team}'s Own ${pickTitle(a)}` : `the ${a.origTeam} ${pickTitle(a)}`;
}

function deckTitle(sent, recv, presenter, partners) {
  const players = (xs) => xs.filter((x) => x.kind === 'player' || x.became);
  const picks = (xs) => xs.filter((x) => x.kind === 'pick' && !x.became);
  const top = (xs) => [...xs].sort((a, b) => (b.value ?? 0) - (a.value ?? 0))[0];
  if (!sent.length || !recv.length) return { verb: 'A Transformational Partnership', title: `A Transformational Partnership with ${partners}` };
  if (sent.length === 1 && recv.length >= 3) return { verb: 'Strategic Monetization', title: `Strategic Monetization of ${headline(sent[0], presenter)}` };
  if (recv.length === 1 && sent.length >= 2) return { verb: 'Strategic Consolidation', title: `Strategic Consolidation: The Acquisition of ${headline(recv[0], presenter)}` };
  if (!players(sent).length && players(recv).length) return { verb: 'Accelerating the Window', title: `Accelerating the Window: Converting Draft Capital into ${players(recv).map((x) => x.pos).filter((v, i, a) => a.indexOf(v) === i).join(', ')} Production` };
  if (!players(recv).length && picks(recv).length) return { verb: 'Unlocking Long-Term Value', title: `Unlocking Long-Term Value: The ${top(sent).kind === 'player' ? top(sent).name : 'Veteran'} Divestiture` };
  const verb = pickOne(['A Strategic Realignment', 'Portfolio Optimization', 'Unlocking Synergies', 'A Value-Accretive Exchange'], `${presenter.ownerId}:${sent.map((a) => a.key).join()}`);
  return { verb: 'A Strategic Realignment', title: `${verb}: ${headline(top(sent), presenter)} for ${headline(top(recv), presenter)}` };
}

function tagline(sent, recv, seed) {
  const topSent = [...sent].sort((a, b) => (b.value ?? 0) - (a.value ?? 0))[0];
  const what = !topSent ? 'the position' : topSent.kind === 'pick' && !topSent.became ? 'the pick' : topSent.kind === 'pick' ? topSent.became.name : topSent.name;
  if (recv.length > sent.length + 1) return pickOne([`The Board still views ${what} as a franchise-defining asset. The consideration simply rose to meet that view.`, `Management did not want to sell ${what}. Management also cannot count, and the counterparty kept adding.`], seed);
  if (sent.length > recv.length + 1) return pickOne(['Quality over quantity. The Board has never been able to start four mid players at once anyway.', 'Four quarters for a dollar. The roster spots alone are a material benefit.'], seed);
  return pickOne(['A balanced exchange of value, vibes and roster spots. Both parties are expected to claim victory in the group chat.', 'Fair value, mutually agreed, immediately second-guessed.'], seed);
}

function disclaimers(presenter, partner, statsNote, seed, proposal = false) {
  return [
    { h: 'Forward-looking statements.', t: `This presentation contains forward-looking statements regarding player development, roster availability, draft position and ${partner}'s ability to continue being ${pickOne(['terrible', 'exactly as good as it has been', 'a willing trade partner'], seed)}. Words such as "expects," "believes," "will" and "obviously" are intended to identify such statements.` },
    { h: 'Risk factors.', t: 'Actual results may differ materially due to, among other things, unexpected competence by counterparties, favorable injury luck, coaching changes, depth-chart volatility, bye-week clustering and intervention by the fantasy football gods.' },
    { h: 'Non-GAAP measures.', t: `This presentation references "assets," "value" and "vibes." Vibes are not a recognized accounting measure and have been provided by ${presenter} Holdings without independent verification.` },
    proposal
      ? { h: 'This is an offer.', t: `Unlike most investor presentations, this one does constitute an offer, made to ${partner} in good faith and with excellent slide design. Acceptance is encouraged. Counteroffers will be reviewed by the Board, eventually.` }
      : { h: 'No offer or solicitation.', t: `This presentation does not constitute an offer to acquire any ${presenter} asset. However, management notes that its phone is on.` },
    { h: 'Market and industry data.', t: `Player statistics are drawn from Sleeper and reflect ${statsNote}. Trade values are today's KeepTradeCut, FantasyCalc and DynastyProcess figures, not the values at the time of the deal.` },
  ];
}

// ---------- spotlight slides ----------
function eyebrowFor(a, line) {
  const sh = line?.sum.tm_off_snp ? line.sum.off_snp / line.sum.tm_off_snp : 0;
  if (!line) return a.rookie || (a.age && a.age <= 23) ? 'THE PROSPECT' : 'THE ASSET';
  if (a.pos === 'QB') return 'THE QUARTERBACK';
  if (a.pos === 'RB') return sh >= 0.5 ? 'THE LEAD BACK' : 'THE BACKFIELD PIECE';
  if (a.pos === 'TE') return 'THE TIGHT END';
  const ypr = line.sum.rec ? line.sum.rec_yd / line.sum.rec : 0;
  if (ypr >= 14) return 'THE BIG-PLAY RECEIVER';
  if (line.sum.rec_tgt / line.gp >= 7) return 'THE TARGET MAGNET';
  return 'THE RECEIVER';
}

function spotlight(a, stats, ranks, window, seed) {
  const line = stats?.players[a.id];
  const thru = window.label;
  const rank = ranks?.[a.id];
  const out = { asset: a, eyebrow: eyebrowFor(a, line?.gp ? line : null), statsNote: window.note, stats: [], callout: '' };
  if (!line?.gp) {
    out.stats = [
      a.age ? { big: String(a.age), label: 'years old' } : null,
      a.posRank ? { big: `${a.pos}${a.posRank}`, label: "in today's dynasty market" } : null,
      a.college ? { big: a.college.length > 14 ? a.college.split(' ').map((w) => w[0]).join('') : a.college, label: a.college.length > 14 ? a.college : 'college' } : null,
    ].filter(Boolean);
    out.callout = pickOne(['No NFL statistics yet. The upside is therefore, technically, unlimited.', 'Has never had a bad NFL game. Has never had an NFL game. These facts are related.', 'Pre-revenue. Strong vision. Excellent headshot.'], seed);
    return out;
  }
  const s = line.sum, g = line.games, gp = line.gp;
  const best = (k) => [...g].sort((x, y) => y[k] - x[k])[0];
  if (a.pos === 'QB') {
    const big = g.filter((x) => x.passYd >= 250).length;
    out.stats = [
      { big: commas(s.pass_yd), label: `passing yards ${thru}` },
      { big: String(s.pass_td), label: 'passing touchdowns' },
      { big: String(Math.round(s.pass_yd / gp)), label: 'passing yards per game' },
    ];
    out.callout = big >= Math.ceil(gp / 2) ? `Over 250 passing yards in ${big} of his ${gp} games. Volume is the product.`
      : s.rush_yd >= 150 ? `Adds ${commas(s.rush_yd)} rushing yards. Legs are a renewable resource.`
        : `${rank ? `QB${rank} in league scoring. ` : ''}A starting quarterback in a superflex league is a regulated utility.`;
  } else if (a.pos === 'RB') {
    const b = best('rushYd');
    out.stats = [
      s.tm_off_snp ? { big: `${Math.round((s.off_snp / s.tm_off_snp) * 100)}%`, label: 'of offensive snaps in games played' } : { big: String(s.rush_att), label: 'carries' },
      { big: String(s.rush_td + s.rec_td), label: `total touchdowns ${thru}` },
      { big: String(b.rushYd), label: `rushing yards${b.rushTd ? ` and ${b.rushTd} TD${b.rushTd > 1 ? 's' : ''}` : ''} in Week ${b.week}, his best game` },
    ];
    out.callout = rank && rank <= 24 ? `RB${rank} in league scoring at ${r1(line.pts / gp)} points per game. Touches are the product.` : `${r1(line.pts / gp)} points per game. The Board notes running backs are a renewable resource, just not on this roster.`;
  } else {
    const b = best('recYd');
    out.stats = [
      { big: String(b.recYd), label: `receiving yards in Week ${b.week}, a season high` },
      { big: commas(s.rec_yd), label: `receiving yards and ${s.rec_td} TD${s.rec_td === 1 ? '' : 's'} ${thru}` },
      s.rec ? { big: r1(s.rec_yd / s.rec).toFixed(1), label: 'yards per catch' } : { big: String(s.rec_tgt), label: 'targets' },
    ];
    out.callout = rank && rank <= 24 ? `${a.pos}${rank} in league scoring at ${r1(line.pts / gp)} points per game.` : pickOne(['Route-running described internally as "fine, honestly."', 'Catches the ball when it is thrown to him. Further throwing is expected.'], seed);
  }
  return out;
}

function pickSpotlight(a, link, presenter) {
  const out = { asset: a, eyebrow: 'THE DRAFT CAPITAL', statsNote: "Today's standings and market", stats: [], callout: '' };
  if (link?.outcomes?.length) {
    const o = link.outcomes[0];
    out.stats.push({ big: o.label, label: `most likely slot (${o.prob}% chance) on today's projected order` });
    out.stats.push({ big: o.prospect.name.split(' ').slice(-1)[0], label: `${o.prospect.name} (${o.prospect.pos}), the prospect most likely available there` });
  } else {
    out.stats.push({ big: `${a.season}`, label: 'draft year' });
  }
  if (a.value) out.stats.push({ big: commas(a.value), label: "consensus market value today" });
  out.callout = a.origOwner === presenter.ownerId ? 'The Board retains its own draft seat and, with it, full control of its own destiny.'
    : `Value is linked to ${a.origTeam}'s continued performance, which the Board follows closely and with optimism.`;
  return out;
}

// ---------- the deck ----------
export function getDeckIndex(ctx) {
  return cached(`deck:index:${ctx.league.league_id}`, 30 * 60e3, async () => {
    const [trades, hist, val] = await Promise.all([chainTrades(ctx), getHistory(ctx.league.league_id).catch(() => null), valuer(ctx)]);
    const nameOf = (o) => ctx.teams.find((t) => t.ownerId === o)?.name ?? hist?.names?.[o]?.name ?? 'Former manager';
    return {
      trades: trades.filter((t) => t.sides.some((s) => s.received.length || s.sent.length)).map((t) => ({
        id: t.id, season: t.season, at: t.at, week: t.week, offseason: t.offseason,
        sides: t.sides.map((s) => ({ ownerId: s.ownerId, team: nameOf(s.ownerId), received: s.received.map((a) => val.asset(a).label), count: s.received.length })),
      })).reverse(),
    };
  });
}

function valuer(ctx) {
  return cached(`deck:valuer:${ctx.league.league_id}`, 30 * 60e3, async () => {
    const [hub, drafted, links, hist] = await Promise.all([hubWithPickLinks(ctx), chainDrafted(ctx), getPickLinks(ctx).catch(() => null), getHistory(ctx.league.league_id).catch(() => null)]);
    const { ktc, fc, dp, adjusted } = hub._raw;
    const nameOf = (o) => ctx.teams.find((t) => t.ownerId === o)?.name ?? hist?.names?.[o]?.name ?? 'a former manager';
    const ridOf = (o) => ctx.teams.find((t) => t.ownerId === o)?.rosterId;
    const pickVals = {};
    for (const t of hub.teams) for (const pk of t.picks) pickVals[pk.key] = { market: median([pk.values.KTC, pk.values.FC, pk.values.DP]), adj: pk.values.Adj, owner: pk.owner, slot: pk.slot };
    const posRank = {};
    if (ktc.ok) {
      const byPos = {};
      for (const [pid, v] of Object.entries(ktc.players)) { const pos = ctx.players[pid]?.pos; if (pos) (byPos[pos] ||= []).push([pid, v.value]); }
      for (const list of Object.values(byPos)) list.sort((a, b) => b[1] - a[1]).forEach(([pid], i) => { posRank[pid] = i + 1; });
    }
    const player = (pid) => {
      const p = ctx.players[pid] || {};
      return {
        kind: 'player', id: pid, key: `p:${pid}`, name: p.name ?? `Player ${pid}`, label: p.name ?? `Player ${pid}`, pos: p.pos ?? '?', nfl: p.team ?? null,
        nflName: NFL[p.team]?.[0] ?? (p.team ? p.team : 'Free agent'), color: NFL[p.team]?.[1] ?? '#1b2a44', age: p.age ?? null, college: p.college ?? null,
        rookie: p.exp === 0, posRank: posRank[pid] ?? null,
        value: Math.round(median([ktc.ok ? ktc.players[pid]?.value : null, fc.ok ? fc.players[pid]?.value : null, dp.ok ? dp.players[pid]?.value : null]) ?? 0),
        adj: adjusted.players?.[pid]?.value ?? null,
      };
    };
    const asset = (a) => {
      if (a.kind === 'player') return { ...player(a.id), fromOwner: a.fromOwner, toOwner: a.toOwner };
      const used = drafted[a.key];
      const origTeam = nameOf(a.origOwner);
      const base = { kind: 'pick', key: `k:${a.key}`, season: a.season, round: a.round, origOwner: a.origOwner, origTeam, fromOwner: a.fromOwner, toOwner: a.toOwner };
      if (used && ctx.players[used.playerId]) {
        const pl = player(used.playerId);
        return { ...base, became: { playerId: used.playerId, name: pl.name, slot: used.slot, pos: pl.pos }, label: `${a.season} ${a.round}.${String(used.slot).padStart(2, '0')} → ${pl.name}`, value: pl.value, adj: pl.adj };
      }
      const rid = ridOf(a.origOwner);
      const pv = rid != null ? pickVals[`${a.season}:${a.round}:${rid}`] : null;
      const slot = pv?.slot;
      return { ...base, slot, label: `${a.season} ${slot ? `${a.round}.${String(slot).padStart(2, '0')}` : `Round ${a.round}`} (${origTeam})`,
        value: Math.round(pv?.market ?? 0), adj: pv?.adj ?? null, used: a.season < draftSeason(ctx.league), link: links?.picks?.[`${a.season}:${a.round}:${rid}`] ?? null };
    };
    // Still held today by this owner?
    const held = (a, ownerId) => {
      const t = ctx.teams.find((x) => x.ownerId === ownerId);
      if (!t) return false;
      if (a.kind === 'player') return t.ids.includes(a.id);
      if (a.became) return t.ids.includes(a.became.playerId);
      const rid = ridOf(a.origOwner);
      const pv = rid != null ? pickVals[`${a.season}:${a.round}:${rid}`] : null;
      return pv ? pv.owner === t.rosterId : null;
    };
    return { asset, held, nameOf, n: ctx.teams.length };
  });
}

/**
 * A trade that hasn't happened: built from the Trade Analyzer's two sides.
 * aRid/bRid are roster ids; aSends/bSends are player ids and pick keys "season:round:origRosterId".
 */
export function proposalTrade(ctx, { aRid, bRid, aSends, bSends }) {
  const A = ctx.teams.find((t) => t.rosterId === Number(aRid)), B = ctx.teams.find((t) => t.rosterId === Number(bRid));
  if (!A || !B || A === B) return null;
  const raw = (id, from, to) => {
    const m = /^(\d{4}):(\d+):(\d+)$/.exec(id);
    if (m) {
      const orig = ctx.teams.find((t) => t.rosterId === Number(m[3]));
      if (!orig) return null;
      return { kind: 'pick', season: Number(m[1]), round: Number(m[2]), origOwner: orig.ownerId, key: `${m[1]}:${m[2]}:${orig.ownerId}`, fromOwner: from.ownerId, toOwner: to.ownerId };
    }
    return from.ids.includes(id) ? { kind: 'player', id, fromOwner: from.ownerId, toOwner: to.ownerId } : null;
  };
  const aOut = aSends.map((id) => raw(String(id), A, B)).filter(Boolean).slice(0, 15);
  const bOut = bSends.map((id) => raw(String(id), B, A)).filter(Boolean).slice(0, 15);
  if (!aOut.length || !bOut.length) return null;
  const start = Date.parse(ctx.state.season_start_date || `${ctx.league.season}-09-04`);
  const at = Date.now();
  return {
    id: 'proposal', proposal: true, leagueId: ctx.league.league_id, season: String(ctx.league.season), at,
    week: at < start || !ctx.currentWeek ? 0 : ctx.currentWeek, offseason: at < start || !ctx.currentWeek,
    sides: [
      { rosterId: A.rosterId, ownerId: A.ownerId, received: bOut, sent: aOut, faabIn: 0, faabOut: 0 },
      { rosterId: B.rosterId, ownerId: B.ownerId, received: aOut, sent: bOut, faabIn: 0, faabOut: 0 },
    ],
  };
}

export async function getDeck(ctx, tradeId, ownerId, proposal = null, assume = null) {
  const [trades, val, cast, grades, hist] = await Promise.all([
    chainTrades(ctx), valuer(ctx), getPersonas(ctx).catch(() => null), gradeLeagueTrades(ctx).catch(() => []), getHistory(ctx.league.league_id).catch(() => null),
  ]);
  const t = proposal || trades.find((x) => String(x.id) === String(tradeId));
  if (!t) return null;

  // "What if" scenario: a next-draft pick in this trade becomes a named prospect.
  const nextDraft = draftSeason(ctx.league);
  const rook = await getRookieBoard(ctx).catch(() => null);
  const prospect = assume && rook ? rook.board.find((r) => r.slug === assume.slug) : null;
  const assetOf = (a) => {
    const base = val.asset(a);
    if (!prospect || a.kind !== 'pick' || a.key !== assume.key) return base;
    const slot = base.slot ?? 1;
    const v = prospect.sources.KTC?.value ?? base.value;
    return {
      ...base, value: Math.round(v), adj: Math.round(v),
      became: { prospect: true, playerId: null, name: prospect.name, pos: prospect.pos, slot, college: prospect.college, height: prospect.height, weight: prospect.weight,
        classRank: prospect.sources.KTC?.classRank ?? prospect.rank, slug: prospect.slug, pickValue: base.value },
      label: `${a.season} ${a.round}.${String(slot).padStart(2, '0')} → ${prospect.name}`,
    };
  };
  // A scenario prospect isn't on a roster yet: "still held" means the pick still is.
  const heldOf = (a) => val.held(a.became?.prospect ? { ...a, became: null } : a, side.ownerId);
  const scenarioPicks = rook ? t.sides.flatMap((s) => s.received).filter((a) => a.kind === 'pick' && a.season === nextDraft)
    .map((a) => ({ key: a.key, label: val.asset(a).label, assumed: !!prospect && a.key === assume.key })) : [];
  const scenarioOptions = rook ? rook.board.slice(0, 16).map((r) => ({ slug: r.slug, name: r.name, pos: r.pos })) : [];
  const side = t.sides.find((s) => s.ownerId === ownerId) || [...t.sides].sort((a, b) => b.received.length - a.received.length)[0];
  const others = t.sides.filter((s) => s !== side);
  const seed = `${t.id}:${side.ownerId}`;
  const teamInfo = (o) => {
    const tm = ctx.teams.find((x) => x.ownerId === o);
    const p = cast?.personas?.[o];
    return { ownerId: o, team: val.nameOf(o), avatar: tm?.avatar ?? hist?.names?.[o]?.avatar ?? null, persona: p ? { nickname: p.nickname, voiceLabel: p.voiceLabel, archetype: p.archetype } : null };
  };
  const presenter = teamInfo(side.ownerId);
  const partners = others.map((s) => teamInfo(s.ownerId));
  const partnerNames = partners.map((p) => p.team).join(' and ');
  const recv = side.received.map(assetOf).map((a) => ({ ...a, from: val.nameOf(a.fromOwner) }));
  const sent = side.sent.map(assetOf).map((a) => ({ ...a, to: val.nameOf(a.toOwner) }));
  const date = new Date(t.at);
  const dateLabel = `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;

  // Stats window: the season so far at the time of the deal, or the previous full season in the offseason.
  const season = Number(t.season);
  const window = !t.offseason && t.week > 1
    ? { season, through: t.week - 1, label: `through Week ${t.week - 1}`, note: `Statistics through NFL Week ${t.week - 1}, ${season}` }
    : { season: season - 1, through: 18, label: `in ${season - 1}`, note: `Statistics from the ${season - 1} regular season` };
  const stats = await statsThrough(window.season, window.through, ctx.league.scoring_settings).catch(() => null);
  const ranks = {};
  if (stats) {
    const byPos = {};
    for (const [pid, l] of Object.entries(stats.players)) { const pos = ctx.players[pid]?.pos; if (pos && l.gp >= Math.min(3, window.through)) (byPos[pos] ||= []).push([pid, l.pts / l.gp]); }
    for (const list of Object.values(byPos)) list.sort((a, b) => b[1] - a[1]).forEach(([pid], i) => { ranks[pid] = i + 1; });
  }

  // Spotlights: the most valuable players received (used picks count as the player), then picks.
  const recvPlayers = recv.filter((a) => a.kind === 'player' || a.became)
    .map((a) => (a.became?.prospect ? a : a.became ? { ...assetOf({ kind: 'player', id: a.became.playerId }), viaPick: a.label } : a))
    .sort((a, b) => b.value - a.value).slice(0, 3);
  const spot = recvPlayers.map((a, i) => (a.became?.prospect ? prospectSpotlight(a, presenter, rook) : spotlight(a, stats, ranks, window, `${seed}:${i}`)));
  if (spot.length < 3) {
    for (const a of recv.filter((x) => x.kind === 'pick' && !x.became).sort((x, y) => y.value - x.value).slice(0, 3 - spot.length)) spot.push(pickSpotlight(a, a.link, presenter));
  }

  // Strategic rationale timeline.
  const nowLabel = t.offseason ? `NOW | ${season} OFFSEASON` : `NOW | WEEK ${t.week}, ${season}`;
  const pickYears = [...new Set([...recv, ...sent].filter((a) => a.kind === 'pick' && (!a.became || a.became.prospect)).map((a) => a.season))].sort().slice(0, 2);
  const cols = [nowLabel, ...pickYears.map((y) => `${y} ROOKIE DRAFT`)];
  // A pick assumed to become a prospect stays in its draft-year column.
  const isNow = (a) => a.kind === 'player' || (a.became && !a.became.prospect);
  const place = (xs) => cols.map((c, i) => (i === 0 ? xs.filter(isNow) : xs.filter((a) => !isNow(a) && a.kind === 'pick' && a.season === pickYears[i - 1])));
  const holdCells = place(sent), execCells = place(recv);
  const posList = [...new Set(execCells[0].map((a) => (a.became ? a.became.pos : a.pos)))];
  const rationale = {
    cols,
    hold: holdCells.map((xs, i) => ({ assets: xs, note: xs.length ? (i === 0 ? 'Producing, for now' : 'Draft seat') : i === 0 ? 'No production until the draft' : 'Nothing further' })),
    execute: execCells.map((xs, i) => ({ assets: xs, note: xs.length ? (i === 0 ? `${posList.join(', ')} producing now` : xs.some((a) => a.became?.prospect) ? `${xs.find((a) => a.became?.prospect).became.name}, eventually` : i === 1 ? 'Draft seat retained' : 'Added optionality') : i === 0 ? 'Patience, as a strategy' : '—' })),
    headline: execCells[0].length && !holdCells[0].length ? `The transaction converts ${sent.length === 1 ? 'a single speculative asset' : 'speculative assets'} into immediate production${posList.length > 1 ? ` at ${posList.length === 2 ? 'two' : posList.length === 3 ? 'three' : posList.length} positions` : ''}`
      : !execCells[0].length && holdCells[0].length ? 'The transaction converts current production into long-dated draft capital'
        : recv.length < sent.length ? 'The transaction concentrates value into fewer, better assets' : 'The transaction rebalances the portfolio across timelines',
    banner: recv.length > sent.length
      ? { h: 'Downside diversification', t: `The Board still believes in ${partnerNames}'s ability to ${pickOne(['underperform', 'make this look fair', 'keep answering trade offers'], seed)}. It simply prefers to hold that view through ${recv.length} assets rather than ${sent.length === 1 ? 'one envelope' : sent.length}.` }
      : recv.length < sent.length
        ? { h: 'Concentration of excellence', t: 'Depth is a cost center. Starters are revenue. The Board has elected to stop paying for bench players it never starts.' }
        : { h: 'Balanced exposure', t: 'The portfolio is rebalanced without a change in headcount. Management will describe this as a masterstroke regardless of outcome.' },
  };

  // Case study + scoreboard: was this trade funded by assets acquired in an earlier trade?
  const before = trades.filter((x) => x.at < t.at);
  const acquiredIn = (key, owner, upTo) => [...upTo].reverse().find((x) => x.sides.find((s) => s.ownerId === owner)?.received.some((a) => assetKey(a) === key));
  const funding = side.sent.map((a) => ({ a, trade: acquiredIn(assetKey(a), side.ownerId, before) })).filter((f) => f.trade);
  let caseStudy = null, scoreboard = null;
  if (funding.length) {
    // Walk back through the whole chain of trades that funded this one.
    const chainSet = new Map([[t.id, t]]);
    const queue = [t];
    while (queue.length && chainSet.size < 6) {
      const cur = queue.shift();
      const s = cur.sides.find((x) => x.ownerId === side.ownerId);
      for (const a of s.sent) {
        const src = acquiredIn(assetKey(a), side.ownerId, trades.filter((x) => x.at < cur.at));
        if (src && !chainSet.has(src.id)) { chainSet.set(src.id, src); queue.push(src); }
      }
    }
    const chain = [...chainSet.values()].sort((a, b) => a.at - b.at);
    const sides = chain.map((x) => x.sides.find((s) => s.ownerId === side.ownerId));
    const recvKeys = new Set(sides.flatMap((s) => s.received.map(assetKey)));
    const sentKeys = new Set(sides.flatMap((s) => s.sent.map(assetKey)));
    const original = sides.flatMap((s) => s.sent).filter((a) => !recvKeys.has(assetKey(a))).map(assetOf);
    const holdings = sides.flatMap((s) => s.received).filter((a) => !sentKeys.has(assetKey(a))).map(assetOf)
      .map((a) => ({ ...a, stillHeld: heldOf(a) }));
    const prev = funding[0].trade;
    const prevSide = prev.sides.find((s) => s.ownerId === side.ownerId);
    const fundedKeys = new Set(funding.map((f) => assetKey(f.a)));
    caseStudy = {
      trade: { date: new Date(prev.at).toISOString(), partners: prev.sides.filter((s) => s !== prevSide).map((s) => val.nameOf(s.ownerId)).join(' and '),
        sent: prevSide.sent.map(assetOf), received: prevSide.received.map(assetOf).map((a) => ({ ...a, funded: fundedKeys.has(a.key) })) },
      current: { sent: sent.map((a) => ({ ...a, funded: fundedKeys.has(a.key) })), received: recv },
      fundedLabel: funding.length === 1 ? 'THIS ASSET ALONE FUNDED THIS TRADE' : `THESE ${funding.length} ASSETS FUNDED THIS TRADE`,
      headline: `How the ${headline(assetOf(prevSide.sent[0] || prevSide.received[0]), presenter)} trade became this one: ${funding.length === 1 ? 'one asset' : `${funding.length} assets`} from ${chain.length > 2 ? 'earlier trades' : 'Trade I'} funded ${sent.length === funding.length ? 'all' : 'part'} of Trade ${chain.length > 2 ? chain.length : 'II'}`,
      trades: chain.length,
    };
    const sum = (xs) => xs.reduce((s, a) => s + (a.value || 0), 0);
    const adjIn = consolidatedTotal(holdings.map((a) => a.adj ?? a.value ?? 0), original.length, val.n);
    const adjOut = consolidatedTotal(original.map((a) => a.adj ?? a.value ?? 0), holdings.length, val.n);
    const firsts = holdings.filter((a) => a.kind === 'pick' && !a.became && a.round === 1).length;
    scoreboard = {
      original, holdings,
      lede: holdings.length > original.length ? `${presenter.persona?.nickname ?? presenter.team}, by the numbers.` : holdings.length === original.length ? 'Same headcount. Different vibes. By the numbers.' : 'Consolidation is also a strategy. By the numbers.',
      headline: `${original.length === 1 ? `One ${(original[0].kind === 'player' ? original[0].name : headline(original[0], presenter)).replace(/\.$/, '')}` : `${original.length} assets`}. ${holdings.length === 1 ? 'One' : ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'][holdings.length] ?? holdings.length} ${presenter.team} asset${holdings.length === 1 ? '' : 's'}.`,
      multiple: original.length ? `${(holdings.length / original.length).toFixed(1)}x` : '—',
      counts: { total: `${original.length} → ${holdings.length}`, players: holdings.filter((a) => a.kind === 'player' || a.became).length, firsts, otherPicks: holdings.filter((a) => a.kind === 'pick' && !a.became && a.round !== 1).length },
      market: { original: Math.round(sum(original)), holdings: Math.round(sum(holdings)), multiple: sum(original) ? r1(sum(holdings) / sum(original)) : null },
      adjusted: { multiple: adjOut ? r1(adjIn / adjOut) : null },
      footnote: holdings.some((a) => a.stillHeld === false) ? `Since moved on: ${holdings.filter((a) => a.stillHeld === false).map((a) => a.label).join(', ')}.` : 'Every asset in the scoreboard is still on the roster.',
      trades: chain.length,
    };
  }

  // Analyst coverage: today's market and (for this season) the official report card.
  const g = grades.find((x) => String(x.id) === String(t.id));
  const gs = g?.sides.find((s) => s.team === presenter.team);
  const sumV = (xs) => xs.reduce((s, a) => s + (a.value || 0), 0);
  const inV = sumV(recv), outV = sumV(sent), big = Math.max(inV, outV);
  const edge = big ? Math.round(((inV - outV) / big) * 100) : 0;
  const p = cast?.personas?.[side.ownerId], pp = cast?.personas?.[others[0]?.ownerId];
  // In a scenario the official grades (which price the pick, not the prospect) don't apply.
  const official = prospect ? null : gs;
  const assumed = prospect ? recv.concat(sent).find((a) => a.became?.prospect) : null;
  const coverage = {
    received: Math.round(inV), sent: Math.round(outV), edge,
    grade: official?.grade ?? null, partnerGrades: g && official ? g.sides.filter((s) => s !== gs).map((s) => ({ team: s.team, grade: s.grade })) : [],
    adjustedGrade: official?.adjusted?.grade ?? null, sincePts: official?.sincePts ?? null,
    verdict: (official && g?.verdict) || (Math.abs(edge) <= 8 ? 'Fair deal' : `Edge: ${edge > 0 ? presenter.team : partnerNames}`),
    perSource: official?.perSource?.filter((x) => x.inGrade).map((x) => ({ source: x.name, edge: x.edge })) ?? [],
    scenario: assumed ? {
      text: `Scenario: the ${assumed.season} ${assumed.round}.${String(assumed.became.slot).padStart(2, '0')} becomes ${assumed.became.name}, valued at his KeepTradeCut devy value (${commas(assumed.value)}) instead of the pick's market value (${commas(assumed.became.pickValue)}). KTC's devy scale tops out near 10,000 like its NFL scale, so treat this as the best case: it prices him like an established star before he has played an NFL snap.`,
      prospectValue: assumed.value, pickValue: assumed.became.pickValue,
    } : null,
    stillHeld: recv.map((a) => ({ label: a.label, held: heldOf(a) })),
    management: p ? attribute(quoteFor(p, edge >= 0 ? 'trade' : 'cold', `deck:${seed}`), `${presenter.team}, Chief Executive`) : null,
    counterparty: pp ? attribute(quoteFor(pp, edge <= 0 ? 'trade' : 'cold', `deck:cp:${seed}`), `${val.nameOf(others[0].ownerId)}, counterparty`) : null,
  };

  const title = deckTitle(sent, recv, presenter, partnerNames);
  return {
    id: t.id, proposal: !!t.proposal, season: t.season, at: t.at, week: t.week, offseason: t.offseason, dateLabel,
    presenter, partners, sides: t.sides.map((s) => ({ ownerId: s.ownerId, team: val.nameOf(s.ownerId) })),
    title: title.title, verb: title.verb,
    coverHeads: recvPlayers.slice(0, 3).map((a) => (a.became?.prospect
      ? { id: null, initials: a.became.name.split(' ').map((w) => w[0]).join(''), name: a.became.name.split(' ').slice(-1)[0] }
      : { id: a.id, name: a.name.split(' ').slice(-1)[0] })),
    transaction: {
      headline: `${sent.length === 1 ? 'One' : sent.length} ${sent.length === 1 ? (sent[0].kind === 'pick' && !sent[0].became ? 'pick' : 'asset') : 'assets'} out; ${recv.length === 1 ? 'one asset' : `${recv.length} assets`} in`,
      sent, received: recv, faabIn: side.faabIn, faabOut: side.faabOut, tagline: tagline(sent, recv, seed),
    },
    disclaimers: disclaimers(presenter.team, partnerNames, window.note.replace(/^Statistics /, '').replace(/^from /, 'games from ').replace(/^through/, 'games played through'), seed, !!t.proposal),
    spotlights: spot, rationale, caseStudy, scoreboard, coverage,
    scenario: { picks: scenarioPicks, options: scenarioOptions, assumed: assumed ? { key: assume.key, slug: assume.slug, name: assumed.became.name } : null },
  };
}

function prospectSpotlight(a, presenter, rook) {
  const b = a.became;
  const ft = b.height ? `${Math.floor(b.height / 12)}'${b.height % 12}"` : null;
  const posRank = rook?.board.filter((r) => r.pos === b.pos).findIndex((r) => r.slug === b.slug) + 1;
  return {
    asset: a, eyebrow: b.classRank === 1 ? 'THE GENERATIONAL PROSPECT' : 'THE PROSPECT',
    statsNote: `Scenario: ${presenter.team} drafts him at ${a.season} ${a.round}.${String(b.slot).padStart(2, '0')}`,
    stats: [
      { big: `#${b.classRank}`, label: `in the ${a.season} class (KeepTradeCut devy rankings)${posRank ? `, ${b.pos}${posRank}` : ''}` },
      { big: commas(a.value), label: `KTC devy value, vs. ${commas(b.pickValue)} for the pick on today's market` },
      ft ? { big: ft, label: `${b.weight ? `${b.weight} lbs, ` : ''}${b.college ?? ''}` } : { big: b.pos, label: b.college ?? '' },
    ],
    callout: b.classRank === 1
      ? `Has not played an NFL snap. Has been described, accurately, as the reason to finish last.`
      : 'Pre-revenue. Strong vision. Excellent highlight tape.',
  };
}

function assetKey(a) { return a.kind === 'player' ? `p:${a.id}` : `k:${a.key}`; }
