// Starting-lineup math shared by waiver and trade advice.

export const SLOT_ELIGIBILITY = {
  QB: ['QB'], RB: ['RB'], WR: ['WR'], TE: ['TE'], K: ['K'], DEF: ['DEF'],
  FLEX: ['RB', 'WR', 'TE'],
  WRRB_FLEX: ['RB', 'WR'],
  REC_FLEX: ['WR', 'TE'],
  SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
};

export function startingSlots(rosterPositions = []) {
  return rosterPositions
    .filter((s) => SLOT_ELIGIBILITY[s])
    // Fill the most restrictive slots first so flexes get what's left.
    .sort((a, b) => SLOT_ELIGIBILITY[a].length - SLOT_ELIGIBILITY[b].length);
}

/**
 * Greedy optimal lineup.
 * @param {string[]} ids  player ids available
 * @param {(id:string)=>{pos:string, pts:number}} info
 * @param {string[]} slots from startingSlots()
 */
export function bestLineup(ids, info, slots) {
  const pool = ids.map((id) => ({ id, ...info(id) })).filter((p) => p.pos).sort((a, b) => b.pts - a.pts);
  const used = new Set();
  const lineup = [];
  let total = 0;
  for (const slot of slots) {
    const ok = SLOT_ELIGIBILITY[slot];
    const pick = pool.find((p) => !used.has(p.id) && ok.includes(p.pos));
    if (pick) { used.add(pick.id); total += pick.pts; }
    lineup.push({ slot, id: pick?.id ?? null, pts: pick?.pts ?? 0 });
  }
  return { total: Math.round(total * 100) / 100, lineup };
}

const UNAVAILABLE = new Set(['Out', 'IR', 'PUP', 'Suspended', 'NA']);
// Player info for lineup math: rest-of-season pts, or 0 if they can't play.
export const lineupInfo = (players, metrics) => (id) => {
  const p = players[id];
  return { pos: p?.pos, pts: p && UNAVAILABLE.has(p.injury) ? 0 : metrics[id]?.ros ?? 0 };
};
