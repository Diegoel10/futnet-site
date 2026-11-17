// kotf.js: 👑 "King of the field" (type of game, optional; set when creating a game or in Match management).
// Same rules on the website, the iPhone app and the Android app:
//   • Winner stays on. The loser goes to the end of the line and the next team in line comes on.
//   • A draw: the team that was already on (the "king") stays, but it can't draw twice in a row:
//     its 2nd draw in a row and it's out (end of the line); the team that drew with it stays on.
//     (A draws B → A stays. A draws C → A is out, C stays, B comes on.)
//   • The very first game has no king: a draw there is decided by rock-paper-scissors.
//     The RPS winner stays on, and it counts as a draw (so another draw next game and it's out).
//   • Two games at once (VS Mode): each field runs its own king of the field, with its own teams,
//     when "Use the same format on both fields" is on.
// Nothing extra is saved besides the type and the RPS winner on that first game: the line is worked out
// from the games played, so fixing / deleting a game fixes the line too.

/**
 * Who plays next.
 * @param pool   the teams in this rotation, in their order (keys: team ids, or team numbers as strings)
 * @param games  the games played on this field, oldest first: { a, b, ga, gb, rps } (rps = key of the RPS winner)
 * @returns { a, b, king, kingDraws, needRps: {index, a, b} | null, line }
 */
export function kotfNext(pool, games) {
    const inPool = new Set(pool);
    let line = [...pool];
    let king = null, kingDraws = 0, needRps = null;
    const toLine = (t) => { if (t != null && inPool.has(t) && !line.includes(t)) line.push(t); };
    (games || []).forEach((g, index) => {
        const a = g.a, b = g.b;
        if (a == null || b == null || a === b) return;
        if (!inPool.has(a) && !inPool.has(b)) return;
        line = line.filter(t => t !== a && t !== b);
        const ga = +g.ga || 0, gb = +g.gb || 0;
        const draw = ga === gb;
        const winner = draw ? null : (ga > gb ? a : b);
        if (king != null && (king === a || king === b)) {
            const ch = king === a ? b : a;
            if (!draw) {
                const loser = winner === a ? b : a;
                king = winner; kingDraws = 0; toLine(loser);
            } else if (kingDraws >= 1) {
                toLine(king); king = ch; kingDraws = 1;      // 2nd draw in a row: the king is out, the other team stays
            } else {
                kingDraws = 1; toLine(ch);                    // 1st draw: the king stays
            }
        } else {
            // first game (or a game picked by hand without the king): no king yet
            if (king != null) toLine(king);
            if (!draw) { king = winner; kingDraws = 0; toLine(winner === a ? b : a); }
            else {
                const r = g.rps === a || g.rps === b ? g.rps : null;
                if (!r) needRps = { index, a, b };
                king = r || a; kingDraws = 1; toLine(king === a ? b : a);
            }
        }
        if (king != null && !inPool.has(king)) { king = null; kingDraws = 0; }
    });
    // only ask about rock-paper-scissors for the latest game
    const last = (games || []).length - 1;
    if (needRps && needRps.index !== last) needRps = null;
    let a, b;
    if (king != null) { a = king; b = line.find(t => t !== king); }
    else { a = line[0]; b = line[1]; }
    return { a: a ?? null, b: b ?? null, king, kingDraws, needRps, line };
}

/** "Next: A vs B" text bits for the screens. names = key → team name. */
export function kotfNote(r, names) {
    const n = (k) => names[k] || 'Team';
    if (r.needRps) return { title: "🪨📄✂️ It's a draw! Who won rock-paper-scissors?", line: 'The winner stays on (it counts as a draw).' };
    const parts = [];
    if (r.a != null && r.b != null) parts.push(`Next: ${n(r.a)} vs ${n(r.b)}`);
    const sub = r.king != null
        ? (r.kingDraws >= 1 ? `👑 ${n(r.king)} stays on. Another draw and they're out.` : `👑 ${n(r.king)} stays on (winner stays).`)
        : 'First game: a draw is decided by rock-paper-scissors.';
    return { title: parts.join(''), line: sub };
}
