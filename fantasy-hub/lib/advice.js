// Waiver and trade advice. Every recommendation is grounded in how it changes
// the user's optimal starting lineup (rest-of-season points per game), plus
// market signals (Sleeper trending adds, trade values).
import { bestLineup } from './lineup.js';

const r1 = (x) => Math.round(x * 10) / 10;

function makeInfo(players, metrics) {
  return (id) => ({ pos: players[id]?.pos, pts: metrics[id]?.ros ?? 0 });
}

export function waiverAdvice({ players, metrics, slots, myIds, rosteredIds, trendingAdds = [], limit = 25 }) {
  const info = makeInfo(players, metrics);
  const base = bestLineup(myIds, info, slots).total;
  const trend = new Map(trendingAdds.map((t) => [t.player_id, t.count]));
  const eligible = new Set(slots.flatMap((s) => ({ QB: ['QB'], RB: ['RB'], WR: ['WR'], TE: ['TE'], K: ['K'], DEF: ['DEF'] }[s] || ['QB', 'RB', 'WR', 'TE'])));

  // Drop candidate: the bench player whose loss hurts the lineup least, lowest ros as tiebreak.
  const drops = myIds
    .map((id) => ({ id, loss: base - bestLineup(myIds.filter((x) => x !== id), info, slots).total, ros: metrics[id]?.ros ?? 0 }))
    .sort((a, b) => a.loss - b.loss || a.ros - b.ros);
  const drop = drops[0];

  const recs = [];
  for (const [id, p] of Object.entries(players)) {
    if (rosteredIds.has(id) || !eligible.has(p.pos)) continue;
    const m = metrics[id];
    const adds = trend.get(id) || 0;
    if (!m && !adds) continue;
    if (p.injury === 'IR' || p.injury === 'Out') continue;
    const withAdd = drop ? myIds.filter((x) => x !== drop.id).concat(id) : myIds.concat(id);
    const gain = bestLineup(withAdd, info, slots).total - base;
    const ros = m?.ros ?? 0;
    const snapUp = m?.snapShareL3 != null && m?.snapShare != null ? m.snapShareL3 - m.snapShare : 0;
    let score = 3 * Math.max(gain, 0) + 0.4 * ros + 1.5 * Math.log1p(adds) + 0.5 * Math.max(m?.trend ?? 0, 0) + 10 * Math.max(snapUp, 0);

    const kind = gain > 0.05 ? 'upgrade' : 'stash';
    if (kind === 'stash') score *= 0.5; // speculative adds rank below immediate lineup upgrades
    const why = [];
    if (gain > 0.05) why.push(`Beats a current starter: +${r1(gain)} pts/wk to your best lineup`);
    if (adds) why.push(`${adds.toLocaleString()} Sleeper adds in last 48h`);
    if (m?.trend > 1.5) why.push(`Last 3 wks ${m.last3} ppg vs ${m.ppg} season`);
    if (snapUp > 0.08) why.push(`Snap share rising: ${Math.round(m.snapShare * 100)}% → ${Math.round(m.snapShareL3 * 100)}% (L3)`);
    if (m?.tgtShareL3 > 0.2) why.push(`${Math.round(m.tgtShareL3 * 100)}% target share (L3)`);
    if (!why.length) continue;
    recs.push({ id, kind, score: r1(score), gain: r1(gain), ros: r1(ros), adds, why });
  }
  recs.sort((a, b) => b.score - a.score);
  return { baseline: r1(base), drop: drop ? { id: drop.id, loss: r1(drop.loss) } : null, recs: recs.slice(0, limit) };
}

export function evaluateTrade({ players, metrics, values, slots, mineIds, theirIds, give, get }) {
  const info = makeInfo(players, metrics);
  const v = (id) => values[id]?.value ?? 0;
  const myBefore = bestLineup(mineIds, info, slots).total;
  const myAfter = bestLineup(mineIds.filter((x) => !give.includes(x)).concat(get), info, slots).total;
  const thBefore = bestLineup(theirIds, info, slots).total;
  const thAfter = bestLineup(theirIds.filter((x) => !get.includes(x)).concat(give), info, slots).total;
  const giveVal = give.reduce((s, id) => s + v(id), 0);
  const getVal = get.reduce((s, id) => s + v(id), 0);
  const myDelta = myAfter - myBefore, theirDelta = thAfter - thBefore;
  const valDiff = getVal - giveVal;
  const fairness = Math.max(giveVal, getVal) ? valDiff / Math.max(giveVal, getVal) : 0;

  let verdict;
  if (myDelta > 0.5 && fairness > -0.1) verdict = 'Accept: improves your lineup at fair or better value';
  else if (myDelta > 0.5) verdict = 'Lineup upgrade, but you are overpaying in trade value';
  else if (fairness > 0.15) verdict = 'Value win, but it does not help your weekly lineup yet';
  else if (myDelta < -0.5) verdict = 'Decline: your starting lineup gets worse';
  else verdict = 'Roughly neutral';

  return {
    you: { before: r1(myBefore), after: r1(myAfter), delta: r1(myDelta), value: Math.round(giveVal), receive: Math.round(getVal) },
    them: { before: r1(thBefore), after: r1(thAfter), delta: r1(theirDelta) },
    fairness: Math.round(fairness * 100),
    verdict,
    winWin: myDelta > 0.3 && theirDelta > 0.3,
  };
}

// Search 1-for-1 and 2-for-1 deals where both lineups improve and values are close.
export function tradeSuggestions({ players, metrics, values, slots, myIds, others, limit = 15 }) {
  const info = makeInfo(players, metrics);
  const v = (id) => values[id]?.value ?? 0;
  const myBase = bestLineup(myIds, info, slots).total;
  const out = [];
  const mine = myIds.filter((id) => players[id] && (metrics[id]?.ros ?? 0) > 0);
  const myPairs = [];
  for (let i = 0; i < mine.length; i++) for (let k = i + 1; k < mine.length; k++) myPairs.push([mine[i], mine[k]]);
  const offers = mine.map((x) => [x]).concat(myPairs);

  for (const team of others) {
    const thBase = bestLineup(team.ids, info, slots).total;
    for (const get of team.ids) {
      if (!players[get] || (metrics[get]?.ros ?? 0) <= 0) continue;
      const gv = v(get);
      for (const give of offers) {
        const gvSum = give.reduce((s, id) => s + v(id), 0);
        const big = Math.max(gv, gvSum);
        if (!big || Math.abs(gv - gvSum) / big > 0.15) continue;
        const myDelta = bestLineup(myIds.filter((x) => !give.includes(x)).concat(get), info, slots).total - myBase;
        if (myDelta < 0.5) continue;
        const thDelta = bestLineup(team.ids.filter((x) => x !== get).concat(give), info, slots).total - thBase;
        if (thDelta < 0) continue;
        out.push({
          key: `${team.rosterId}:${get}`,
          rosterId: team.rosterId, owner: team.name, give, get: [get],
          myDelta: r1(myDelta), theirDelta: r1(thDelta),
          valueGap: Math.round(gv - gvSum),
          score: Math.min(myDelta, thDelta + 0.5) + myDelta * 0.5,
        });
      }
    }
  }
  // Drop 2-for-1s that merely pad a 1-for-1 that already works for the same target.
  const singles = new Set(out.filter((s) => s.give.length === 1).map((s) => `${s.key}:${s.give[0]}`));
  const filtered = out.filter((s) => s.give.length === 1 || !s.give.some((g) => singles.has(`${s.key}:${g}`)));
  filtered.sort((a, b) => b.score - a.score);
  // Avoid ten variations of the same target.
  const seen = new Map();
  return filtered.filter((s) => {
    const n = seen.get(s.get[0]) || 0;
    seen.set(s.get[0], n + 1);
    return n < 2;
  }).slice(0, limit).map(({ score, key, ...s }) => s);
}
