// Rule-based scouting report: turns metrics into plain-English notes.
const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);

export function scoutingReport({ player: p, m, rank, value }) {
  const notes = { strengths: [], concerns: [], outlook: [] };
  if (!m || !m.games) {
    notes.outlook.push('No game action yet this season: value rests on projection and opportunity.');
    return notes;
  }
  const { strengths: S, concerns: C, outlook: O } = notes;

  if (rank) {
    const tier = rank.rank <= 12 ? 'an every-week starter' : rank.rank <= 24 ? 'a solid starter/flex' : rank.rank <= 36 ? 'a flex/depth option' : 'a bench/depth piece';
    O.push(`Ranks ${p.pos}${rank.rank} of ${rank.of} by rest-of-season scoring in your format: ${tier}.`);
  }
  if (m.snapShare != null) {
    if (m.snapShare >= 0.8) S.push(`Every-down role: ${pct(m.snapShare)} of offensive snaps.`);
    else if (m.snapShare < 0.45 && p.pos !== 'QB') C.push(`Part-time role: only ${pct(m.snapShare)} snap share.`);
    if (m.snapShareL3 != null && m.snapShareL3 - m.snapShare > 0.08) S.push(`Role expanding: ${pct(m.snapShareL3)} of snaps over the last 3 games.`);
    if (m.snapShareL3 != null && m.snapShare - m.snapShareL3 > 0.08) C.push(`Role shrinking: ${pct(m.snapShareL3)} of snaps over the last 3 games.`);
  }
  if (['WR', 'TE', 'RB'].includes(p.pos) && m.tgtShare != null) {
    if (m.tgtShare >= 0.24) S.push(`Alpha target share (${pct(m.tgtShare)}); WOPR ${m.wopr?.toFixed(2)}.`);
    else if (m.tgtShare >= 0.18) S.push(`Reliable target share (${pct(m.tgtShare)}).`);
    else if (p.pos !== 'RB' && m.tgtShare < 0.12) C.push(`Low target share (${pct(m.tgtShare)}); production leans on big plays or TDs.`);
  }
  if (m.ypr != null && m.ypr >= 15 && m.games >= 3 && p.pos !== 'RB') S.push(`Big-play threat: ${m.ypr} yards per catch.`);
  if (p.pos === 'RB' && m.touchesPg != null) {
    if (m.touchesPg >= 18) S.push(`Workhorse volume: ${m.touchesPg} touches per game.`);
    else if (m.touchesPg < 10) C.push(`Light workload: ${m.touchesPg} touches per game.`);
    if (m.tgtPg >= 4) S.push(`Passing-game role: ${m.tgtPg} targets per game.`);
  }
  if (m.ppg > 0 && m.stdev / m.ppg > 0.6 && m.games >= 4) C.push(`Boom/bust: weekly range ${m.floor}–${m.ceiling} pts.`);
  else if (m.games >= 4 && m.ppg > 8) S.push(`Consistent: weekly floor of ${m.floor} pts.`);
  if (m.games >= 4 && m.total > 0) {
    const tdPts = m.tds * 6;
    if (tdPts / m.total > 0.4) C.push(`TD-dependent: about ${Math.round((tdPts / m.total) * 100)}% of points from touchdowns. Regression risk.`);
  }
  if (m.trend >= 3) O.push(`Trending up: ${m.last3} ppg over the last 3 vs ${m.ppg} on the season.`);
  if (m.trend <= -3) O.push(`Trending down: ${m.last3} ppg over the last 3 vs ${m.ppg} on the season.`);
  if (p.injury) C.push(`Injury designation: ${p.injury}${p.injuryBody ? ` (${p.injuryBody})` : ''}.`);
  if (p.age != null && ((p.pos === 'RB' && p.age >= 28) || (['WR', 'TE'].includes(p.pos) && p.age >= 31))) C.push(`Age ${p.age}: past the typical ${p.pos} peak.`);
  if (value?.trend30 > 0) O.push(`Trade value up ${value.trend30} over 30 days (FantasyCalc).`);
  if (value?.trend30 < 0) O.push(`Trade value down ${Math.abs(value.trend30)} over 30 days (FantasyCalc).`);
  if (m.proj != null) O.push(`Projected ${m.proj} pts this week in your scoring.`);
  return notes;
}
