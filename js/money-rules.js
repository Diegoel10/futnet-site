// js/money-rules.js: the money + waitlist rules, in ONE place.
// The very same code runs on the server (functions/money-rules.js is a copy made by
// functions/sync-rules.sh), so the website and the server always agree.
// Pure functions only: no Firebase, no window.

/** Minutes a waitlisted player has to claim an open spot. */
export const CLAIM_MINUTES = [5, 10, 15, 20, 25, 30, 40, 60];
export const DEFAULT_CLAIM_MINUTES = 40;
/** In the last 15 minutes before kickoff any open spot is first come, first served. */
export const LAST_CALL_MS = 15 * 60 * 1000;

const list = (v) => (Array.isArray(v) ? v : []);
const uidOf = (p) => String((p && (p.uid || p.userId)) || '');

export function feeCentsOf(ev) {
    let raw = 0;
    if (ev && ev.price !== undefined && ev.price !== null && ev.price !== '') raw = parseFloat(ev.price) || 0;
    else if (ev && ev.fee !== undefined && ev.fee !== null) raw = parseFloat(String(ev.fee).replace(/[^0-9.]/g, '')) || 0;
    return Math.round(raw * 100);
}
export const isCreditGame = (ev) => !!(ev && ev.communityId && ev.payWithCredit === true && feeCentsOf(ev) > 0);

export function plusOneExtraOf(ev) {
    const v = Number(ev && ev.plusOneExtra);
    return Number.isFinite(v) && v > 0 ? Math.round(v * 100) : 0;
}
/** Total for a player + N guests. */
export function costFor(ev, guestCount = 0) {
    const g = Math.max(0, guestCount | 0);
    return feeCentsOf(ev) + g * (feeCentsOf(ev) + plusOneExtraOf(ev));
}

/** Players allowed: per side x teams. */
export function capacityOf(ev) {
    const perSide = parseInt(String((ev && ev.format) || '7v7').match(/(\d+)/)?.[1], 10) || 7;
    let teams = 3;
    if (typeof ev?.teamsCount === 'number') teams = ev.teamsCount;
    else if (ev?.teamsCount) teams = parseInt(String(ev.teamsCount).match(/(\d+)/)?.[1], 10) || 3;
    return perSide * teams;
}
export const headsOf = (people) => list(people).reduce((n, p) => n + 1 + list(p && p.guests).length, 0);
export const freeSpotsOf = (ev) => Math.max(0, capacityOf(ev) - headsOf(ev && ev.attendees));

/**
 * Kickoff time in ms. `toMs(y, monthIndex, d, h, min)` turns the game's wall-clock time into ms;
 * the website uses the browser's clock, the server passes the community's time zone.
 */
export function startMsOf(ev, toMs = (y, mo, d, h, mi) => new Date(y, mo, d, h, mi, 0).getTime()) {
    const date = String(ev?.date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    const m = String(ev?.time || '').match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
    let h = m ? parseInt(m[1], 10) : 0;
    const mi = m ? parseInt(m[2], 10) : 0;
    const ap = m && m[3] ? m[3].toUpperCase() : '';
    if (ap === 'PM' && h < 12) h += 12;
    if (ap === 'AM' && h === 12) h = 0;
    const [y, mo, d] = date.split('-').map(Number);
    return toMs(y, mo - 1, d, h, mi);
}

// ------------------------------------------------------------------ refunds
// Game options (all optional, older games get the defaults):
//   refundPolicy        'always' | 'never' | 'sameday' | 'hours:1..4'   (cutoff for a full refund)
//   partialRefundPct    0 | 25 | 50 | 75   refund this much when cancelling after the cutoff (default 0)
//   refundIfSpotFilled  true / false       late cancel: money back once someone takes the spot (default false)
//   refundOnCancel      true / false       everyone refunded if the game is cancelled (default true)
//   claimMinutes        waitlist claim timer (default 40)

export function fullRefundAllowed(ev, now, startMs) {
    const p = (ev && ev.refundPolicy) || 'always';
    if (p === 'always') return true;
    if (p === 'never') return false;
    if (!startMs) return true;
    if (p === 'sameday') {
        const s = new Date(startMs);
        return now < new Date(s.getFullYear(), s.getMonth(), s.getDate()).getTime();
    }
    if (p.startsWith('hours:')) return now <= startMs - (parseInt(p.slice(6), 10) || 1) * 3600000;
    return true;
}

export const partialPctOf = (ev) => [25, 50, 75].includes(Number(ev && ev.partialRefundPct)) ? Number(ev.partialRefundPct) : 0;
export const refundsOnCancel = (ev) => !ev || ev.refundOnCancel !== false;
export const claimMinutesOf = (ev) => {
    const n = Number(ev && ev.claimMinutes);
    return CLAIM_MINUTES.includes(n) ? n : DEFAULT_CLAIM_MINUTES;
};

/**
 * What a player gets back when they leave now, having paid `paid` cents.
 * { now: cents refunded right away, later: cents refunded when someone takes the spot }
 */
export function leaveRefund(ev, paid, now, startMs) {
    paid = Math.max(0, Math.round(paid || 0));
    if (!paid) return { now: 0, later: 0 };
    if (fullRefundAllowed(ev, now, startMs)) return { now: paid, later: 0 };
    const part = Math.round(paid * partialPctOf(ev) / 100);
    return { now: part, later: ev && ev.refundIfSpotFilled === true ? paid - part : 0 };
}

const POLICY_TEXT = {
    never: 'No refunds',
    always: 'Always refunded',
    sameday: 'Full refund unless you cancel on the day of the game',
    'hours:1': 'Full refund unless you cancel less than 1 hour before',
    'hours:2': 'Full refund unless you cancel less than 2 hours before',
    'hours:3': 'Full refund unless you cancel less than 3 hours before',
    'hours:4': 'Full refund unless you cancel less than 4 hours before'
};

/** The whole refund policy in plain words (shown before joining, on the game, and in the rules screen). */
export function policyLines(ev) {
    const p = (ev && ev.refundPolicy) || 'always';
    const out = [POLICY_TEXT[p] || POLICY_TEXT.always + '.'];
    if (p !== 'always') {
        const pct = partialPctOf(ev);
        if (pct) out.push(`Cancel later than that and you get ${pct}% back.`);
        if (ev && ev.refundIfSpotFilled === true) out.push(pct ? 'The rest comes back if someone from the waitlist takes your spot.' : 'If you cancel late, you get your money back when someone from the waitlist takes your spot.');
    }
    out.push(refundsOnCancel(ev) ? 'If the game is cancelled (weather included), everyone is refunded.' : 'No refund if the game is cancelled.');
    return out.map((s) => (/[.!]$/.test(s) ? s : s + '.'));
}

// ------------------------------------------------------------------ waitlist spot offers
// When a spot opens and people are waiting, the server saves
//   spotOffer: { round, startedAt, expiresAt, lastCall }
// Round 1 offers the open spot(s) to the first waiting player(s). Every time the timer runs out (or
// an admin taps "Skip to next") the round goes up and one more person is included. First to confirm wins.

export const isLastCall = (ev, now, startMs) => !!(ev && ev.spotOffer && ev.spotOffer.lastCall) || (!!startMs && now >= startMs - LAST_CALL_MS);

/** Waiting players' uids, in order, without duplicates (a player + their waitlisted guests appear once). */
export function waitingUids(ev) {
    const seen = new Set();
    return list(ev && ev.waitingList).map(uidOf).filter((u) => u && !seen.has(u) && seen.add(u));
}

/** Who may claim an open spot right now. */
export function offerEligible(ev, now, startMs) {
    const waiting = waitingUids(ev);
    const free = freeSpotsOf(ev);
    if (!free || !waiting.length || !(ev && ev.spotOffer)) return [];
    if (isLastCall(ev, now, startMs)) return waiting;
    const round = Math.max(1, Number(ev.spotOffer.round) || 1);
    return waiting.slice(0, free + round - 1);
}

/**
 * Can this player take an open spot directly (instead of going to the waitlist)?
 * Spots that open up belong to the waitlist first.
 */
export function mayTakeSpot(ev, uid, now, startMs) {
    if (freeSpotsOf(ev) <= 0) return false;
    const others = waitingUids(ev).filter((u) => u !== String(uid));
    if (!others.length) return true;
    if (isLastCall(ev, now, startMs)) return true;
    return offerEligible(ev, now, startMs).includes(String(uid));
}

/** The "Didn't pay" list goes to the admins this long after the game (5 hours after it ends;
 *  with no End Event, the game is taken to last 2 hours). */
export const UNPAID_AFTER_MS = 5 * 3600000;
export const ASSUMED_GAME_MS = 2 * 3600000;
export function unpaidDueAt(ev, startMs) {
    if (ev && Number(ev.sessionEndedAt) > 0) return Number(ev.sessionEndedAt) + UNPAID_AFTER_MS;
    return startMs ? startMs + ASSUMED_GAME_MS + UNPAID_AFTER_MS : 0;
}
/** Who still owes money for a paid game: [{ uid, name, cents, guests }] (guests = how many unpaid guests).
 *  Skips the organizer, anyone Paid / Credit / Free, and players the admin chose to ignore. */
export function unpaidList(ev) {
    const fee = feeCentsOf(ev);
    if (!ev || fee <= 0) return [];
    const per = fee + plusOneExtraOf(ev);
    const ignored = new Set((ev.unpaidIgnored || []).map(String));
    const done = (p) => p === 'Paid' || p === 'Credit' || p === 'Free';
    const out = [];
    (ev.attendees || []).forEach(a => {
        const uid = String(a.uid || a.id || '');
        if (!uid || ignored.has(uid) || uid === String(ev.organizerId) || a.role === 'Organizer') return;
        const selfOwes = !(Number(a.creditPaidCents) > 0) && !done(a.paid);
        // A guest owes when not marked paid (guests of a credit payer with no mark are covered by the credit).
        const guests = (a.guests || []).filter(g => g && !done(g.paid) && !(Number(a.creditPaidCents) > 0 && !g.paid)).length;
        const cents = (selfOwes ? fee : 0) + guests * per;
        if (cents > 0) out.push({ uid, name: a.name || 'Player', cents, guests, self: selfOwes });
    });
    return out;
}

/** When the current offer should move on to the next person (never past the last-call moment). */
export function offerExpiry(ev, now, startMs) {
    const t = now + claimMinutesOf(ev) * 60000;
    return startMs ? Math.min(t, startMs - LAST_CALL_MS) : t;
}
