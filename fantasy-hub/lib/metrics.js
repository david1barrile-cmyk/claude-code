// Advanced metrics computed from Sleeper weekly box-score stats, scored with
// the league's own scoring settings.

const PRESETS = { 1: 'pts_ppr', 0.5: 'pts_half_ppr', 0: 'pts_std' };

export function scorePoints(stats, scoring) {
  if (!stats) return 0;
  let total = 0, matched = false;
  for (const [k, mult] of Object.entries(scoring || {})) {
    const v = stats[k];
    if (typeof v === 'number' && typeof mult === 'number') { total += v * mult; matched = true; }
  }
  if (!matched) {
    const key = PRESETS[scoring?.rec ?? 1] || 'pts_ppr';
    return Number(stats[key] ?? stats.pts_ppr ?? 0);
  }
  return Math.round(total * 100) / 100;
}

const sum = (a) => a.reduce((s, x) => s + x, 0);
const mean = (a) => (a.length ? sum(a) / a.length : 0);
const round = (x, d = 1) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null);
const ratio = (n, d) => (d > 0 ? n / d : null);
function stdev(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(mean(a.map((x) => (x - m) ** 2)));
}

function played(s) {
  if (!s) return false;
  if ((s.gp ?? 0) > 0 || (s.off_snp ?? 0) > 0) return true;
  return Object.keys(s).some((k) => !k.startsWith('pts_') && !k.startsWith('pos_rank') && !k.startsWith('rank') && s[k]);
}

/**
 * @param {object} args
 * @param {Record<string, object>} args.players  trimmed Sleeper player DB
 * @param {{week:number, stats:Record<string, object>}[]} args.weeks  completed weeks, ascending
 * @param {object} args.scoring  league scoring_settings
 * @param {Record<string, object>} [args.projections]  next week's projections
 * @returns {Record<string, object>} metrics by player id
 */
export function buildMetrics({ players, weeks, scoring, projections = {} }) {
  // Team totals per week (uses current team; approximation for traded players).
  const teamTot = weeks.map(({ stats }) => {
    const t = {};
    for (const [id, s] of Object.entries(stats)) {
      const team = players[id]?.team;
      if (!team || team === 'FA') continue;
      const x = (t[team] ||= { tgt: 0, air: 0 });
      x.tgt += s.rec_tgt || 0;
      x.air += Math.max(0, s.rec_air_yd || 0);
    }
    return t;
  });

  const out = {};
  for (const [id, p] of Object.entries(players)) {
    const log = [];
    weeks.forEach(({ week, stats }, i) => {
      const s = stats[id];
      if (!played(s)) return;
      const tt = teamTot[i][p.team] || { tgt: 0, air: 0 };
      log.push({
        week,
        pts: scorePoints(s, scoring),
        snp: s.off_snp || 0, tmSnp: s.tm_off_snp || 0,
        tgt: s.rec_tgt || 0, rec: s.rec || 0, recYd: s.rec_yd || 0, air: Math.max(0, s.rec_air_yd || 0),
        att: s.rush_att || 0, rushYd: s.rush_yd || 0,
        passAtt: s.pass_att || 0, passYd: s.pass_yd || 0,
        td: (s.rec_td || 0) + (s.rush_td || 0) + (s.pass_td || 0),
        rz: (s.rec_rz_tgt || 0) + (s.rush_rz_att || 0),
        tmTgt: tt.tgt, tmAir: tt.air,
      });
    });
    const proj = projections[id] ? scorePoints(projections[id], scoring) : null;
    if (!log.length && !proj) continue;

    const pts = log.map((g) => g.pts);
    const last3 = log.slice(-3);
    const agg = (rows) => {
      const S = (k) => sum(rows.map((g) => g[k]));
      return {
        snapShare: ratio(S('snp'), S('tmSnp')),
        tgtShare: ratio(S('tgt'), S('tmTgt')),
        airShare: ratio(S('air'), S('tmAir')),
      };
    };
    const season = agg(log), recent = agg(last3);
    const wopr = season.tgtShare != null ? 1.5 * season.tgtShare + 0.7 * (season.airShare || 0) : null;
    const ppg = mean(pts), l3 = mean(last3.map((g) => g.pts));
    const games = log.length;
    // Rest-of-season expectation: lean on recent form, regress small samples, fold in projection.
    let ros = games ? 0.45 * l3 + 0.55 * ppg : 0;
    if (proj != null) ros = games ? 0.7 * ros + 0.3 * proj : proj;

    const S = (k) => sum(log.map((g) => g[k]));
    out[id] = {
      id, games,
      ppg: round(ppg), last3: round(l3), trend: round(l3 - ppg), stdev: round(stdev(pts)),
      floor: round(pts.length ? Math.min(...pts) : 0), ceiling: round(pts.length ? Math.max(...pts) : 0),
      total: round(sum(pts)), proj: round(proj), ros: round(ros, 2),
      snapShare: round(season.snapShare, 3), snapShareL3: round(recent.snapShare, 3),
      tgtShare: round(season.tgtShare, 3), tgtShareL3: round(recent.tgtShare, 3),
      airShare: round(season.airShare, 3), wopr: round(wopr, 3),
      tgtPg: round(S('tgt') / (games || 1)), touchesPg: round((S('att') + S('rec')) / (games || 1)),
      ypc: round(ratio(S('rushYd'), S('att'))), ypt: round(ratio(S('recYd'), S('tgt'))),
      // Sleeper's rec_air_yd counts air yards on catches only, so this is "completed air yards per target",
      // a conservative stand-in for aDOT; airShare and WOPR inherit the same caveat.
      catchRate: round(ratio(S('rec'), S('tgt')), 3), adot: round(ratio(S('air'), S('tgt'))), ypr: round(ratio(S('recYd'), S('rec'))),
      rzOpps: S('rz'), tds: S('td'),
      log: log.map(({ week, pts, snp, tmSnp, tgt, rec, recYd, att, rushYd, passYd, td }) =>
        ({ week, pts, snapPct: tmSnp ? round(snp / tmSnp, 3) : null, tgt, rec, recYd, att, rushYd, passYd, td })),
    };
  }
  return out;
}

// Positional rank/percentile among players with enough games, by ros.
export function positionalRanks(metrics, players, minGames = 2) {
  const byPos = {};
  for (const m of Object.values(metrics)) {
    const pos = players[m.id]?.pos;
    if (!pos || m.games < minGames) continue;
    (byPos[pos] ||= []).push(m);
  }
  const ranks = {};
  for (const [pos, list] of Object.entries(byPos)) {
    list.sort((a, b) => b.ros - a.ros);
    list.forEach((m, i) => { ranks[m.id] = { pos, rank: i + 1, of: list.length, pct: 1 - i / list.length }; });
  }
  return ranks;
}
