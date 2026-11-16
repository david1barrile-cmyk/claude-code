// The Gazette awards issue: league superlatives from the season's real numbers, each with an
// acceptance speech in the winner's persona voice. "Midseason Awards" until the regular
// season ends, then the full season's awards.
import { cached } from './cache.js';
import { getSeasonStats } from './seasonstats.js';
import { getDraftGrades } from './draftgrades.js';
import { getPersonas, quoteFor, attribute } from './personas.js';

const top = (arr, f) => [...arr].filter((x) => f(x) != null).sort((a, b) => f(b) - f(a))[0];

export function getAwards(ctx) {
  return cached(`awards:${ctx.league.league_id}`, 30 * 60e3, async () => {
    const [stats, drafts, cast] = await Promise.all([getSeasonStats(ctx), getDraftGrades(ctx).catch(() => null), getPersonas(ctx).catch(() => null)]);
    const T = stats.teams;
    const P = (team) => Object.values(cast?.personas || {}).find((p) => p.team === team);
    const awards = [];
    const add = (key, title, team, stat, blurb, mood = 'win') => {
      if (!team) return;
      const p = P(team);
      awards.push({ key, title, team, stat, blurb, mood, nickname: p?.nickname ?? null,
        speech: p ? attribute(quoteFor(p, mood, `award:${key}`), `${team} in accepting the award`) : null });
    };

    const moy = top(T, (t) => t.wins * 1000 + t.pf);
    add('moy', 'Manager of the Year', moy?.team, moy?.record, `${moy?.record} with ${moy?.pf} points for. The rest of the league is invited to applaud, quietly.`);
    const pts = top(T, (t) => t.pf);
    if (pts && pts !== moy) add('points', 'The Points Machine', pts.team, `${pts.pf} points`, `Most points in the league. Scoreboards everywhere are tired.`);
    const week = top(T, (t) => t.bestWeek?.pts);
    add('week', 'Single-Week Record', week?.team, `${week?.bestWeek.pts} in Week ${week?.bestWeek.week}`, `The highest score of the season${week?.bestWeek.opp ? `, at the expense of ${week.bestWeek.opp}` : ''}.`, 'blowoutWin');
    const blow = top(T, (t) => (t.biggestWin ? t.biggestWin.pts - t.biggestWin.oppPts : null));
    if (blow) add('blowout', 'Most Disrespectful Win', blow.team, `+${Math.round((blow.biggestWin.pts - blow.biggestWin.oppPts) * 10) / 10} vs ${blow.biggestWin.opp}`, `Week ${blow.biggestWin.week}: ${blow.biggestWin.pts} to ${blow.biggestWin.oppPts}. ${blow.biggestWin.opp} has asked that this award not be mentioned in its presence.`, 'blowoutWin');
    const trade = top(T, (t) => t.bestTrade?.score);
    if (trade?.bestTrade) add('trade', 'Trade of the Year', trade.team, `${trade.bestTrade.grade} grade`, `Got ${trade.bestTrade.received.slice(0, 2).join(' and ')} from ${trade.bestTrade.partners.join(' and ')}. Graded ${trade.bestTrade.grade} at today's values.`, 'trade');
    // Prefer a different team than Trade of the Year's winner, so one trade can't win both.
    const fleeced = top(T.filter((t) => t !== trade || T.filter((x) => x.worstTrade).length < 2), (t) => (t.worstTrade ? -t.worstTrade.score : null));
    if (fleeced?.worstTrade) add('fleeced', 'The Generous Donor Award', fleeced.team, `${fleeced.worstTrade.grade} grade`, `Sent ${fleeced.worstTrade.sent.slice(0, 2).join(' and ')} to ${fleeced.worstTrade.partners.join(' and ')}. The league thanks you for your service.`, 'trade');
    const bench = top(T, (t) => t.benchTotal);
    add('bench', 'Bench Malpractice Award', bench?.team, `${bench?.benchTotal} points left on the bench`, `A season-long commitment to starting the wrong guys.`, 'bench');
    const call = top(T, (t) => t.worstCall?.cost);
    if (call?.worstCall) add('call', 'Worst Lineup Call', call.team, `−${call.worstCall.cost} in Week ${call.worstCall.week}`, `Benched ${call.worstCall.benched.name} (${call.worstCall.benched.pts}) to start ${call.worstCall.started.name} (${call.worstCall.started.pts}).`, 'bench');
    const waiver = top(T, (t) => t.bestAdd?.pts);
    if (waiver?.bestAdd) add('waiver', 'Waiver Wire Wizard', waiver.team, `${waiver.bestAdd.name}: ${waiver.bestAdd.pts} pts started`, `Picked up ${waiver.bestAdd.name}${waiver.bestAdd.faab ? ` for $${waiver.bestAdd.faab}` : ''} and rode the points.`);
    const lucky = top(T, (t) => t.luck);
    if (lucky?.luck > 0.5) add('lucky', 'Lucky Charm', lucky.team, `+${lucky.luck} wins vs all-play`, `More wins than its scoring deserves. Has been asked to stop buying lottery tickets near the rest of us.`);
    const cursed = top(T, (t) => -t.luck);
    if (cursed?.luck < -0.5) add('cursed', 'Snakebitten', cursed.team, `${cursed.luck} wins vs all-play`, `Fewer wins than its scoring deserves. The schedule maker has declined to comment.`, 'cold');
    if (!stats.complete) {
      const fav = top(T, (t) => t.outlook?.titleOdds);
      if (fav?.outlook?.titleOdds != null) add('favorite', 'Most Likely to Raise the Trophy', fav.team, `${fav.outlook.titleOdds}% title odds`, `Ten thousand simulated seasons agree, with all the confidence of a computer that has never watched a fumble.`, 'oddsUp');
    }
    const rookie = drafts?.drafts.find((d) => d.kind === 'Rookie draft' && d.steals.length);
    if (rookie) {
      const st = rookie.steals[0];
      add('steal', 'Draft Steal of the Year', st.team, `${st.player} at ${st.label}`, `${rookie.season} rookie draft: taken ${st.label}, would go ${st.redraftPick === 1 ? 'first overall' : `#${st.redraftPick}`} in a redraft today.`);
    }
    return { season: stats.season, complete: stats.complete, weeksPlayed: stats.weeksPlayed, title: stats.complete ? `${stats.season} Season Awards` : `Midseason Awards`, awards };
  });
}
