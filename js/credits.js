// js/credits.js: Community credit.
// Members pay a community admin outside the app (Zelle / Cash App / cash), the admin adds the amount as
// credit, and the game fee is taken from that credit when the member joins a community game.
//
// Firestore layout (money is always stored in CENTS, so there are no rounding errors):
//   artifacts/{appId}/communities/{id}/credits/{uid}       -> { uid, name, balanceCents, updatedAt }
//   artifacts/{appId}/communities/{id}/creditLedger/{auto} -> { uid, name, amountCents (+ added / - used),
//                                                              type: 'topup'|'adjust'|'game'|'refund',
//                                                              note, eventId, eventTitle, by, byName, at, balanceAfterCents }
// Games carry:  payWithCredit (bool), refundPolicy ('always' | 'never' | 'sameday' | 'hours:1' | 'hours:2' | 'hours:3').
// A player who paid with credit carries on the roster entry:  creditPaidCents, creditCommunityId.
import { db, appId } from './firebase-config.js';
import {
    doc, collection, runTransaction, serverTimestamp, getDoc, getDocs, query, where
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { escapeHtml as esc, jsArg, mutateEvent } from './game-profile/event-store.js';
import { policyLines, fullRefundAllowed, leaveRefund, startMsOf, refundsOnCancel, CLAIM_MINUTES, DEFAULT_CLAIM_MINUTES, claimMinutesOf, partialPctOf } from './money-rules.js';

const toast = (m, t) => window.showToast && window.showToast(m, t);
const credRef = (cid, uid) => doc(db, 'artifacts', appId, 'communities', cid, 'credits', String(uid));
const ledgerCol = (cid) => collection(db, 'artifacts', appId, 'communities', cid, 'creditLedger');

// ------------------------------------------------------------------ helpers
export const dollars = (cents) => {
    const c = Math.round(Number(cents) || 0);
    return `${c < 0 ? '-' : ''}$${(Math.abs(c) / 100).toFixed(2)}`;
};

/** "$6" / 6 / "6.50" -> 600 cents. Free -> 0. */
export function feeCents(ev) {
    let raw = 0;
    if (ev && ev.price !== undefined && ev.price !== null && ev.price !== '') raw = parseFloat(ev.price) || 0;
    else if (ev && ev.fee !== undefined && ev.fee !== null) raw = parseFloat(String(ev.fee).replace(/[^0-9.]/g, '')) || 0;
    return Math.round(raw * 100);
}

/** Start time of a game as a Date (handles "19:00" and "7:00 PM"). */
export function eventStart(ev) {
    const date = String(ev?.date || '').slice(0, 10);
    const m = String(ev?.time || '').match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    let h = m ? parseInt(m[1], 10) : 0;
    const min = m ? parseInt(m[2], 10) : 0;
    const ap = m && m[3] ? m[3].toUpperCase() : '';
    if (ap === 'PM' && h < 12) h += 12;
    if (ap === 'AM' && h === 12) h = 0;
    const [y, mo, d] = date.split('-').map(Number);
    return new Date(y, mo - 1, d, h, min, 0);
}

export const REFUND_POLICIES = [
    ['hours:1', 'Full refund until 1 hour before'],
    ['hours:2', 'Full refund until 2 hours before'],
    ['hours:3', 'Full refund until 3 hours before'],
    ['hours:4', 'Full refund until 4 hours before'],
    ['sameday', 'Full refund until the day of the game'],
    ['always', 'Always refund'],
    ['never', 'Never refund']
];

/** The refund policy in plain words (all the game's refund options). */
export function policyText(ev) { return policyLines(ev).join(' '); }

/** Does the game's rule give a FULL refund if the player cancels right now? */
export function refundAllowed(ev, now = Date.now()) {
    return fullRefundAllowed(ev, now, startMsOf(ev));
}

/** What the player gets back if they leave right now: { now, later } in cents. */
export function myLeaveRefund(ev, paid, now = Date.now()) {
    return leaveRefund(ev, paid, now, startMsOf(ev));
}

/** Extra charge per +1 (cents), set by the game creator. 0 when none. */
export function plusOneExtraCents(ev) {
    const v = Number(ev && ev.plusOneExtra);
    return Number.isFinite(v) && v > 0 ? Math.round(v * 100) : 0;
}

/** Total a player owes for themselves + N guests: fee for each head, plus the +1 extra for each guest. */
export function costCents(ev, guestCount = 0) {
    const g = Math.max(0, guestCount | 0);
    return feeCents(ev) + g * (feeCents(ev) + plusOneExtraCents(ev));
}

/** Game takes credit: community game, credit switched on, and it has a fee. */
export const creditGame = (ev) => !!(ev && ev.communityId && ev.payWithCredit === true && feeCents(ev) > 0);

// ------------------------------------------------------------------ writes (always in a transaction)
async function writeLedger(tx, cid, entry) {
    tx.set(doc(ledgerCol(cid)), { ...entry, at: serverTimestamp() });
}

/** Admin adds (or removes) credit for a member. amountCents > 0 adds, < 0 removes. */
export async function adminAdjustCredit(cid, uid, name, amountCents, note, type) {
    const me = window.currentUser;
    if (!me) return false;
    amountCents = Math.round(amountCents);
    if (!amountCents) { toast('Enter an amount', 'error'); return false; }
    try {
        await runTransaction(db, async (tx) => {
            const ref = credRef(cid, uid);
            const snap = await tx.get(ref);
            const before = snap.exists() ? (snap.data().balanceCents || 0) : 0;
            const after = before + amountCents;
            if (after < 0) throw new Error('NEGATIVE');
            tx.set(ref, { uid: String(uid), name: name || (snap.exists() ? snap.data().name : '') || 'Member', balanceCents: after, updatedAt: serverTimestamp() }, { merge: true });
            await writeLedger(tx, cid, {
                uid: String(uid), name: name || 'Member', amountCents, type: type || (amountCents > 0 ? 'topup' : 'adjust'),
                note: String(note || '').slice(0, 120), by: me.uid, byName: window.userProfile?.name || window.userProfile?.firstName || 'Admin',
                balanceAfterCents: after
            });
        });
        return true;
    } catch (e) {
        console.error('credit adjust failed', e);
        toast(e.message === 'NEGATIVE' ? "That would take the balance below $0." : 'Could not update credit', 'error');
        return false;
    }
}

/** Hooks for mutateEvent: takes the game fee from the joining player's credit in the same transaction. */
export function joinHooks(ev, uid) {
    const cid = ev.communityId;
    return {
        read: async (tx) => {
            const s = await tx.get(credRef(cid, uid));
            return { charge: 0, balance: s.exists() ? (s.data().balanceCents || 0) : 0, name: s.exists() ? s.data().name : '' };
        },
        write: async (tx, draft, ctx) => {
            if (!ctx || !ctx.charge) return;
            const after = ctx.balance - ctx.charge;
            tx.set(credRef(cid, uid), { uid: String(uid), name: ctx.name || window.userProfile?.name || 'Member', balanceCents: after, updatedAt: serverTimestamp() }, { merge: true });
            await writeLedger(tx, cid, {
                uid: String(uid), name: ctx.name || 'Member', amountCents: -ctx.charge, type: 'game', note: ctx.chargeNote || 'Game fee',
                eventId: ev.id, eventTitle: ev.title || 'Game', by: String(uid), byName: ctx.name || 'Member', balanceAfterCents: after
            });
        }
    };
}

/** Hooks for mutateEvent: gives credit back in the same transaction. The mutator sets ctx.refund (cents) and ctx.note. */
export function refundHooks(ev, uid) {
    const cid = ev.communityId;
    return {
        read: async (tx) => {
            const s = await tx.get(credRef(cid, uid));
            return { refund: 0, note: '', balance: s.exists() ? (s.data().balanceCents || 0) : 0, name: s.exists() ? s.data().name : '' };
        },
        write: async (tx, draft, ctx) => {
            if (!ctx || !ctx.refund) return;
            const after = ctx.balance + ctx.refund;
            tx.set(credRef(cid, uid), { uid: String(uid), name: ctx.name || 'Member', balanceCents: after, updatedAt: serverTimestamp() }, { merge: true });
            await writeLedger(tx, cid, {
                uid: String(uid), name: ctx.name || 'Member', amountCents: ctx.refund, type: 'refund', note: ctx.note || 'Refund',
                eventId: ev.id, eventTitle: ev.title || 'Game', by: window.currentUser?.uid || String(uid),
                byName: window.userProfile?.name || window.userProfile?.firstName || 'Member', balanceAfterCents: after
            });
        }
    };
}

/** One credit refund to one member, in its own transaction (used for cancels and admin refunds). */
export async function refundMember(cid, uid, name, cents, ev, note) {
    cents = Math.round(cents || 0);
    if (!cid || !uid || cents <= 0) return false;
    await runTransaction(db, async (tx) => {
        const ref = credRef(cid, uid);
        const s = await tx.get(ref);
        const after = (s.exists() ? (s.data().balanceCents || 0) : 0) + cents;
        tx.set(ref, { uid: String(uid), name: name || (s.exists() ? s.data().name : '') || 'Member', balanceCents: after, updatedAt: serverTimestamp() }, { merge: true });
        await writeLedger(tx, cid, {
            uid: String(uid), name: name || 'Member', amountCents: cents, type: 'refund', note: note || 'Refund',
            eventId: ev?.id || '', eventTitle: ev?.title || 'Game', by: window.currentUser?.uid || '',
            byName: window.userProfile?.name || window.userProfile?.firstName || 'Organizer', balanceAfterCents: after
        });
    });
    return true;
}

/**
 * Game is being cancelled: give every credit payment back, unless the organizer turned
 * "Refund everyone if the game is cancelled" off. People who left late and were still
 * waiting for their money (refund-if-spot-filled) get it back too.
 */
export async function refundEveryoneForGame(ev) {
    if (!ev || !ev.communityId || !refundsOnCancel(ev)) return;
    const paid = (ev.attendees || []).filter(a => a && a.creditPaidCents > 0)
        .map(a => ({ uid: a.uid, name: a.name, cents: a.creditPaidCents, cid: a.creditCommunityId || ev.communityId }));
    (ev.pendingRefunds || []).forEach(r => { if (r && r.cents > 0) paid.push({ uid: r.uid, name: r.name, cents: r.cents, cid: r.cid || ev.communityId }); });
    for (const a of paid) {
        try { await refundMember(a.cid, a.uid, a.name, a.cents, ev, 'Game was cancelled'); }
        catch (e) { console.error('refund failed for', a.uid, e); toast(`Could not refund ${a.name || 'a player'}'s credit`, 'error'); }
    }
}

// ------------------------------------------------------------------ UI (used by communities.js)
const BTN = 'px-3 py-2 rounded-xl text-xs font-bold transition';
const BTN_PRIMARY = `${BTN} bg-[#00F296] text-slate-950 hover:opacity-90`;
const BTN_DARK = `${BTN} bg-black/50 border border-white/15 text-white hover:bg-black`;
const INPUT = 'w-full bg-black/60 border border-teal-500/50 rounded-xl px-3 py-2.5 text-white text-base sm:text-xs focus:outline-none focus:border-[#00F296]';
const DEFAULT_AVATAR = 'https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg';
const safeImg = (u) => { u = String(u || ''); return (/^https?:\/\//i.test(u) || /^data:image\//i.test(u)) ? u : DEFAULT_AVATAR; };
const tsMs = (t) => t?.toMillis ? t.toMillis() : (t?.seconds ? t.seconds * 1000 : 0);

// Live profile picture (player directory first), then the saved one, then a letter avatar.
const photoOf = (who) => {
    if (window.resolvePlayerAvatar) return window.resolvePlayerAvatar(who);
    const d = (window.directoryList || []).find(u => String(u.uid) === String(who.uid));
    return safeImg(d?.avatar || d?.photoURL || who.avatar);
};
const photoImg = (who, cls) => `<img src="${esc(photoOf(who))}" class="${cls} rounded-full object-cover shrink-0" onerror="this.src='${DEFAULT_AVATAR}'">`;

const ledgerLine = (l, showName) => {
    const plus = (l.amountCents || 0) > 0;
    const when = tsMs(l.at) ? new Date(tsMs(l.at)).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'just now';
    const label = l.type === 'topup' ? 'Credit added' : l.type === 'game' ? `Game: ${l.eventTitle || ''}` : l.type === 'refund' ? `Refund: ${l.eventTitle || l.note || ''}` : 'Adjustment';
    return `<div class="flex items-center gap-2 bg-black/40 border border-white/10 rounded-xl px-3 py-2">
        ${showName ? photoImg({ uid: l.uid, name: l.name }, 'w-7 h-7') : ''}
        <div class="flex-1 min-w-0">
            <div class="text-[11px] font-bold text-white truncate">${showName ? esc(l.name || 'Member') + ' • ' : ''}${esc(label)}</div>
            <div class="text-[10px] text-white/50 truncate">${when}${l.note && l.type !== 'game' && l.type !== 'refund' ? ' • ' + esc(l.note) : ''}${l.byName && l.type === 'topup' ? ' • by ' + esc(l.byName) : ''}</div>
        </div>
        <div class="text-xs font-black ${plus ? 'text-[#00F296]' : 'text-red-300'}">${plus ? '+' : ''}${dollars(l.amountCents)}</div>
    </div>`;
};

/** What a member sees: their balance + history. */
export function memberCreditHtml(c, myDoc, myLedger) {
    const bal = myDoc?.balanceCents || 0;
    return `<div class="space-y-4">
        <div class="bg-gradient-to-r from-emerald-950 to-teal-950 border border-[#00F296]/50 rounded-2xl p-4 text-center">
            <div class="text-[10px] font-black uppercase tracking-wider text-[#00F296]">Your credit in ${esc(c.name)}</div>
            <div class="text-3xl font-black text-white mt-1">${dollars(bal)}</div>
            <p class="text-[11px] text-white/60 mt-2">Pay a community admin and they will add it here. Game fees come out of your credit automatically when you join.</p>
        </div>
        <div><div class="text-[10px] font-black uppercase tracking-wider text-[#00F296] mb-2">How to add credit</div>${paymentMethodsHtml(c, 0, c.adminName || 'a community admin')}</div>
        <div><div class="text-[10px] font-black uppercase tracking-wider text-[#00F296] mb-2">History</div>
            <div class="space-y-1.5">${myLedger.length ? myLedger.slice(0, 30).map(l => ledgerLine(l, false)).join('') : '<p class="text-xs text-white/50 italic">No credit activity yet.</p>'}</div></div>
    </div>`;
}

/** What an admin sees: every member's balance, add-credit buttons, recent activity. */
export function adminCreditHtml(c, members, credits, ledger) {
    const total = Object.values(credits).reduce((s, x) => s + (x.balanceCents || 0), 0);
    return `<div class="space-y-4">
        <div class="bg-black/40 border border-white/10 rounded-2xl p-3 flex items-center justify-between">
            <span class="text-[11px] font-bold text-white/70">Credit held for members</span>
            <span class="text-sm font-black text-[#00F296]">${dollars(total)}</span>
        </div>
        <div><div class="text-[10px] font-black uppercase tracking-wider text-[#00F296] mb-2">Members</div>
            <div class="relative mb-2">
                <i class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-white/40 text-xs"></i>
                <input id="credit-search" type="search" placeholder="Search members" autocomplete="off" value="${esc(window._creditSearch || '')}" oninput="filterCreditMembers(this.value)"
                    class="w-full bg-black/50 border border-white/15 focus:border-[#00F296] outline-none rounded-xl pl-8 pr-3 py-2.5 text-base sm:text-sm text-white placeholder-white/40">
            </div>
            <div id="credit-members" class="space-y-2">${members.map(m => {
                const bal = credits[m.uid]?.balanceCents || 0;
                const q = foldName(window._creditSearch || '');
                const hide = q && !foldName(m.name || '').includes(q);
                return `<div data-credit-name="${esc(foldName(m.name || ''))}" class="${hide ? 'hidden ' : ''}flex items-center gap-2 bg-black/40 border border-white/10 rounded-xl p-2.5">
                    ${photoImg(m, 'w-9 h-9 border border-emerald-500/40')}
                    <div class="flex-1 min-w-0"><div class="text-xs font-bold text-white truncate">${esc(m.name || 'Player')}</div>
                    <div class="text-[10px] ${bal > 0 ? 'text-[#00F296]' : 'text-white/50'}">Balance ${dollars(bal)}</div></div>
                    <button onclick="openCreditModal('${jsArg(c.id)}', '${jsArg(m.uid)}', '${jsArg(m.name || 'Member')}')" class="${BTN_PRIMARY} shrink-0">Manage credits</button>
                </div>`;
            }).join('') || '<p class="text-xs text-white/50 italic">No members yet.</p>'}</div>
            <p id="credit-no-match" class="hidden text-xs text-white/50 italic text-center py-3">No members match your search.</p></div>
        <div><div class="text-[10px] font-black uppercase tracking-wider text-[#00F296] mb-2">Recent activity</div>
            <div class="space-y-1.5">${ledger.length ? ledger.slice(0, 30).map(l => ledgerLine(l, true)).join('') : '<p class="text-xs text-white/50 italic">Nothing yet.</p>'}</div></div>
    </div>`;
}

/** Lowercase, no accents: "José" matches "jose". */
const foldName = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Credit tab search: hides members whose name doesn't match (kept while the list refreshes). */
window.filterCreditMembers = function(v) {
    window._creditSearch = String(v || '');
    const q = foldName(v);
    let shown = 0;
    document.querySelectorAll('#credit-members [data-credit-name]').forEach(row => {
        const ok = !q || row.getAttribute('data-credit-name').includes(q);
        row.classList.toggle('hidden', !ok);
        if (ok) shown++;
    });
    document.getElementById('credit-no-match')?.classList.toggle('hidden', shown > 0 || !q);
};

const TAB_ON = 'py-2 rounded-lg text-[11px] font-black bg-[#00F296] text-slate-950';
const TAB_OFF = 'py-2 rounded-lg text-[11px] font-black text-white/60';

/** Manage credits for one member: Add, Remove, or History (their whole ledger). */
window.openCreditModal = function(cid, uid, name) {
    document.getElementById('credit-modal')?.remove();
    const el = document.createElement('div');
    el.id = 'credit-modal';
    el.className = 'fixed inset-0 z-[210] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm';
    el.innerHTML = `
        <div class="bg-[#040E13] border border-emerald-500/40 rounded-3xl max-w-sm w-full p-5 space-y-4 text-white shadow-2xl max-h-[90vh] flex flex-col" onclick="event.stopPropagation()">
            <div class="flex items-center justify-between border-b border-white/10 pb-3">
                <div class="min-w-0"><h4 class="text-xs font-black uppercase truncate">Manage credits • ${esc(name)}</h4>
                    <div class="text-[11px] text-white/60 mt-0.5">Balance: <span id="credit-modal-bal" class="font-black text-[#00F296]">…</span></div></div>
                <button onclick="document.getElementById('credit-modal').remove()" class="text-white/50 hover:text-white text-lg font-bold"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="grid grid-cols-3 gap-1 bg-black/60 p-1 rounded-xl border border-white/10">
                <button id="credit-mode-add" onclick="setCreditMode('add')" class="${TAB_ON}">Add</button>
                <button id="credit-mode-remove" onclick="setCreditMode('remove')" class="${TAB_OFF}">Remove</button>
                <button id="credit-mode-history" onclick="setCreditMode('history')" class="${TAB_OFF}">History</button>
            </div>
            <div id="credit-form" class="space-y-4">
                <div><label class="text-[10px] font-black uppercase text-white/60">Amount ($)</label>
                    <input id="credit-amount" type="number" inputmode="decimal" min="0" step="0.01" placeholder="20" class="${INPUT} mt-1"></div>
                <div><label class="text-[10px] font-black uppercase text-white/60">Note (optional)</label>
                    <input id="credit-note" maxlength="120" placeholder="Zelle, Cash App, cash..." class="${INPUT} mt-1"></div>
                <button id="credit-save" onclick="saveCreditModal('${jsArg(cid)}', '${jsArg(uid)}', '${jsArg(name)}')" class="${BTN_PRIMARY} w-full py-3 text-sm">Add credit</button>
            </div>
            <div id="credit-history" class="hidden space-y-1.5 overflow-y-auto min-h-0 -mx-1 px-1"></div>
        </div>`;
    el.onclick = () => el.remove();
    document.body.appendChild(el);
    window._creditMode = 'add';
    window._creditFor = { cid, uid, name };
    loadCreditHistory(cid, uid);
    setTimeout(() => document.getElementById('credit-amount')?.focus(), 50);
};

window.setCreditMode = function(mode) {
    window._creditMode = mode;
    ['add', 'remove', 'history'].forEach(m => { const b = document.getElementById(`credit-mode-${m}`); if (b) b.className = m === mode ? TAB_ON : TAB_OFF; });
    document.getElementById('credit-form')?.classList.toggle('hidden', mode === 'history');
    document.getElementById('credit-history')?.classList.toggle('hidden', mode !== 'history');
    const save = document.getElementById('credit-save');
    if (save) save.textContent = mode === 'remove' ? 'Remove credit' : 'Add credit';
};

/** One member's full credit history (every add, removal, game fee and refund), newest first. */
async function loadCreditHistory(cid, uid) {
    const box = document.getElementById('credit-history');
    if (box) box.innerHTML = '<p class="text-xs text-white/50 text-center py-4"><i class="fa-solid fa-spinner fa-spin mr-1"></i> Loading history…</p>';
    try {
        const [bal, snap] = await Promise.all([getDoc(credRef(cid, uid)), getDocs(query(ledgerCol(cid), where('uid', '==', String(uid))))]);
        const balEl = document.getElementById('credit-modal-bal');
        if (balEl) balEl.textContent = dollars(bal.exists() ? (bal.data().balanceCents || 0) : 0);
        const rows = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => tsMs(b.at) - tsMs(a.at));
        const b = document.getElementById('credit-history'); if (!b) return;
        if (!rows.length) { b.innerHTML = '<p class="text-xs text-white/50 italic text-center py-4">No credit activity yet.</p>'; return; }
        const added = rows.filter(r => r.amountCents > 0).reduce((t, r) => t + r.amountCents, 0);
        const used = rows.filter(r => r.amountCents < 0).reduce((t, r) => t - r.amountCents, 0);
        b.innerHTML = `<div class="grid grid-cols-2 gap-2 mb-2">
                <div class="bg-black/40 border border-white/10 rounded-xl p-2 text-center"><div class="text-[9px] font-black uppercase text-white/50">Added + refunds</div><div class="text-sm font-black text-[#00F296]">${dollars(added)}</div></div>
                <div class="bg-black/40 border border-white/10 rounded-xl p-2 text-center"><div class="text-[9px] font-black uppercase text-white/50">Used + removed</div><div class="text-sm font-black text-red-300">${dollars(used)}</div></div>
            </div>` + rows.map(l => historyLine(l)).join('');
    } catch (e) {
        console.error('credit history', e);
        const b = document.getElementById('credit-history');
        if (b) b.innerHTML = '<p class="text-xs text-red-300 text-center py-4">Could not load the history. Try again.</p>';
    }
}

/** A ledger line with the balance after it (so the admin can follow the money step by step). */
const historyLine = (l) => {
    const plus = (l.amountCents || 0) > 0;
    const when = tsMs(l.at) ? new Date(tsMs(l.at)).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'just now';
    const label = l.type === 'topup' ? 'Credit added' : l.type === 'game' ? `Game: ${l.eventTitle || ''}` : l.type === 'refund' ? `Refund: ${l.eventTitle || l.note || ''}` : (plus ? 'Credit added' : 'Credit removed');
    const bits = [when];
    if (l.note && l.type !== 'game') bits.push(esc(l.note));
    if (l.byName && (l.type === 'topup' || l.type === 'adjust')) bits.push('by ' + esc(l.byName));
    return `<div class="flex items-center gap-2 bg-black/40 border border-white/10 rounded-xl px-3 py-2">
        <div class="flex-1 min-w-0">
            <div class="text-[11px] font-bold text-white truncate">${esc(label)}</div>
            <div class="text-[10px] text-white/50">${bits.join(' • ')}</div>
        </div>
        <div class="text-right shrink-0">
            <div class="text-xs font-black ${plus ? 'text-[#00F296]' : 'text-red-300'}">${plus ? '+' : ''}${dollars(l.amountCents)}</div>
            ${typeof l.balanceAfterCents === 'number' ? `<div class="text-[9px] text-white/40">Bal. ${dollars(l.balanceAfterCents)}</div>` : ''}
        </div>
    </div>`;
};

window.saveCreditModal = async function(cid, uid, name) {
    const amt = parseFloat(document.getElementById('credit-amount')?.value || '');
    if (!(amt > 0)) { toast('Enter an amount greater than 0', 'error'); return; }
    const cents = Math.round(amt * 100) * (window._creditMode === 'remove' ? -1 : 1);
    const note = document.getElementById('credit-note')?.value || '';
    const btn = document.getElementById('credit-save'); if (btn) btn.disabled = true;
    const ok = await adminAdjustCredit(cid, uid, name, cents, note, cents > 0 ? 'topup' : 'adjust');
    if (ok) { toast(cents > 0 ? `Added ${dollars(cents)} for ${name}` : `Removed ${dollars(-cents)} from ${name}`); document.getElementById('credit-modal')?.remove(); }
    else if (btn) btn.disabled = false;
};

// ------------------------------------------------------------------ game options (create form + edit/copy wizard)
// idp = id prefix of the inputs, v = current values of the game (or {} for a new one).
const optToggle = (id, title, sub, on) => `
        <label class="flex items-center justify-between gap-3 cursor-pointer">
            <span><span class="block text-xs font-bold text-white">${title}</span><span class="block text-[10px] text-white/50">${sub}</span></span>
            <input id="${id}" type="checkbox" ${on ? 'checked' : ''} class="w-5 h-5 accent-[#00F296] shrink-0">
        </label>`;

export function payOptionsHtml(idp, v = {}) {
    const must = v.payWithCredit !== false;
    const policy = v.refundPolicy || 'hours:1';
    const pct = partialPctOf(v);
    return `
    <div id="${idp}-pay-block" class="space-y-3 bg-black/30 border border-emerald-500/30 rounded-2xl p-3">
        <label class="flex items-center justify-between gap-3 cursor-pointer">
            <span><span class="block text-xs font-bold text-white">Must pay to be confirmed</span><span class="block text-[10px] text-white/50">Credit system: the fee comes out of the member's credit. No credit, no spot.</span></span>
            <input id="${idp}-must" type="checkbox" ${must ? 'checked' : ''} onchange="document.getElementById('${idp}-refund-wrap').classList.toggle('hidden', !this.checked)" class="w-5 h-5 accent-[#00F296] shrink-0">
        </label>
        <div id="${idp}-refund-wrap" class="${must ? '' : 'hidden'} space-y-3">
            <div>
                <label class="block text-[10px] font-black uppercase tracking-wider text-[#00F296] mb-1">Refund policy</label>
                <select id="${idp}-refund" class="${INPUT}">${REFUND_POLICIES.map(([k, t]) => `<option value="${k}" ${k === policy ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
            </div>
            <div>
                <label class="block text-[10px] font-black uppercase tracking-wider text-[#00F296] mb-1">Cancel after that</label>
                <select id="${idp}-partial" class="${INPUT}">${[0, 25, 50, 75].map(n => `<option value="${n}" ${n === pct ? 'selected' : ''}>${n ? `Give ${n}% back` : 'No refund'}</option>`).join('')}</select>
            </div>
            ${optToggle(`${idp}-spotfill`, 'Refund if their spot gets filled', 'Late cancel: the player gets the money back once someone from the waitlist takes the spot.', v.refundIfSpotFilled === true)}
            ${optToggle(`${idp}-oncancel`, 'Refund everyone if the game is cancelled', 'Weather included. Shown to players in the refund policy.', v.refundOnCancel !== false)}
        </div>
    </div>`;
}

/** Waitlist timer: works for free and paid games. */
export function waitlistOptionsHtml(idp, v = {}) {
    const cur = claimMinutesOf(v);
    return `
    <div class="space-y-1 bg-black/30 border border-emerald-500/30 rounded-2xl p-3">
        <label class="block text-[10px] font-black uppercase tracking-wider text-[#00F296]">Waitlist: time to claim an open spot</label>
        <select id="${idp}-claim" class="${INPUT}">${CLAIM_MINUTES.map(n => `<option value="${n}" ${n === cur ? 'selected' : ''}>${n === 60 ? '1 hour' : n + ' minutes'}${n === DEFAULT_CLAIM_MINUTES ? ' (default)' : ''}</option>`).join('')}</select>
        <p class="text-[10px] text-white/50">When someone cancels, the next player on the waitlist has this long to confirm. Then the next one is invited too, first to confirm gets it.</p>
    </div>`;
}

export function readWaitlistOptions(idp) {
    const n = parseInt(document.getElementById(`${idp}-claim`)?.value, 10);
    return { claimMinutes: CLAIM_MINUTES.includes(n) ? n : DEFAULT_CLAIM_MINUTES };
}

export function plusExtraHtml(idp, v = {}) {
    const cur = Number(v.plusOneExtra);
    const on = v.plusOneExtra === undefined ? true : cur > 0;
    const amt = cur > 0 ? cur : 1;
    return `
    <div id="${idp}-p1-block" class="space-y-2 bg-black/30 border border-emerald-500/30 rounded-2xl p-3">
        <label class="flex items-center justify-between gap-3 cursor-pointer">
            <span><span class="block text-xs font-bold text-white">Charge extra for +1?</span><span class="block text-[10px] text-white/50">On top of the game fee, for each guest a member brings.</span></span>
            <input id="${idp}-p1-on" type="checkbox" ${on ? 'checked' : ''} onchange="document.getElementById('${idp}-p1-amt-wrap').classList.toggle('hidden', !this.checked)" class="w-5 h-5 accent-[#00F296] shrink-0">
        </label>
        <div id="${idp}-p1-amt-wrap" class="${on ? '' : 'hidden'}">
            <select id="${idp}-p1-amt" class="${INPUT}">${[1, 2, 3].map(n => `<option value="${n}" ${n === amt ? 'selected' : ''}>+$${n} per guest</option>`).join('')}</select>
        </div>
    </div>`;
}

/** Reads the inputs made by payOptionsHtml / plusExtraHtml. */
export function readPayOptions(idp) {
    const g = (id) => document.getElementById(`${idp}-${id}`);
    const must = !!g('must')?.checked;
    const p1On = !!g('p1-on')?.checked;
    return {
        payWithCredit: must,
        refundPolicy: g('refund')?.value || 'hours:1',
        partialRefundPct: parseInt(g('partial')?.value, 10) || 0,
        refundIfSpotFilled: !!g('spotfill')?.checked,
        refundOnCancel: g('oncancel') ? !!g('oncancel').checked : true,
        plusOneExtra: p1On ? (parseInt(g('p1-amt')?.value, 10) || 1) : 0
    };
}

// ------------------------------------------------------------------ accepted payments
// Community admins save how members can pay them: communities/{id}.paymentMethods = { zelle, venmo, cashapp, paypal, applepay }
const PAY_KINDS = [
    ['zelle', 'Zelle', 'fa-solid fa-building-columns', 'Email or phone'],
    ['venmo', 'Venmo', 'fa-brands fa-vimeo-v', '@username'],
    ['cashapp', 'Cash App', 'fa-solid fa-dollar-sign', '$cashtag'],
    ['paypal', 'PayPal', 'fa-brands fa-paypal', 'paypal.me name or email'],
    ['applepay', 'Apple Pay', 'fa-brands fa-apple', 'Phone or email for Apple Cash']
];
const clean = (v) => String(v || '').trim().slice(0, 80);

function payLink(kind, value, cents) {
    const amt = cents > 0 ? (cents / 100).toFixed(2) : '';
    if (kind === 'venmo') return `https://venmo.com/u/${encodeURIComponent(value.replace(/^@/, ''))}`;
    if (kind === 'cashapp') return `https://cash.app/$${encodeURIComponent(value.replace(/^\$/, ''))}${amt ? '/' + amt : ''}`;
    if (kind === 'paypal' && !value.includes('@')) return `https://paypal.me/${encodeURIComponent(value.replace(/^https?:\/\/(www\.)?paypal\.me\//i, ''))}${amt ? '/' + amt : ''}`;
    return '';
}

/** Payment details screen content: how to send money to the community admin. */
export function paymentMethodsHtml(community, cents, adminName) {
    const pm = (community && community.paymentMethods) || {};
    const rows = PAY_KINDS.filter(([k]) => clean(pm[k])).map(([k, label, icon]) => {
        const val = clean(pm[k]);
        const link = payLink(k, val, cents);
        return `<div class="flex items-center gap-2 bg-black/50 border border-white/10 rounded-xl p-2.5">
            <i class="${icon} text-[#00F296] w-5 text-center"></i>
            <div class="flex-1 min-w-0"><div class="text-[10px] font-black uppercase text-white/50">${label}</div><div class="text-xs font-bold text-white truncate">${esc(val)}</div></div>
            ${link ? `<a href="${esc(link)}" target="_blank" rel="noopener" class="shrink-0 bg-[#00F296] text-slate-950 font-black text-[10px] uppercase px-2.5 py-1.5 rounded-lg">Pay</a>` : ''}
            <button type="button" onclick="copyPayValue(this, '${jsArg(val)}')" class="shrink-0 bg-black/60 border border-white/20 text-white font-bold text-[10px] px-2.5 py-1.5 rounded-lg"><i class="fa-solid fa-copy"></i></button>
        </div>`;
    });
    if (!rows.length) return `<p class="text-xs text-white/70">Ask ${esc(adminName || 'your admin')} how to pay (Zelle, Venmo, Cash App, PayPal or Apple Pay). Once they get it, they add it to your credit.</p>`;
    return `<div class="space-y-2">${rows.join('')}</div>
        <p class="text-[10px] text-white/50">Send it to ${esc(adminName || 'your admin')}. Once they get it, they add it to your credit and you can join.</p>`;
}

window.copyPayValue = async function(btn, val) {
    let ok = false;
    try { await navigator.clipboard.writeText(val); ok = true; } catch (e) { ok = false; }
    if (ok && btn) { btn.innerHTML = '<i class="fa-solid fa-check"></i>'; setTimeout(() => { btn.innerHTML = '<i class="fa-solid fa-copy"></i>'; }, 1500); }
    toast(ok ? 'Copied!' : val, ok ? 'success' : 'info');
};

/** Admin form: how members can pay you. */
export function paymentMethodsFormHtml(community) {
    const pm = (community && community.paymentMethods) || {};
    return `<div class="space-y-2">${PAY_KINDS.map(([k, label, icon, ph]) => `
        <label class="flex items-center gap-2 bg-black/40 border border-white/10 rounded-xl p-2">
            <i class="${icon} text-[#00F296] w-5 text-center"></i>
            <span class="w-20 text-[11px] font-bold text-white shrink-0">${label}</span>
            <input id="pm-${k}" maxlength="80" value="${esc(clean(pm[k]))}" placeholder="${ph}" class="flex-1 min-w-0 bg-black/60 border border-teal-500/40 rounded-lg px-2 py-1.5 text-white text-base sm:text-xs focus:outline-none focus:border-[#00F296]">
        </label>`).join('')}</div>`;
}

export function readPaymentMethods() {
    const out = {};
    PAY_KINDS.forEach(([k]) => { out[k] = clean(document.getElementById(`pm-${k}`)?.value); });
    return out;
}

/** What the game costs, in words: "$6, +$1 per guest". */
export function costSummary(ev) {
    const f = feeCents(ev); if (!f) return 'Free';
    const x = plusOneExtraCents(ev);
    return `${dollars(f)}${ev.allowPlusOnes && x ? `, +${dollars(x)} extra per guest` : ''}`;
}

/** Fills every <span data-credit-balance="communityId"> with the signed-in member's balance. */
export async function hydrateBalances() {
    const me = window.currentUser; if (!me) return;
    const spans = Array.from(document.querySelectorAll('[data-credit-balance]'));
    for (const el of spans) {
        try {
            const s = await getDoc(credRef(el.getAttribute('data-credit-balance'), me.uid));
            el.textContent = dollars(s.exists() ? (s.data().balanceCents || 0) : 0);
        } catch (e) { el.textContent = '$0.00'; }
    }
}

/** Reads one member's balance (cents). */
export async function myBalanceCents(cid) {
    const me = window.currentUser; if (!me) return 0;
    try { const s = await getDoc(credRef(cid, me.uid)); return s.exists() ? (s.data().balanceCents || 0) : 0; }
    catch (e) { return 0; }
}

window.creditTools = {
    plusOneExtraCents, costCents, payOptionsHtml, plusExtraHtml, readPayOptions, costSummary, hydrateBalances, myBalanceCents,
    dollars, feeCents, eventStart, refundAllowed, policyText, creditGame, REFUND_POLICIES,
    joinHooks, refundHooks, refundEveryoneForGame, refundMember, adminAdjustCredit, memberCreditHtml, adminCreditHtml,
    waitlistOptionsHtml, readWaitlistOptions, myLeaveRefund, paymentMethodsHtml, paymentMethodsFormHtml, readPaymentMethods
};