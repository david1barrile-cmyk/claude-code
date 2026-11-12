// The League Gazette: a satirical weekly newspaper built from real league data.
// 1) weekFacts() gathers what happened (scores, upsets, bench blunders, streaks,
//    transactions, next week's slate, the playoff race).
// 2) templateEdition() turns facts into headlines with a built-in joke writer
//    (free, deterministic per week). An optional AI writer lives in gazette-ai.js.
import { cached } from './cache.js';
import * as S from './sleeper.js';
import { summarizeSeason } from './history.js';
import { bestLineup } from './lineup.js';
import { winProbability } from './power.js';

const r1 = (x) => Math.round(x * 10) / 10;

// ---------- facts ----------
export async function weekFacts(ctx, week) {
  const { league, players, teams } = ctx;
  const id = league.league_id;
  const regEnd = (league.settings?.playoff_week_start || 15) - 1;
  const [rosters, users, ...weeks] = await Promise.all([
    S.getRosters(id), S.getLeagueUsers(id),
    ...Array.from({ length: Math.min(week + 1, regEnd) }, (_, i) => S.getMatchups(id, i + 1).catch(() => [])),
  ]);
  const thru = (n) => summarizeSeason({ league, rosters, users, bracket: [], weeks: weeks.slice(0, n) });
  const now = thru(week), before = thru(week - 1);
  const rid2owner = Object.fromEntries(rosters.map((r) => [r.roster_id, r.owner_id]));
  const team = (ownerId) => teams.find((t) => t.ownerId === ownerId);
  const name = (ownerId) => team(ownerId)?.name ?? 'A Mystery Team';
  const rank = (summary, ownerId) => summary.standings.findIndex((s) => s.ownerId === ownerId) + 1;
  const rec = (summary, ownerId) => {
    const s = summary.standings.find((x) => x.ownerId === ownerId);
    return s ? `${s.wins}-${s.losses}${s.ties ? `-${s.ties}` : ''}` : '0-0';
  };

  const rows = (weeks[week - 1] || []).filter((r) => r.matchup_id != null);
  const pname = (pid) => players[pid]?.name ?? pid;
  const scored = rows.map((r) => {
    const owner = rid2owner[r.roster_id];
    const pp = r.players_points || {};
    // Best possible lineup from everyone on the roster that week, using actual points.
    const optimal = bestLineup(r.players || [], (pid) => ({ pos: players[pid]?.pos, pts: pp[pid] ?? 0 }), ctx.slots).total;
    const startersSet = new Set(r.starters || []);
    const bench = (r.players || []).filter((pid) => !startersSet.has(pid)).map((pid) => ({ pid, pts: pp[pid] ?? 0 })).sort((a, b) => b.pts - a.pts);
    return { owner, team: name(owner), matchup: r.matchup_id, points: r.points ?? 0, optimal, benchLeft: r1(Math.max(0, optimal - (r.points ?? 0))), topBench: bench[0] ? { name: pname(bench[0].pid), pts: bench[0].pts } : null, starters: (r.starters || []).map((pid) => ({ pid, pts: pp[pid] ?? 0 })) };
  });
  if (!scored.length || scored.every((x) => !x.points)) return null;

  const pts = scored.map((x) => x.points).sort((a, b) => a - b);
  const median = pts.length % 2 ? pts[(pts.length - 1) / 2] : (pts[pts.length / 2 - 1] + pts[pts.length / 2]) / 2;
  const byM = {};
  scored.forEach((x) => (byM[x.matchup] ||= []).push(x));
  const games = Object.values(byM).filter((g) => g.length === 2).map(([a, b]) => {
    const [w, l] = a.points >= b.points ? [a, b] : [b, a];
    const upset = rank(before, w.owner) - rank(before, l.owner) >= 3 && week > 1;
    return { winner: w.team, loser: l.team, wPts: r1(w.points), lPts: r1(l.points), margin: r1(w.points - l.points), tie: a.points === b.points,
      upset, winnerRecordBefore: rec(before, w.owner), loserRecordBefore: rec(before, l.owner), winnerOwner: w.owner, loserOwner: l.owner };
  });

  const allStarters = scored.flatMap((x) => x.starters.map((s) => ({ ...s, team: x.team })));
  const isSkill = (pid) => ['QB', 'RB', 'WR', 'TE'].includes(players[pid]?.pos);
  const studs = [...allStarters].filter((s) => isSkill(s.pid)).sort((a, b) => b.pts - a.pts).slice(0, 3)
    .map((s) => ({ player: pname(s.pid), pos: players[s.pid]?.pos, pts: r1(s.pts), team: s.team }));
  const duds = [...allStarters].filter((s) => isSkill(s.pid) && players[s.pid]?.injury !== 'Out').sort((a, b) => a.pts - b.pts).slice(0, 2)
    .map((s) => ({ player: pname(s.pid), pos: players[s.pid]?.pos, pts: r1(s.pts), team: s.team }));
  const benchBlunders = [...scored].sort((a, b) => b.benchLeft - a.benchLeft).filter((x) => x.benchLeft >= 5).slice(0, 2)
    .map((x) => ({ team: x.team, left: x.benchLeft, scored: r1(x.points), topBench: x.topBench }));

  const highest = [...scored].sort((a, b) => b.points - a.points)[0];
  const lowest = [...scored].sort((a, b) => a.points - b.points)[0];
  const medianNotes = now.medianGames ? {
    median: r1(median),
    wonButBelow: games.filter((g) => !g.tie && g.wPts < median).map((g) => g.winner),
    lostButAbove: games.filter((g) => !g.tie && g.lPts > median).map((g) => g.loser),
  } : null;

  const standings = now.standings.map((s, i) => {
    const res = s.results || [];
    let streak = 0;
    for (let j = res.length - 1; j >= 0 && res[j] === res.at(-1); j--) streak++;
    const ap = s.apW + s.apL ? s.apW / (s.apW + s.apL) : null;
    const g = s.wins + s.losses + s.ties;
    return { rank: i + 1, team: name(s.ownerId), owner: s.ownerId, record: `${s.wins}-${s.losses}${s.ties ? `-${s.ties}` : ''}`, pf: r1(s.pf),
      move: rank(before, s.ownerId) - (i + 1), streak: res.length ? `${res.at(-1)}${streak}` : null,
      luck: ap == null || !g ? 0 : r1(s.wins + s.ties / 2 - ap * g) };
  });

  // Transactions during this week.
  const tx = (await S.getTransactions(id, week).catch(() => [])).filter((t) => t.status === 'complete');
  const tname = (rid) => name(rid2owner[rid]);
  const trades = tx.filter((t) => t.type === 'trade').map((t) => ({ teams: (t.roster_ids || []).map(tname),
    moves: Object.entries(t.adds || {}).map(([pid, rid]) => `${pname(pid)} → ${tname(rid)}`) }));
  const bigAdds = tx.filter((t) => t.type !== 'trade').flatMap((t) => Object.entries(t.adds || {}).map(([pid, rid]) => ({ player: pname(pid), team: tname(rid), faab: t.settings?.waiver_bid ?? null })))
    .sort((a, b) => (b.faab ?? 0) - (a.faab ?? 0)).slice(0, 3);

  // Next week and the playoff race.
  let lookahead = null;
  const nextRows = week < regEnd ? (weeks[week] || []).filter((r) => r.matchup_id != null) : [];
  if (nextRows.length) {
    const ppg = Object.fromEntries(now.standings.map((s) => [s.ownerId, s.weekly.length ? s.pf / s.weekly.length : 0]));
    const nm = {};
    nextRows.forEach((r) => (nm[r.matchup_id] ||= []).push(rid2owner[r.roster_id]));
    const slate = Object.values(nm).filter((m) => m.length === 2).map(([a, b]) => {
      const p = winProbability(ppg[a], ppg[b]);
      return { a: name(a), b: name(b), aRecord: rec(now, a), bRecord: rec(now, b), aWinPct: Math.round(p * 100), combinedRank: rank(now, a) + rank(now, b) };
    });
    lookahead = {
      week: week + 1,
      gameOfWeek: [...slate].sort((x, y) => (Math.abs(x.aWinPct - 50) + x.combinedRank * 3) - (Math.abs(y.aWinPct - 50) + y.combinedRank * 3))[0] ?? null,
      mismatch: [...slate].sort((x, y) => Math.abs(y.aWinPct - 50) - Math.abs(x.aWinPct - 50))[0] ?? null,
      slate,
    };
  }
  const spots = league.settings?.playoff_teams || 4;
  const cut = standings[spots - 1], first = standings[spots];
  const gp = (rec2) => rec2.split('-').map(Number);
  const gb = (s) => { const [w] = gp(s.record); const [cw] = gp(cut.record); return cw - w; };
  const race = {
    spots, weeksLeft: Math.max(0, regEnd - week),
    inPosition: standings.slice(0, spots).map((s) => s.team),
    bubble: standings.slice(spots, spots + 3).filter((s) => gb(s) <= Math.max(2, (regEnd - week) * (now.medianGames ? 2 : 1) / 2)).map((s) => ({ team: s.team, gamesBack: gb(s) })),
    lastIn: cut?.team, firstOut: first?.team ?? null,
  };

  return {
    league: league.name, season: league.season, week, regularSeasonEnds: regEnd, medianGames: now.medianGames,
    scoreboard: scored.map((x) => ({ team: x.team, owner: x.owner, points: r1(x.points), aboveMedian: x.points > median })).sort((a, b) => b.points - a.points),
    games, highest: { team: highest.team, pts: r1(highest.points) }, lowest: { team: lowest.team, pts: r1(lowest.points) },
    studs, duds, benchBlunders, medianNotes, standings, trades, bigAdds, lookahead, race,
  };
}

// ---------- template writer ----------
function hash(s) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
function picker(seed) { let x = seed || 1; return (arr) => { x = Math.imul(x ^ (x >>> 15), 2246822507) ^ Math.imul(x ^ (x >>> 13), 3266489909); x >>>= 0; return arr[x % arr.length]; }; }

export function templateEdition(f, seedKey = '') {
  const pick = picker(hash(`${seedKey}:${f.season}:${f.week}`));
  // Draw without repeats within an edition so briefs don't share punchlines.
  const deck = (arr) => { const left = [...arr]; return () => (left.length ? left.splice(left.indexOf(pick(left)), 1)[0] : pick(arr)); };
  const stories = [];
  const add = (kicker, headline, body, tags = []) => stories.push({ kicker, headline, body, tags });
  const blow = [...f.games].sort((a, b) => b.margin - a.margin)[0];
  const close = [...f.games].filter((g) => !g.tie).sort((a, b) => a.margin - b.margin)[0];

  if (blow && blow.margin >= 25) {
    const { winner: W, loser: Lz, margin: M, wPts, lPts } = blow;
    add('Blowout', pick([
      `${W} Wins By ${M}; ${Lz} Requests Mercy Rule Be Added To League Bylaws`,
      `${Lz} Officially Listed As 'Questionable' For Remainder Of Season After ${M}-Point Drubbing`,
      `Witnesses Describe ${W}'s ${wPts}-Point Performance As 'Frankly Rude'`,
      `${Lz} Loses By ${M}, Announces It Will Be 'Taking Some Time To Focus On Family'`,
      `League Office Reviewing Whether ${W} Vs. ${Lz} Counts As A Game Or An Incident`,
      `${W} Hangs ${wPts} On ${Lz}; Scoreboard Operator Asks For Overtime Pay`,
      `${Lz} Insists ${M}-Point Loss 'Felt Closer Than That'`,
    ]), pick([
      `The final read ${wPts} to ${lPts}, a margin league scientists have classified as "a lot." Sources close to ${Lz} confirm the manager watched the second half through their fingers.`,
      `${W} put up ${wPts}, while ${Lz} managed ${lPts}, a number that would have been competitive in a league that ended at halftime. A spokesperson for ${Lz} said the team is "focusing on the positives," then declined to name any.`,
      `By the late window, ${Lz} had stopped refreshing the app and started refreshing their résumé. Final: ${wPts}-${lPts}.`,
      `"We knew it would be tough," said a ${Lz} source, describing a ${M}-point loss. "We did not know it would be documentary-tough."`,
    ]), [W, Lz]);
  }
  if (close && close.margin < 5) {
    const { winner: W, loser: Lz, margin: M, wPts, lPts } = close;
    add('Nail-Biter', pick([
      `${W} Edges ${Lz} By ${M}; Cardiologists Placed On Standby`,
      `${Lz} Loses By ${M} Points, Immediately Begins Reviewing Every Decision Made Since August`,
      `'A Win Is A Win,' Says ${W} Of ${M}-Point Escape`,
      `${M}-Point Margin Decides ${W} Vs. ${Lz}; Both Managers Age Visibly`,
      `${Lz} Falls ${M} Short, Demands Instant Replay Of Entire Sunday`,
      `Monday Night Miracle Or Monday Night Mugging? ${W} Survives ${Lz} By ${M}`,
    ]), pick([
      `It came down to ${wPts}-${lPts}. Somewhere, a benched player's single catch is being blamed by ${Lz}, loudly, in a group chat.`,
      `${Lz} will spend the week calculating which single decision cost them ${M} points. Our analysts have identified at least four.`,
      `"I was fine the whole time," said ${W}, according to nobody who watched them refresh the app 300 times. Final: ${wPts}-${lPts}.`,
      `A ${M}-point margin is roughly one extra point per quarter, a fact ${Lz} has asked us to stop repeating.`,
    ]), [W, Lz]);
  }
  for (const u of f.games.filter((g) => g.upset).slice(0, 1)) {
    add('Upset Alert', pick([
      `${u.winner} (${u.winnerRecordBefore}) Stuns ${u.loser} (${u.loserRecordBefore}); Analysts Who Predicted It Do Not Exist`,
      `Shock Result: ${u.loser} Loses To ${u.winner}, Blames 'Vibes'`,
      `${u.winner} Takes Down ${u.loser}; Power Rankings Committee Calls Emergency Meeting`,
      `'Any Given Sunday,' Mutters ${u.loser}, Staring At Wall`,
      `${u.loser} Upset By ${u.winner} In Game It Had Already Counted As A Win`,
    ]), pick([
      `Entering the week, ${u.loser} was ${u.loserRecordBefore} and ${u.winner} was ${u.winnerRecordBefore}. Final: ${u.wPts}-${u.lPts}. The standings have been notified.`,
      `${u.winner} (${u.winnerRecordBefore} coming in) beat ${u.loser} (${u.loserRecordBefore}) ${u.wPts}-${u.lPts}. Experts who picked ${u.loser} have been reassigned to the weather desk.`,
    ]), [u.winner, u.loser]);
  }
  const bb = f.benchBlunders[0];
  if (bb) {
    add('Manager Malpractice', pick([
      `${bb.team} Leaves ${bb.left} Points On Bench, Insists Lineup Was 'A Statement'`,
      `Manager Of ${bb.team} Starts Wrong Guys With Confidence Previously Unseen In Modern Fantasy`,
      `Bench Of ${bb.team} Files Formal Complaint After Outscoring Starters' Expectations`,
      `${bb.team} Lineup Decisions Under Review By League Ethics Committee`,
      `${bb.left} Points Found Unused On ${bb.team} Bench; Authorities Seek Explanation`,
      `${bb.team} Debuts Bold New Strategy Of Starting Players Who Won't Score`,
    ]), `Hindsight is 20/20, and in ${bb.team}'s case it is also worth ${bb.left} points. ${bb.topBench ? pick([
      `${bb.topBench.name} posted ${r1(bb.topBench.pts)} from the bench, which is reportedly very comfortable this time of year.`,
      `${bb.topBench.name} scored ${r1(bb.topBench.pts)} while sitting, which is more than some starters managed while standing.`,
      `The bench, led by ${bb.topBench.name}'s ${r1(bb.topBench.pts)}, has requested its own team name.`,
    ]) : ''}`.trim(), [bb.team]);
  }
  const st = f.studs[0];
  if (st) {
    add('Star Watch', pick([
      `${st.player} Drops ${st.pts}; ${st.team} Manager Claims They 'Always Believed'`,
      `${st.player}'s ${st.pts}-Point Day Single-Handedly Funds ${st.team}'s Smugness Through Thanksgiving`,
      `${st.player} Scores ${st.pts}, ${st.team} Group Chat Now Unbearable`,
      `${st.team} Credits Elite Management For ${st.player}'s ${st.pts}; Everyone Else Credits Luck`,
      `League Asks ${st.team} To Stop Posting ${st.player} Highlights In Group Chat`,
      `${st.player} Posts ${st.pts} As ${st.team} Manager Takes Victory Lap Around Living Room`,
    ]), pick([
      `The ${st.pos} delivered the week's top performance for ${st.team}. Rival managers have begun referring to the matchup as "${st.player} versus everybody."`,
      `${st.pts} points from one ${st.pos}. ${st.team} has already updated its fantasy bio to "${st.player} enthusiast since day one."`,
    ]), [st.team]);
  }
  const d = f.duds[0];
  if (d) {
    add('Box Score Crime Scene', d.pts <= 0.5 ? pick([
      `${d.team} Starts ${d.player}, Receives ${d.pts} Points In Return`,
      `${d.player} Puts Up ${d.pts}; ${d.team} Asks If That's A Typo`,
      `Investigators Find No Evidence ${d.team}'s ${d.player} Scored`,
    ]) : pick([
      `${d.player} Records ${d.pts} Points In What Experts Are Calling 'A Choice'`,
      `${d.team} Starter ${d.player} Manages ${d.pts}, Thanks Fans For Their Patience`,
      `${d.player}'s ${d.pts}-Point Outing Leaves ${d.team} Searching For Answers, Refund`,
    ]), pick([
      `Started with high hopes by ${d.team}, ${d.player} returned ${d.pts} fantasy points. The manager asked that the stat line be "kept out of the newspaper," a request this newspaper has declined.`,
      `${d.team} has filed ${d.player}'s ${d.pts} under "lessons learned," next to every other lesson it has not learned.`,
    ]), [d.team]);
  }
  if (f.medianNotes?.lostButAbove.length) {
    const t = f.medianNotes.lostButAbove[0];
    add('The Median', pick([
      `${t} Scores Above League Median, Loses Anyway; Fate Described As 'Petty'`,
      `${t} Beats Half The League, Loses To The Wrong Half`,
      `${t} Splits Week Despite Strong Score, Demands To Speak To The Schedule's Manager`,
    ]), `${t} cleared the ${f.medianNotes.median}-point median but still lost head-to-head, earning a split for the week. ${pick(['Philosophers call this "the median paradox."', 'Statisticians call this variance.'])} ${t} calls it "rigged."`, [t]);
  } else if (f.medianNotes?.wonButBelow.length) {
    const t = f.medianNotes.wonButBelow[0];
    add('The Median', pick([`${t} Wins Matchup, Loses To A Number`, `${t} Escapes Opponent, Not The Median`]), `A head-to-head win, but below the ${f.medianNotes.median}-point median. ${t} is 1-1 on the week and 0-1 against arithmetic.`, [t]);
  }
  const hot = f.standings.find((x) => x.streak && /^W([4-9]|\d\d)/.test(x.streak));
  const cold = f.standings.find((x) => x.streak && /^L([3-9]|\d\d)/.test(x.streak));
  if (hot) add('Streak Watch', pick([
    `${hot.team} Wins ${hot.streak.slice(1)} Straight, Begins Referring To Self In Third Person`,
    `${hot.team} Extends Streak To ${hot.streak.slice(1)}; Opponents Begin Scheduling 'Bye Weeks'`,
    `${hot.streak.slice(1)} In A Row For ${hot.team}, Who Insists They're 'Just Taking It One Week At A Time'`,
  ]), `At ${hot.record}, ${hot.team} sits ${ordinal(hot.rank)} and is reportedly already drafting a championship speech.`, [hot.team]);
  if (cold) add('Streak Watch', pick([
    `${cold.team} Drops ${cold.streak.slice(1)} Straight; Rebuild Rumors Grow Louder`,
    `${cold.team} Losing Streak Hits ${cold.streak.slice(1)}; Manager Seen Googling 'How To Tank Gracefully'`,
    `${cold.team} Has Lost ${cold.streak.slice(1)} Straight, Says Process Is 'Working Great, Actually'`,
  ]), `${cold.team} (${cold.record}) has not tasted victory in ${cold.streak.slice(1)} tries. Insiders say the manager has started setting lineups "with their eyes closed, for luck."`, [cold.team]);
  const lucky = [...f.standings].sort((a, b) => b.luck - a.luck)[0];
  const unlucky = [...f.standings].sort((a, b) => a.luck - b.luck)[0];
  if (lucky?.luck >= 1.5) add('Analytics Desk', pick([
    `Study Finds ${lucky.team} Is ${lucky.luck} Wins Luckier Than It Deserves`,
    `Math Confirms ${lucky.team}'s Record Is ${lucky.luck} Wins Of Pure Horseshoe`,
  ]), `Compared with its all-play record, ${lucky.team} has won ${lucky.luck} more games than expected. The team responded to the findings by asking what "all-play" means.`, [lucky.team]);
  if (unlucky?.luck <= -1.5) add('Analytics Desk', pick([
    `${unlucky.team} Statistically Good, Practically Losing`,
    `${unlucky.team} Owed ${Math.abs(unlucky.luck)} Wins By The Universe, Universe Not Returning Calls`,
  ]), `${unlucky.team} has ${Math.abs(unlucky.luck)} fewer wins than its scoring deserves. Experts recommend thoughts, prayers, and a better schedule.`, [unlucky.team]);
  for (const t of f.trades.slice(0, 1)) {
    add('Transactions', pick([
      `Blockbuster: ${t.teams.join(' And ')} Agree To Trade Both Will Regret Eventually`,
      `${t.teams.join(', ')} Complete Trade; Both Sides Claim They Fleeced The Other`,
    ]), `${t.moves.join('; ')}. League lawyers are reviewing the deal for evidence of collusion, sanity, or both.`, t.teams);
  }
  const fa = f.bigAdds.find((a) => a.faab >= 10);
  if (fa) add('Transactions', pick([
    `${fa.team} Spends $${fa.faab} On ${fa.player}, Calls It 'An Investment'`,
    `${fa.team} Drops $${fa.faab} Of FAAB On ${fa.player}; Financial Planner Weeps`,
  ]), `Financial advisors were unavailable for comment. ${fa.player} was unavailable for a role.`, [fa.team]);

  // Lead = the most dramatic story available.
  const order = ['Upset Alert', 'Blowout', 'Nail-Biter', 'Manager Malpractice', 'Star Watch'];
  const rankOf = (k) => (order.indexOf(k) === -1 ? 99 : order.indexOf(k));
  stories.sort((a, b) => rankOf(a.kicker) - rankOf(b.kicker));
  const lead = stories.shift() ?? { kicker: 'League News', headline: `Week ${f.week} Happens, Technically`, body: 'Games were played. Points were scored. Nobody is happy.', tags: [] };

  const lowJoke = deck(['which is also a cry for help', 'a number usually reserved for kickers', 'which the team has asked us to round up', 'and that was the good news']);
  const studJoke = deck(['a gentle reminder that the roster spot was not decorative', 'and their manager would like you to know about it', 'which somehow still was not the top score this week', 'for a team that will absolutely bring it up at the draft']);
  const moveJoke = deck(['Nobody saw it coming, especially them.', 'Momentum is a real thing, say people with momentum.', 'The standings remain undefeated.']);
  const briefs = [
    `High score: ${f.highest.team}, ${f.highest.pts}. Low score: ${f.lowest.team}, ${f.lowest.pts}, ${lowJoke()}.`,
    ...f.studs.slice(1, 3).map((x) => `${x.player} (${x.pos}, ${x.team}) posted ${x.pts}, ${studJoke()}.`),
    ...f.standings.filter((x) => Math.abs(x.move) >= 2).slice(0, 2).map((x) => `${x.team} ${x.move > 0 ? 'climbs' : 'tumbles'} ${Math.abs(x.move)} spots to ${ordinal(x.rank)}. ${moveJoke()}`),
    f.bigAdds[0] && !fa ? `Waiver wire: ${f.bigAdds[0].team} adds ${f.bigAdds[0].player}${f.bigAdds[0].faab ? ` for $${f.bigAdds[0].faab}` : ''}.` : null,
  ].filter(Boolean);

  const lookahead = [];
  const LA = f.lookahead;
  if (LA?.gameOfWeek) {
    const g = LA.gameOfWeek, fav = g.aWinPct >= 50 ? g.a : g.b;
    lookahead.push({ headline: `Game Of The Week: ${g.a} (${g.aRecord}) vs. ${g.b} (${g.bRecord})`,
      body: `Our model gives ${fav} a ${Math.max(g.aWinPct, 100 - g.aWinPct)}% chance, ${pick(['which our model would like to stress is not a promise.', 'a number our model arrived at with full confidence and no accountability.', 'subject to change the moment someone sets a lineup.'])}` });
  }
  if (LA?.mismatch && LA.mismatch !== LA.gameOfWeek) {
    const m = LA.mismatch, fav = m.aWinPct >= 50 ? m.a : m.b, dog = m.aWinPct >= 50 ? m.b : m.a, pct = 100 - Math.max(m.aWinPct, 100 - m.aWinPct);
    lookahead.push({ headline: pick([
      `${dog} Given ${pct}% Chance Against ${fav}; ${dog} Says 'So You're Telling Me There's A Chance'`,
      `Underdog Watch: ${dog} (${pct}%) Vs. ${fav}, A Matchup Bookmakers Describe As 'Adorable'`,
    ]), body: pick([`Bookmakers have stopped taking bets. ${dog} has started taking advice.`, `${dog} is said to be "embracing the underdog role," having had considerable practice.`]) });
  }
  if (f.race.weeksLeft > 0 && f.race.bubble.length) {
    lookahead.push({ headline: `Playoff Picture: ${f.race.weeksLeft} Week${f.race.weeksLeft === 1 ? '' : 's'} Left, ${f.race.spots} Spots, Zero Chill`,
      body: `${f.race.lastIn} holds the last spot. Chasing: ${f.race.bubble.map((b) => `${b.team} (${b.gamesBack} back)`).join(', ')}. Every manager involved claims to be "not even looking at the standings."` });
  }
  return { generator: 'templates', lead, stories: stories.slice(0, 7), briefs, lookahead };
}

function ordinal(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

// ---------- editions ----------
export function editionWeeks(ctx) {
  const regEnd = (ctx.league.settings?.playoff_week_start || 15) - 1;
  const last = ctx.currentWeek ? ctx.currentWeek - 1 : regEnd;
  return Array.from({ length: Math.max(0, Math.min(last, regEnd)) }, (_, i) => i + 1);
}

export async function getEdition(ctx, week, { aiWriter } = {}) {
  const facts = await cached(`gfacts:${ctx.league.league_id}:${week}`, 30 * 60e3, () => weekFacts(ctx, week));
  if (!facts) return null;
  const base = { week, season: facts.season, league: facts.league, scoreboard: facts.scoreboard, medianGames: facts.medianGames, median: facts.medianNotes?.median ?? null };
  if (aiWriter) {
    // Past weeks never change: keep AI editions for 60 days on disk so each is written once.
    const ai = await cached(`gazette:ai:${ctx.league.league_id}:${facts.season}:${week}`, 60 * 24 * 3600e3, () => aiWriter(facts), { disk: true }).catch((err) => {
      console.warn('[gazette] AI writer failed, using templates:', err.message);
      return null;
    });
    if (ai) return { ...base, ...ai };
  }
  return { ...base, ...templateEdition(facts, ctx.league.league_id) };
}
