// js/money-tracker.js: Community money tracker (admins only; members never see money numbers).
// Kept like an accountant would (accrual):
//   - Money players pay ahead (credit) is UNEARNED (prepaid). It becomes INCOME when the game is played:
//     game fees taken from credit (minus refunds) + cash marked Paid at that game.
//   - EXPENSES: one-off expenses, SUPPLIES when they're used (buying only fills the stock), EQUIPMENT wear
//     (by games played), FIXED costs (monthly / yearly / once) and PER-GAME costs (gas, washing pinnies).
//   - FutNet app costs (Apple, Google, hosting...) live in a private owner-only book, never in the community's.
//
// Firestore, under artifacts/{appId}/communities/{cid}/:
//   expenses/{id}    { id, amountCents, category, note, date 'YYYY-MM-DD', eventId?, eventTitle?, receiptUrl?, by, byName, createdAt }
//   supplies/{id}    { id, name, unit, qty, valueCents (what the stock on hand cost), lowAt }
//   supplyMoves/{id} { id, supplyId, name, unit, type 'buy'|'use', qty, cents, date, eventId?, eventTitle?, by, byName, createdAt }
//   equipment/{id}   { id, name, costCents, lifeGames, boughtDate, retiredDate?, note }
//   fixedCosts/{id}  { id, name, amountCents, every 'month'|'year'|'once', startDate, endDate? }
//   books/settings   { drive: { on, miles, method 'gas'|'irs', mpg, gasPrice, irsRate },
//                      wash: { on, loads, detergentPrice, loadsPerBottle, kwhPerLoad, kwhPrice, waterPerLoad },
//                      skipAuto: [eventId] }
// Owner only: artifacts/{appId}/ownerBooks/{ownerUid}/fixedCosts/{id} (same shape as fixedCosts).
import { db, appId } from './firebase-config.js';
import {
    doc, collection, getDocs, onSnapshot, setDoc, deleteDoc, updateDoc, runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { escapeHtml as esc, jsArg } from './game-profile/event-store.js';
import { feeCentsOf, plusOneExtraOf, startMsOf, unpaidList } from './money-rules.js';
import { uploadMedia, showUploadProgress, hideUploadProgress, mediaErrorText } from './wa-chat.js';

const toast = (m, t) => window.showToast && window.showToast(m, t);
const comm = (cid, ...p) => [db, 'artifacts', appId, 'communities', cid, ...p];
const ownerBook = (uid, ...p) => [db, 'artifacts', appId, 'ownerBooks', uid, ...p];
export const money = (c) => { const v = Math.round(Number(c) || 0); return `${v < 0 ? '-' : ''}$${(Math.abs(v) / 100).toFixed(2)}`; };
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const tsMs = (t) => (t && typeof t.toMillis === 'function') ? t.toMillis() : (Number(t) || 0);
const num = (v, d = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
const newId = (p) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
const myName = () => { const p = window.userProfile || {}; return p.name || p.firstName || window.currentUser?.displayName || 'Admin'; };

export const EXPENSE_KINDS = [
    ['field', '🏟️ Field'], ['drinks', '💧 Water & drinks'], ['balls', '⚽ Balls'],
    ['pinnies', '🎽 Pinnies'], ['referee', '🧑‍⚖️ Referee'], ['other', '📦 Other']
];
const kindLabel = (k) => (EXPENSE_KINDS.find(x => x[0] === k) || EXPENSE_KINDS[5])[1];

// Starting numbers for the per-game costs (the admin can change every one).
export const DEFAULTS = {
    drive: { on: false, miles: 20, method: 'gas', mpg: 25, gasPrice: 3.86, irsRate: 0.725 },
    wash: { on: false, loads: 1, detergentPrice: 15, loadsPerBottle: 64, kwhPerLoad: 3.5, kwhPrice: 0.137, waterPerLoad: 0.10 }
};

// ------------------------------------------------------------------ the math (pure, so it can be tested)
/** Cash collected at a game: players / guests marked Paid who didn't pay with credit. */
export function cashAtGame(ev) {
    const fee = feeCentsOf(ev);
    if (fee <= 0) return { cents: 0, people: 0 };
    const per = fee + plusOneExtraOf(ev);
    let cents = 0, people = 0;
    (ev.attendees || []).forEach(a => {
        if (!a) return;
        if (!(Number(a.creditPaidCents) > 0) && a.paid === 'Paid') { cents += fee; people++; }
        (a.guests || []).forEach(g => { if (g && g.paid === 'Paid') { cents += per; people++; } });
    });
    return { cents, people };
}

/** Washing: cost of one load (detergent + electricity + water), in cents. */
export function washLoadCents(w) {
    w = { ...DEFAULTS.wash, ...(w || {}) };
    const detergent = num(w.loadsPerBottle) > 0 ? num(w.detergentPrice) / num(w.loadsPerBottle) : 0;
    return Math.round((detergent + num(w.kwhPerLoad) * num(w.kwhPrice) + num(w.waterPerLoad)) * 100);
}
/** Driving: cost of one game's round trip, in cents. */
export function driveCents(d) {
    d = { ...DEFAULTS.drive, ...(d || {}) };
    if (d.method === 'irs') return Math.round(num(d.miles) * num(d.irsRate) * 100);
    return num(d.mpg) > 0 ? Math.round(num(d.miles) / num(d.mpg) * num(d.gasPrice) * 100) : 0;
}
/** Per-game costs for one played game: { drive, wash, total } in cents. */
export function autoCostsFor(settings) {
    const s = settings || {};
    const drive = s.drive && s.drive.on ? driveCents(s.drive) : 0;
    const wash = s.wash && s.wash.on ? Math.round(washLoadCents(s.wash) * Math.max(0, num(s.wash.loads, 1))) : 0;
    return { drive, wash, total: drive + wash };
}

/** Buying or using a supply: returns the new { qty, valueCents } and what the move cost. Average cost. */
export function applySupplyMove(supply, type, qty, paidCents = 0) {
    const have = num(supply && supply.qty), value = Math.round(num(supply && supply.valueCents));
    qty = num(qty);
    if (!(qty > 0)) throw new Error('Enter how many.');
    if (type === 'buy') return { qty: have + qty, valueCents: value + Math.round(num(paidCents)), cents: Math.round(num(paidCents)) };
    if (qty > have + 1e-9) throw new Error(`You only have ${have} left.`);
    const cents = have > 0 ? Math.round(value * qty / have) : 0;
    return { qty: +(have - qty).toFixed(4), valueCents: value - cents, cents };
}

const ym = (day) => String(day || '').slice(0, 7);
/** Months a fixed cost counts in (YYYY-MM list) -> cents for one month. */
function fixedForMonth(f, month) {
    const start = ym(f.startDate), end = f.endDate ? ym(f.endDate) : '';
    const amt = Math.round(num(f.amountCents));
    if (!start || month < start || (end && month > end)) return 0;
    if (f.every === 'once') return month === start ? amt : 0;
    if (f.every === 'year') return Math.round(amt / 12);
    return amt;
}
export function fixedTotal(list, months) {
    let sum = 0;
    (list || []).forEach(f => months.forEach(m => { sum += fixedForMonth(f, m); }));
    return sum;
}
/** Months inside a period, never past this month. key: 'YYYY-MM' | 'yYYYY' | 'all'. */
export function monthsOf(key, nowDate, earliest) {
    const cur = `${nowDate.getFullYear()}-${pad(nowDate.getMonth() + 1)}`;
    if (/^\d{4}-\d{2}$/.test(key)) return key <= cur ? [key] : [];
    let from;
    if (key.startsWith('y')) from = `${key.slice(1)}-01`;
    else from = earliest && earliest < cur ? earliest : cur;
    const out = [];
    let [y, m] = from.split('-').map(Number);
    const last = key.startsWith('y') ? (`${key.slice(1)}-12` < cur ? `${key.slice(1)}-12` : cur) : cur;
    while (`${y}-${pad(m)}` <= last && out.length < 600) { out.push(`${y}-${pad(m)}`); m++; if (m > 12) { m = 1; y++; } }
    return out;
}
export const matcher = (key) => key === 'all' ? () => true
    : key.startsWith('y') ? (day) => String(day || '').startsWith(key.slice(1))
    : (day) => String(day || '').startsWith(key);

/**
 * Equipment wear by games played: each played game after it was bought takes cost ÷ expected games,
 * until it's fully worn. Retiring it early counts what was left on the retire day.
 * Returns [{ id, name, perGame, used, leftCents, charges: [{ day, eventId, cents }] }].
 */
export function equipmentWear(equipment, playedGames) {
    const games = [...playedGames].sort((a, b) => (a.day + (a.start || '')).localeCompare(b.day + (b.start || '')));
    return (equipment || []).map(e => {
        const cost = Math.round(num(e.costCents)), life = Math.max(1, Math.round(num(e.lifeGames, 1)));
        const charges = [];
        let charged = 0;
        for (const g of games) {
            if (charges.length >= life) break;
            if (g.day < String(e.boughtDate || '')) continue;
            if (e.retiredDate && g.day > e.retiredDate) break;
            const k = charges.length;
            const c = k === life - 1 ? cost - charged : Math.floor(cost / life);
            charges.push({ day: g.day, eventId: g.id, cents: c }); charged += c;
        }
        if (e.retiredDate && charged < cost) charges.push({ day: e.retiredDate, eventId: null, cents: cost - charged, retired: true });
        const usedGames = charges.filter(c => c.eventId).length;
        return { id: e.id, name: e.name, perGame: Math.floor(cost / life), used: usedGames, life, leftCents: cost - charges.reduce((s, c) => s + c.cents, 0), charges, retired: !!e.retiredDate };
    });
}

/** Everything the money screen shows. */
export function moneyReport({ events, ledger, credits, expenses, supplies, supplyMoves, equipment, fixed, ownerFixed, settings, now, periodKey }) {
    const inPeriod = matcher(periodKey);
    const byEvent = {};
    (events || []).forEach(ev => { byEvent[ev.id] = ev; });
    const creditFor = {}, ledgerTitle = {}, ledgerLast = {};
    (ledger || []).forEach(l => {
        if (!l || !l.eventId || (l.type !== 'game' && l.type !== 'refund')) return;
        creditFor[l.eventId] = (creditFor[l.eventId] || 0) - (Number(l.amountCents) || 0);
        if (l.eventTitle) ledgerTitle[l.eventId] = l.eventTitle;
        ledgerLast[l.eventId] = Math.max(ledgerLast[l.eventId] || 0, tsMs(l.at));
    });
    const isPlayed = (ev) => !!(ev && ev.isSessionEnded) || (!!startMsOf(ev) && startMsOf(ev) <= now);
    const dayOf = (ev) => String(ev.date || '').slice(0, 10);
    // Played games (with people) for equipment wear and per-game costs.
    const played = (events || []).filter(ev => isPlayed(ev) && (ev.attendees || []).length && dayOf(ev))
        .map(ev => ({ id: ev.id, day: dayOf(ev), start: String(ev.time || '') }));
    const wear = equipmentWear(equipment, played);
    const wearByGame = {}; let wearOther = 0, wearInPeriod = 0;
    wear.forEach(w => w.charges.forEach(c => {
        if (!inPeriod(c.day)) return;
        wearInPeriod += c.cents;
        if (c.eventId) wearByGame[c.eventId] = (wearByGame[c.eventId] || 0) + c.cents; else wearOther += c.cents;
    }));
    const skip = new Set((settings && settings.skipAuto) || []);
    const auto = autoCostsFor(settings);
    // Supplies used, by game
    const usedByGame = {}; let suppliesUsed = 0;
    (supplyMoves || []).forEach(m => {
        if (!m || m.type !== 'use' || !inPeriod(m.date)) return;
        suppliesUsed += Math.round(num(m.cents));
        if (m.eventId) usedByGame[m.eventId] = (usedByGame[m.eventId] || 0) + Math.round(num(m.cents));
    });
    const exp = (expenses || []).filter(x => x && x.date);
    const expByGame = {};
    exp.forEach(x => { if (x.eventId && inPeriod(x.date)) expByGame[x.eventId] = (expByGame[x.eventId] || 0) + Math.round(num(x.amountCents)); });

    const ids = new Set([...Object.keys(byEvent), ...Object.keys(creditFor)]);
    const games = [];
    let prepaidForUpcoming = 0, perGameTotal = 0;
    ids.forEach(id => {
        const ev = byEvent[id];
        const credit = creditFor[id] || 0;
        const start = ev ? startMsOf(ev) : ledgerLast[id];
        if (ev ? !isPlayed(ev) : !(start && start <= now)) { prepaidForUpcoming += credit; return; }
        const day = ev ? dayOf(ev) : (start ? ymd(new Date(start)) : '');
        if (!inPeriod(day)) return;
        const cash = ev ? cashAtGame(ev) : { cents: 0 };
        const owed = ev ? unpaidList(ev).reduce((s, u) => s + u.cents, 0) : 0;
        const hasPeople = !!(ev && (ev.attendees || []).length);
        const autoOn = hasPeople && !skip.has(id);
        const autoCents = autoOn ? auto.total : 0;
        perGameTotal += autoCents;
        const costs = (expByGame[id] || 0) + (usedByGame[id] || 0) + (wearByGame[id] || 0) + autoCents;
        if (!credit && !cash.cents && !owed && !costs && !hasPeople) return;
        const total = credit + cash.cents;
        games.push({ id, title: (ev && ev.title) || ledgerTitle[id] || 'Game', day, credit, cash: cash.cents, total, owed, deleted: !ev,
            hasPeople, autoOn, auto: autoCents, expenses: expByGame[id] || 0, supplies: usedByGame[id] || 0, wear: wearByGame[id] || 0,
            costs, profit: total - costs });
    });
    games.sort((a, b) => b.day.localeCompare(a.day));
    const expIn = exp.filter(x => matcher(periodKey)(x.date)).sort((a, b) => b.date.localeCompare(a.date));
    const oneOff = expIn.reduce((s, x) => s + Math.round(num(x.amountCents)), 0);
    const byKind = {};
    expIn.forEach(x => { byKind[x.category || 'other'] = (byKind[x.category || 'other'] || 0) + Math.round(num(x.amountCents)); });
    const earliest = [...(fixed || []), ...(ownerFixed || [])].map(f => ym(f.startDate)).filter(Boolean).sort()[0]
        || [...games.map(g => ym(g.day)), ...expIn.map(x => ym(x.date))].filter(Boolean).sort()[0];
    const months = monthsOf(periodKey, new Date(now), earliest);
    const fixedCents = fixedTotal(fixed, months);
    const appCents = ownerFixed ? fixedTotal(ownerFixed, months) : 0;
    const income = games.reduce((s, g) => s + g.total, 0);
    const costs = oneOff + suppliesUsed + wearInPeriod + fixedCents + perGameTotal;
    const held = (credits || []).reduce((s, c) => s + Math.max(0, Number(c.balanceCents) || 0), 0);
    return {
        income, incomeCredit: games.reduce((s, g) => s + g.credit, 0), incomeCash: games.reduce((s, g) => s + g.cash, 0),
        oneOff, suppliesUsed, wear: wearInPeriod, wearOther, fixed: fixedCents, perGame: perGameTotal, costs,
        profit: income - costs, app: appCents, afterApp: income - costs - appCents,
        byKind, unearned: held + prepaidForUpcoming, held, prepaidForUpcoming,
        suppliesOnHand: (supplies || []).reduce((s, x) => s + Math.max(0, Math.round(num(x.valueCents))), 0),
        owed: games.reduce((s, g) => s + g.owed, 0), autoPerGame: auto,
        games, expenseList: expIn, equipment: wear, months
    };
}

// ------------------------------------------------------------------ state
const M = {
    cid: null, name: '', tab: 'overview', period: null, loading: true, error: '',
    ledger: [], credits: [], expenses: [], supplies: [], supplyMoves: [], equipment: [], fixed: [], settings: {},
    owner: false, ownerUid: '', ownerFixed: [], unsubs: []
};

function periods() {
    const d = new Date();
    const out = [];
    for (let i = 0; i < 12; i++) {
        const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
        out.push({ key: `${m.getFullYear()}-${pad(m.getMonth() + 1)}`, label: i === 0 ? 'This month' : m.toLocaleString('en-US', { month: 'long', year: 'numeric' }) });
    }
    out.push({ key: `y${d.getFullYear()}`, label: `This year (${d.getFullYear()})` });
    out.push({ key: 'all', label: 'All time' });
    return out;
}
function report() {
    const events = (window.eventsList || []).filter(e => e.communityId === M.cid);
    return moneyReport({ events, ledger: M.ledger, credits: M.credits, expenses: M.expenses, supplies: M.supplies, supplyMoves: M.supplyMoves,
        equipment: M.equipment, fixed: M.fixed, ownerFixed: M.owner ? M.ownerFixed : null, settings: M.settings, now: Date.now(), periodKey: M.period });
}

async function amOwner() {
    if (window.isFutnetOwner) { try { return !!(await window.isFutnetOwner()); } catch (e) { return false; } }
    return false;
}

// ------------------------------------------------------------------ open / close
window.openMoneyTracker = async function (cid) {
    const c = (window.communitiesCache || {})[cid] || {};
    M.cid = cid; M.name = c.name || 'Community'; M.loading = true; M.error = ''; M.tab = 'overview';
    M.period = M.period || periods()[0].key;
    let m = document.getElementById('money-tracker-modal');
    if (!m) {
        m = document.createElement('div');
        m.id = 'money-tracker-modal';
        m.className = 'fixed inset-0 z-[200] bg-[#03080F] overflow-y-auto';
        document.body.appendChild(m);
    }
    draw();
    M.unsubs.forEach(u => { try { u(); } catch (e) {} });
    M.unsubs = [];
    const live = (path, key, map = (d) => ({ id: d.id, ...d.data() })) => {
        M.unsubs.push(onSnapshot(collection(...path), s => { M[key] = s.docs.map(map); draw(); },
            (e) => { console.warn(key, e); M.error = "Some of the money details couldn't load. Try again."; draw(); }));
    };
    live(comm(cid, 'expenses'), 'expenses');
    live(comm(cid, 'supplies'), 'supplies');
    live(comm(cid, 'supplyMoves'), 'supplyMoves');
    live(comm(cid, 'equipment'), 'equipment');
    live(comm(cid, 'fixedCosts'), 'fixed');
    M.unsubs.push(onSnapshot(doc(...comm(cid, 'books', 'settings')), s => { M.settings = (s.exists && s.exists()) ? s.data() : {}; draw(); }, () => {}));
    M.owner = await amOwner();
    M.ownerUid = String(window.currentUser?.uid || '');
    if (M.owner && M.ownerUid) live(ownerBook(M.ownerUid, 'fixedCosts'), 'ownerFixed');
    try {
        const [l, cr] = await Promise.all([getDocs(collection(...comm(cid, 'creditLedger'))), getDocs(collection(...comm(cid, 'credits')))]);
        M.ledger = l.docs.map(d => d.data());
        M.credits = cr.docs.map(d => d.data());
    } catch (e) { console.warn('money tracker', e); M.error = "Couldn't load the credit history."; }
    M.loading = false;
    draw();
};
window.closeMoneyTracker = function () {
    M.unsubs.forEach(u => { try { u(); } catch (e) {} });
    M.unsubs = [];
    document.getElementById('money-tracker-modal')?.remove();
};
window.setMoneyPeriod = function (key) { M.period = key; draw(); };
window.setMoneyTab = function (t) { M.tab = t; draw(); document.getElementById('money-tracker-modal')?.scrollTo(0, 0); };

// ------------------------------------------------------------------ drawing
const IN = 'w-full bg-black/60 border border-teal-500/50 rounded-xl px-3 py-2.5 text-white text-base sm:text-sm focus:outline-none focus:border-[#00F296]';
const H = (t, extra = '') => `<div class="flex items-center justify-between pt-1"><div class="text-[10px] font-black uppercase tracking-wider text-[#00F296]">${t}</div>${extra}</div>`;
const addBtn = (label, onclick) => `<button onclick="${onclick}" class="bg-[#00F296] text-slate-950 font-black text-xs px-3 py-2 rounded-xl"><i class="fa-solid fa-plus mr-1"></i> ${label}</button>`;
const row = (l, v, cls = '') => `<div class="flex justify-between gap-3 ${cls}"><span class="text-white/70">${l}</span><b>${v}</b></div>`;
const trash = (fn) => `<button onclick="${fn}" class="w-7 h-7 shrink-0 rounded-full bg-red-500/10 border border-red-500/30 text-red-300 text-[10px]" title="Delete"><i class="fa-solid fa-trash-can"></i></button>`;

function draw() {
    const m = document.getElementById('money-tracker-modal');
    if (!m) return;
    const keep = m.scrollTop;
    const r = report();
    const tabs = [['overview', '📊 Overview'], ['expenses', '🧾 Expenses'], ['supplies', '📦 Supplies'], ['equipment', '🧰 Equipment'], ['setup', '⚙️ Costs setup']];
    if (M.owner) tabs.push(['app', '🔒 FutNet app']);
    const body = { overview: overviewHtml, expenses: expensesHtml, supplies: suppliesHtml, equipment: equipmentHtml, setup: setupHtml, app: appHtml }[M.tab] || overviewHtml;
    m.innerHTML = `
    <div class="max-w-2xl mx-auto px-4 pt-4 pb-24 text-white space-y-4">
        <div class="flex items-center gap-3">
            <button onclick="closeMoneyTracker()" class="w-9 h-9 rounded-full bg-black/60 border border-white/15 flex items-center justify-center"><i class="fa-solid fa-arrow-left"></i></button>
            <div class="flex-1 min-w-0"><div class="text-[10px] font-black uppercase tracking-wider text-[#00F296]">💰 Money tracker</div>
                <div class="text-sm font-black truncate">${esc(M.name)}</div></div>
            <button onclick="downloadMoneyCsv()" class="text-[11px] font-black bg-black/60 border border-white/15 rounded-xl px-3 py-2"><i class="fa-solid fa-download mr-1"></i> CSV</button>
        </div>
        <div class="flex gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1 pb-1">${tabs.map(([k, l]) => `
            <button onclick="setMoneyTab('${k}')" class="shrink-0 px-3 py-2 rounded-xl text-[11px] font-black ${M.tab === k ? 'bg-[#00F296] text-slate-950' : 'bg-black/50 border border-white/15 text-white/80'}">${l}</button>`).join('')}</div>
        ${['overview', 'expenses', 'app'].includes(M.tab) ? `<select onchange="setMoneyPeriod(this.value)" class="${IN} font-bold">
            ${periods().map(p => `<option value="${p.key}" ${p.key === M.period ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select>` : ''}
        ${M.error ? `<div class="text-xs text-red-300 bg-red-500/10 border border-red-500/40 rounded-xl p-3">${esc(M.error)}</div>` : ''}
        ${M.loading ? '<div class="text-xs text-white/50 text-center py-2"><i class="fa-solid fa-spinner fa-spin mr-1"></i> Loading…</div>' : ''}
        ${body(r)}
        <p class="text-[10px] text-white/35 text-center pt-2">Only admins see this page. Members never see money numbers.</p>
    </div>`;
    m.scrollTop = keep;
}

function bigCards(r) {
    const card = (label, value, color, sub = '') => `<div class="bg-black/40 border border-white/10 rounded-2xl p-3 text-center">
        <div class="text-[10px] font-black uppercase tracking-wider text-white/50">${label}</div>
        <div class="text-lg sm:text-xl font-black mt-1" style="color:${color}">${value}</div>${sub ? `<div class="text-[10px] text-white/45 mt-0.5">${sub}</div>` : ''}</div>`;
    return `<div class="grid grid-cols-3 gap-2">
        ${card('Income', money(r.income), '#00F296', 'games played')}
        ${card('Costs', money(r.costs), '#FF8080')}
        ${card(r.profit >= 0 ? 'Profit' : 'Loss', money(r.profit), r.profit >= 0 ? '#00F296' : '#FF8080')}
    </div>`;
}

function overviewHtml(r) {
    return `${bigCards(r)}
    <div class="bg-black/40 border border-white/10 rounded-2xl p-3 space-y-1 text-xs">
        <div class="text-[10px] font-black uppercase tracking-wider text-[#00F296] mb-1">Income</div>
        ${row('Game fees paid with credit', money(r.incomeCredit))}
        ${row('Cash / other marked Paid at games', money(r.incomeCash))}
        ${r.owed ? row('Still owed by players (not counted yet)', money(r.owed), 'text-amber-300') : ''}
        <div class="text-[10px] font-black uppercase tracking-wider text-[#FF8080] mt-2 mb-1">Costs</div>
        ${row('Expenses (one-off)', money(r.oneOff))}
        ${row('Supplies used', money(r.suppliesUsed))}
        ${row('Equipment wear', money(r.wear))}
        ${row('Per-game costs (gas, washing)', money(r.perGame))}
        ${row('Fixed costs', money(r.fixed))}
    </div>
    <div class="bg-sky-500/10 border border-sky-400/40 rounded-2xl p-3">
        <div class="flex items-center justify-between"><span class="text-[10px] font-black uppercase tracking-wider text-sky-300">Unearned (prepaid credit)</span><span class="text-base font-black text-sky-200">${money(r.unearned)}</span></div>
        <p class="text-[10px] text-white/55 mt-1">Money players paid ahead that isn't income yet. It becomes income when the games are played. Right now: ${money(r.held)} in members' credit${r.prepaidForUpcoming ? ` + ${money(r.prepaidForUpcoming)} already taken for upcoming games` : ''}.</p>
    </div>
    ${r.suppliesOnHand ? `<div class="text-[11px] text-white/60 text-center">📦 Supplies on hand are worth ${money(r.suppliesOnHand)} (not a cost until used).</div>` : ''}
    ${H(`Games (${r.games.length})`)}
    <div class="space-y-2">${r.games.map(g => `
        <div class="bg-black/40 border border-white/10 rounded-xl p-2.5">
            <div class="flex items-center gap-2"><div class="flex-1 min-w-0"><div class="text-xs font-bold truncate">${esc(g.title)}${g.deleted ? ' <span class="text-white/40">(deleted)</span>' : ''}</div>
                <div class="text-[10px] text-white/50">${esc(g.day)} · income ${money(g.total)}${g.owed ? ` · <span class="text-amber-300">owed ${money(g.owed)}</span>` : ''}${g.costs ? ` · costs ${money(g.costs)}` : ''}</div></div>
                <b class="text-sm shrink-0 ${g.profit >= 0 ? 'text-[#00F296]' : 'text-[#FF8080]'}">${money(g.profit)}</b></div>
            ${g.costs ? `<div class="text-[10px] text-white/45 mt-1">${[g.expenses && `expenses ${money(g.expenses)}`, g.supplies && `supplies ${money(g.supplies)}`, g.wear && `equipment ${money(g.wear)}`, g.auto && `gas/washing ${money(g.auto)}`].filter(Boolean).join(' · ')}</div>` : ''}
            ${g.hasPeople && r.autoPerGame.total ? `<button onclick="toggleAutoCosts('${jsArg(g.id)}')" class="text-[10px] font-bold mt-1 ${g.autoOn ? 'text-white/50' : 'text-amber-300'} underline">${g.autoOn ? "I didn't go to this one (remove gas/washing)" : 'Gas/washing removed for this game. Add back'}</button>` : ''}
        </div>`).join('') || '<p class="text-xs text-white/45 italic">No games played in this period.</p>'}</div>`;
}

function expensesHtml(r) {
    const kinds = Object.entries(r.byKind).sort((a, b) => b[1] - a[1]);
    return `${H(`One-off expenses (${r.expenseList.length})`, addBtn('Add expense', 'openExpenseForm()'))}
    <p class="text-[10px] text-white/50">Field rental, a referee, anything you pay once. Things you stock up on go in 📦 Supplies; things that last go in 🧰 Equipment.</p>
    ${kinds.length ? `<div class="flex flex-wrap gap-1.5">${kinds.map(([k, v]) => `<span class="text-[10px] font-bold bg-black/50 border border-white/10 rounded-full px-2.5 py-1">${kindLabel(k)} <b class="text-[#FF8080]">${money(v)}</b></span>`).join('')}</div>` : ''}
    <div class="space-y-2">${r.expenseList.map(x => `
        <div class="flex items-center gap-3 bg-black/40 border border-white/10 rounded-xl p-2.5">
            <div class="flex-1 min-w-0"><div class="text-xs font-bold truncate">${kindLabel(x.category)}${x.note ? ` · ${esc(x.note)}` : ''}</div>
                <div class="text-[10px] text-white/50">${esc(x.date)}${x.eventTitle ? ` · ${esc(x.eventTitle)}` : ''}${x.byName ? ` · by ${esc(x.byName)}` : ''}
                ${x.receiptUrl ? ` · <a href="${esc(x.receiptUrl)}" target="_blank" rel="noopener" class="text-[#00F296] underline">receipt</a>` : ''}</div></div>
            <b class="text-sm text-[#FF8080] shrink-0">-${money(x.amountCents)}</b>
            ${trash(`deleteExpense('${jsArg(x.id)}')`)}
        </div>`).join('') || '<p class="text-xs text-white/45 italic">No expenses in this period.</p>'}</div>`;
}

function suppliesHtml() {
    const list = [...M.supplies].sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const moves = [...M.supplyMoves].sort((a, b) => String(b.date).localeCompare(String(a.date)) || tsMs(b.createdAt) - tsMs(a.createdAt)).slice(0, 25);
    return `${H(`Supplies (${list.length})`, addBtn('New item', 'openSupplyItem()'))}
    <p class="text-[10px] text-white/50">Things you use up: water, ice, tape… <b>Buy</b> fills your stock (not a cost yet). <b>Use</b> takes some out for a game, and that's when it counts as a cost.</p>
    <div class="space-y-2">${list.map(s => {
        const low = num(s.lowAt) > 0 && num(s.qty) <= num(s.lowAt);
        const each = num(s.qty) > 0 ? Math.round(num(s.valueCents) / num(s.qty)) : 0;
        return `<div class="bg-black/40 border ${low ? 'border-amber-400/60' : 'border-white/10'} rounded-xl p-2.5 space-y-2">
            <div class="flex items-center gap-2"><div class="flex-1 min-w-0"><div class="text-sm font-black truncate">${esc(s.name)}</div>
                <div class="text-[10px] ${low ? 'text-amber-300 font-bold' : 'text-white/50'}">${low ? '⚠️ Running low · ' : ''}${+num(s.qty).toFixed(2)} ${esc(s.unit || 'units')} left · worth ${money(s.valueCents)}${each ? ` (${money(each)} each)` : ''}</div></div>
                ${trash(`deleteSupply('${jsArg(s.id)}')`)}</div>
            <div class="grid grid-cols-2 gap-2">
                <button onclick="openSupplyMove('${jsArg(s.id)}','buy')" class="bg-black/60 border border-[#00F296]/50 text-[#00F296] font-black text-xs py-2 rounded-xl">+ Buy</button>
                <button onclick="openSupplyMove('${jsArg(s.id)}','use')" class="bg-black/60 border border-white/20 text-white font-black text-xs py-2 rounded-xl" ${num(s.qty) > 0 ? '' : 'disabled style="opacity:.4"'}>− Use</button>
            </div></div>`;
    }).join('') || '<p class="text-xs text-white/45 italic">No supplies yet. Tap New item (e.g. "Water", unit "case").</p>'}</div>
    ${moves.length ? `${H('Recent')}<div class="space-y-1">${moves.map(mv => `
        <div class="flex items-center gap-2 text-[11px] bg-black/30 rounded-lg px-2.5 py-1.5">
            <span class="${mv.type === 'buy' ? 'text-[#00F296]' : 'text-[#FF8080]'} font-black w-10">${mv.type === 'buy' ? 'Buy' : 'Use'}</span>
            <span class="flex-1 min-w-0 truncate">${+num(mv.qty).toFixed(2)} ${esc(mv.unit || '')} ${esc(mv.name || '')}${mv.eventTitle ? ` · ${esc(mv.eventTitle)}` : ''}</span>
            <span class="text-white/45">${esc(mv.date)}</span><b class="w-16 text-right">${money(mv.cents)}</b></div>`).join('')}</div>` : ''}`;
}

function equipmentHtml(r) {
    return `${H(`Equipment (${r.equipment.length})`, addBtn('Add equipment', 'openEquipmentForm()'))}
    <p class="text-[10px] text-white/50">Things that last many games: balls, pinnies, goals, cones. Each one wears out by games played: cost ÷ how many games you expect it to last, counted on every game after you bought it.</p>
    <div class="space-y-2">${r.equipment.map(w => {
        const e = M.equipment.find(x => x.id === w.id) || {};
        const pct = Math.min(100, Math.round(w.used / w.life * 100));
        return `<div class="bg-black/40 border border-white/10 rounded-xl p-2.5 space-y-1.5">
            <div class="flex items-center gap-2"><div class="flex-1 min-w-0"><div class="text-sm font-black truncate">${esc(w.name)}${w.retired ? ' <span class="text-[10px] text-white/40">(retired)</span>' : ''}</div>
                <div class="text-[10px] text-white/50">Cost ${money(e.costCents)} · bought ${esc(e.boughtDate || '')} · ${money(w.perGame)} a game</div></div>
                ${!w.retired && w.leftCents > 0 ? `<button onclick="retireEquipment('${jsArg(w.id)}')" class="text-[10px] font-black text-amber-300 bg-amber-400/10 border border-amber-400/40 rounded-full px-2 py-1">Lost / broke</button>` : ''}
                ${trash(`deleteEquipment('${jsArg(w.id)}')`)}</div>
            <div class="h-2 bg-white/10 rounded-full overflow-hidden"><div class="h-full ${pct >= 100 ? 'bg-white/40' : 'bg-[#00F296]'}" style="width:${pct}%"></div></div>
            <div class="text-[10px] text-white/60">${w.used} of ${w.life} games used · ${w.leftCents > 0 ? `value left ${money(w.leftCents)}` : 'fully used up'}</div>
        </div>`;
    }).join('') || '<p class="text-xs text-white/45 italic">No equipment yet.</p>'}</div>`;
}

function fixedListHtml(list, kind) {
    return `<div class="space-y-2">${list.map(f => `
        <div class="flex items-center gap-3 bg-black/40 border border-white/10 rounded-xl p-2.5">
            <div class="flex-1 min-w-0"><div class="text-xs font-bold truncate">${esc(f.name)}${f.endDate ? ' <span class="text-white/40">(ended)</span>' : ''}</div>
                <div class="text-[10px] text-white/50">${money(f.amountCents)} ${f.every === 'year' ? `a year (${money(Math.round(num(f.amountCents) / 12))} a month)` : f.every === 'once' ? 'one time' : 'a month'} · since ${esc(f.startDate || '')}${f.endDate ? ` · until ${esc(f.endDate)}` : ''}</div></div>
            ${!f.endDate && f.every !== 'once' ? `<button onclick="endFixedCost('${kind}','${jsArg(f.id)}')" class="text-[10px] font-black text-amber-300 bg-amber-400/10 border border-amber-400/40 rounded-full px-2 py-1">Stop</button>` : ''}
            ${trash(`deleteFixedCost('${kind}','${jsArg(f.id)}')`)}
        </div>`).join('') || '<p class="text-xs text-white/45 italic">None yet.</p>'}</div>`;
}

function setupHtml(r) {
    const s = M.settings || {};
    const d = { ...DEFAULTS.drive, ...(s.drive || {}) }, w = { ...DEFAULTS.wash, ...(s.wash || {}) };
    const sw = (key, on) => `<button onclick="toggleCostPart('${key}')" class="w-11 h-6 rounded-full relative shrink-0 ${on ? 'bg-[#00F296]' : 'bg-white/20'}"><span class="absolute top-0.5 ${on ? 'left-5' : 'left-0.5'} w-5 h-5 rounded-full bg-white transition-all"></span></button>`;
    const field = (id, label, value, step = '0.01', suffix = '') => `<label class="block"><span class="text-[10px] font-black uppercase text-white/55">${label}</span>
        <div class="flex items-center gap-1.5 mt-1"><input id="${id}" type="number" inputmode="decimal" step="${step}" min="0" value="${esc(String(value))}" class="${IN}">${suffix ? `<span class="text-[11px] text-white/50 shrink-0">${suffix}</span>` : ''}</div></label>`;
    return `${H('Per-game costs')}
    <p class="text-[10px] text-white/50">Set these once. They're added to every game that was played, and you can remove them from a game you didn't go to.</p>
    <div class="bg-black/40 border border-white/10 rounded-2xl p-3 space-y-3">
        <div class="flex items-center gap-3"><div class="flex-1"><div class="text-sm font-black">🚗 Do you drive to the games?</div>
            <div class="text-[10px] text-white/50">${d.on ? `Counting ${money(driveCents(d))} a game` : 'Off'}</div></div>${sw('drive', d.on)}</div>
        ${d.on ? `
        ${field('cs-miles', 'Miles there and back (round trip)', d.miles, '1', 'miles')}
        <div><span class="text-[10px] font-black uppercase text-white/55">How should the driving count?</span>
            <div class="grid grid-cols-1 gap-1.5 mt-1">
                <button onclick="setDriveMethod('gas')" class="text-left rounded-xl p-2.5 border ${d.method !== 'irs' ? 'bg-[#00F296]/15 border-[#00F296]' : 'bg-black/50 border-white/15'}">
                    <div class="text-xs font-black">⛽ Real gas cost</div><div class="text-[10px] text-white/55">Miles ÷ miles per gallon × gas price. What you really spend.</div></button>
                <button onclick="setDriveMethod('irs')" class="text-left rounded-xl p-2.5 border ${d.method === 'irs' ? 'bg-[#00F296]/15 border-[#00F296]' : 'bg-black/50 border-white/15'}">
                    <div class="text-xs font-black">🧾 IRS mileage rate</div><div class="text-[10px] text-white/55">A set amount per mile that also covers car wear and insurance. The number for taxes (2026: 72.5¢ a mile).</div></button>
            </div></div>
        ${d.method === 'irs' ? field('cs-irs', 'Rate per mile ($)', d.irsRate, '0.005', '$ / mile')
            : `<div class="grid grid-cols-2 gap-2">${field('cs-mpg', 'Miles per gallon', d.mpg, '1', 'mpg')}${field('cs-gas', 'Gas price', d.gasPrice, '0.01', '$ / gal')}</div>`}` : ''}
    </div>
    <div class="bg-black/40 border border-white/10 rounded-2xl p-3 space-y-3">
        <div class="flex items-center gap-3"><div class="flex-1"><div class="text-sm font-black">🧺 Do you wash pinnies?</div>
            <div class="text-[10px] text-white/50">${w.on ? `${money(washLoadCents(w))} a load × ${num(w.loads, 1)} = ${money(Math.round(washLoadCents(w) * num(w.loads, 1)))} a game` : 'Off'}</div></div>${sw('wash', w.on)}</div>
        ${w.on ? `
        ${field('cs-loads', 'Loads per game', w.loads, '1', 'loads')}
        <div class="grid grid-cols-2 gap-2">${field('cs-det', 'Detergent bottle', w.detergentPrice, '0.01', '$')}${field('cs-det-loads', 'Loads per bottle', w.loadsPerBottle, '1', 'loads')}</div>
        <div class="grid grid-cols-2 gap-2">${field('cs-kwh', 'Washer + dryer energy', w.kwhPerLoad, '0.1', 'kWh')}${field('cs-kwh-price', 'Electricity price', w.kwhPrice, '0.001', '$ / kWh')}</div>
        ${field('cs-water', 'Water per load', w.waterPerLoad, '0.01', '$')}
        <div class="text-[10px] text-white/50">One load = detergent ${money(Math.round(num(w.detergentPrice) / Math.max(1, num(w.loadsPerBottle)) * 100))} + electricity ${money(Math.round(num(w.kwhPerLoad) * num(w.kwhPrice) * 100))} + water ${money(Math.round(num(w.waterPerLoad) * 100))}. Your electric bill shows your real price per kWh.</div>` : ''}
    </div>
    ${(d.on || w.on) ? `<button onclick="saveCostSetup()" class="w-full bg-[#00F296] text-slate-950 font-black py-3 rounded-xl text-sm">Save per-game costs</button>` : ''}
    ${H('Fixed costs', addBtn('Add', "openFixedForm('comm')"))}
    <p class="text-[10px] text-white/50">The same cost every month or year for this community (storage, league insurance…). A yearly cost is spread over 12 months.</p>
    ${fixedListHtml(M.fixed, 'comm')}`;
}

function appHtml(r) {
    return `<div class="bg-amber-400/10 border border-amber-400/40 rounded-2xl p-3 text-[11px] text-amber-100">🔒 Only you see this. These are FutNet's own costs (Apple, Google, hosting, tools), kept out of the community's books.</div>
    <div class="bg-black/40 border border-white/10 rounded-2xl p-3 space-y-1 text-xs">
        ${row('Community profit this period', money(r.profit))}
        ${row('FutNet app costs this period', '-' + money(r.app), 'text-[#FF8080]')}
        <div class="border-t border-white/10 pt-1 mt-1">${row('After app costs', money(r.afterApp), r.afterApp >= 0 ? 'text-[#00F296]' : 'text-[#FF8080]')}</div>
    </div>
    ${H('FutNet app costs', addBtn('Add', "openFixedForm('owner')"))}
    <p class="text-[10px] text-white/50">E.g. Apple developer $99 a year, Google Play $25 one time, Claude $20 a month, Firebase and the domain from your bills.</p>
    ${fixedListHtml(M.ownerFixed, 'owner')}`;
}

// ------------------------------------------------------------------ small popups
function popup(id, title, inner) {
    document.getElementById(id)?.remove();
    const f = document.createElement('div');
    f.id = id;
    f.className = 'fixed inset-0 z-[230] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm';
    f.innerHTML = `<div class="bg-[#040E13] border border-emerald-500/40 rounded-3xl max-w-sm w-full p-5 space-y-3 text-white max-h-[92vh] overflow-y-auto" onclick="event.stopPropagation()">
        <div class="flex items-center justify-between"><h4 class="text-sm font-black">${title}</h4>
            <button onclick="document.getElementById('${id}').remove()" class="text-white/50 text-lg"><i class="fa-solid fa-xmark"></i></button></div>${inner}</div>`;
    f.onclick = () => f.remove();
    document.body.appendChild(f);
    return f;
}
const lbl = (t, html) => `<label class="block"><span class="text-[10px] font-black uppercase text-white/60">${t}</span><div class="mt-1">${html}</div></label>`;
const val = (id) => document.getElementById(id)?.value ?? '';
function gameOptions(withDates = true) {
    return (window.eventsList || []).filter(e => e.communityId === M.cid)
        .sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).slice(0, 30)
        .map(g => `<option value="${esc(g.id)}" data-date="${esc(String(g.date || '').slice(0, 10))}">${withDates ? esc(String(g.date || '').slice(0, 10)) + ' · ' : ''}${esc(g.title || 'Game')}</option>`).join('');
}
function linkGameToDate(f, selId, dateId) {
    f.querySelector('#' + selId)?.addEventListener('change', (e) => {
        const d = e.target.selectedOptions[0]?.dataset.date;
        if (d) f.querySelector('#' + dateId).value = d;
    });
}
async function saving(btnId, label, fn) {
    const b = document.getElementById(btnId); if (b) { b.disabled = true; b.textContent = 'Saving…'; }
    try { await fn(); return true; }
    catch (e) { console.error(e); toast(e && e.message && e.message.length < 80 ? e.message : "Couldn't save. Try again.", 'error'); if (b) { b.disabled = false; b.textContent = label; } return false; }
}

// ---- one-off expenses
window.openExpenseForm = function () {
    const f = popup('expense-form-modal', 'Add expense', `
        ${lbl('Amount ($)', `<input id="exp-amount" type="number" inputmode="decimal" min="0.01" step="0.01" placeholder="120" class="${IN}">`)}
        <div><span class="text-[10px] font-black uppercase text-white/60">What for?</span>
            <div class="grid grid-cols-2 gap-1.5 mt-1" id="exp-kinds">${EXPENSE_KINDS.map(([k, l], i) => `
                <button type="button" data-k="${k}" onclick="pickExpenseKind(this)" class="py-2 rounded-lg text-[11px] font-black ${i === 0 ? 'bg-[#00F296] text-slate-950' : 'bg-black/50 border border-white/15 text-white/80'}" ${i === 0 ? 'data-on="1"' : ''}>${l}</button>`).join('')}</div></div>
        ${lbl('Date', `<input id="exp-date" type="date" value="${ymd(new Date())}" class="${IN}">`)}
        ${lbl('For a game? (optional)', `<select id="exp-game" class="${IN}"><option value="">Not for one game</option>${gameOptions()}</select>`)}
        ${lbl('Note (optional)', `<input id="exp-note" type="text" maxlength="120" placeholder="e.g. Field rental 7-9pm" class="${IN}">`)}
        ${lbl('Receipt photo (optional)', `<input id="exp-receipt" type="file" accept="image/*" class="block w-full text-xs text-white/70 file:mr-2 file:rounded-lg file:border-0 file:bg-black/60 file:text-white file:px-3 file:py-2">`)}
        <button id="exp-save" onclick="saveExpense()" class="w-full bg-[#00F296] text-slate-950 font-black py-3 rounded-xl text-sm">Save expense</button>`);
    linkGameToDate(f, 'exp-game', 'exp-date');
};
window.pickExpenseKind = function (btn) {
    btn.parentNode.querySelectorAll('button').forEach(b => {
        b.dataset.on = b === btn ? '1' : '';
        b.className = `py-2 rounded-lg text-[11px] font-black ${b === btn ? 'bg-[#00F296] text-slate-950' : 'bg-black/50 border border-white/15 text-white/80'}`;
    });
};
window.saveExpense = async function () {
    const me = window.currentUser; if (!me || !M.cid) return;
    const amt = num(val('exp-amount'));
    if (!(amt > 0)) { toast('Enter the amount.', 'error'); return; }
    const date = val('exp-date') || ymd(new Date());
    const category = document.querySelector('#exp-kinds [data-on="1"]')?.dataset.k || 'other';
    const eventId = val('exp-game');
    const eventTitle = eventId ? ((window.eventsList || []).find(e => e.id === eventId)?.title || '') : '';
    const note = val('exp-note').trim().slice(0, 120);
    const file = document.getElementById('exp-receipt')?.files?.[0];
    const ok = await saving('exp-save', 'Save expense', async () => {
        let receiptUrl = '';
        if (file) {
            showUploadProgress('Uploading receipt…', 0);
            try { receiptUrl = (await uploadMedia(file, `community/${M.cid}`, (p) => showUploadProgress('Uploading receipt…', p))).url || ''; }
            catch (e) { throw new Error(mediaErrorText(e)); }
            finally { hideUploadProgress(); }
        }
        const id = newId('exp');
        await setDoc(doc(...comm(M.cid, 'expenses', id)), {
            id, amountCents: Math.round(amt * 100), category, note, date,
            ...(eventId ? { eventId, eventTitle } : {}), ...(receiptUrl ? { receiptUrl } : {}),
            by: String(me.uid), byName: myName(), createdAt: serverTimestamp()
        });
    });
    if (!ok) return;
    document.getElementById('expense-form-modal')?.remove();
    if (!matcher(M.period)(date)) M.period = date.slice(0, 7);
    draw();
    toast(`Expense saved: ${money(Math.round(amt * 100))}`);
};
window.deleteExpense = async function (id) {
    const x = M.expenses.find(e => e.id === id); if (!x) return;
    if (!confirm(`Delete this expense (${money(x.amountCents)})?`)) return;
    try { await deleteDoc(doc(...comm(M.cid, 'expenses', id))); toast('Expense deleted.'); }
    catch (e) { console.error(e); toast("Couldn't delete it. Try again.", 'error'); }
};

// ---- supplies
window.openSupplyItem = function () {
    popup('supply-item-modal', 'New supply item', `
        ${lbl('Name', `<input id="sup-name" type="text" maxlength="40" placeholder="Water" class="${IN}">`)}
        ${lbl('Counted in', `<input id="sup-unit" type="text" maxlength="20" placeholder="cases" value="cases" class="${IN}">`)}
        ${lbl('Warn me when this many are left (optional)', `<input id="sup-low" type="number" min="0" step="1" placeholder="2" class="${IN}">`)}
        <p class="text-[10px] text-white/50">Next, tap <b>+ Buy</b> on it to add what you have.</p>
        <button id="sup-save" onclick="saveSupplyItem()" class="w-full bg-[#00F296] text-slate-950 font-black py-3 rounded-xl text-sm">Create</button>`);
};
window.saveSupplyItem = async function () {
    const name = val('sup-name').trim().slice(0, 40);
    if (!name) { toast('Give it a name.', 'error'); return; }
    const id = newId('sup');
    const ok = await saving('sup-save', 'Create', () => setDoc(doc(...comm(M.cid, 'supplies', id)), {
        id, name, unit: val('sup-unit').trim().slice(0, 20) || 'units', qty: 0, valueCents: 0, lowAt: Math.max(0, num(val('sup-low'))), createdAt: serverTimestamp()
    }));
    if (ok) { document.getElementById('supply-item-modal')?.remove(); toast(`${name} added. Tap + Buy to fill it.`); }
};
window.openSupplyMove = function (id, type) {
    const s = M.supplies.find(x => x.id === id); if (!s) return;
    const buy = type === 'buy';
    const f = popup('supply-move-modal', `${buy ? 'Buy' : 'Use'} ${esc(s.name)}`, `
        ${lbl(`How many ${esc(s.unit || '')}?`, `<input id="mv-qty" type="number" inputmode="decimal" min="0" step="1" value="1" class="${IN}">`)}
        ${buy ? lbl('Total paid ($)', `<input id="mv-paid" type="number" inputmode="decimal" min="0" step="0.01" placeholder="50" class="${IN}">`)
            : `<p class="text-[10px] text-white/55">You have ${+num(s.qty).toFixed(2)} ${esc(s.unit || '')}. Each one cost about ${money(num(s.qty) > 0 ? Math.round(num(s.valueCents) / num(s.qty)) : 0)}.</p>
            ${lbl('Used for which game?', `<select id="mv-game" class="${IN}"><option value="">Not for one game</option>${gameOptions()}</select>`)}`}
        ${lbl('Date', `<input id="mv-date" type="date" value="${ymd(new Date())}" class="${IN}">`)}
        <button id="mv-save" onclick="saveSupplyMove('${jsArg(id)}','${type}')" class="w-full bg-[#00F296] text-slate-950 font-black py-3 rounded-xl text-sm">${buy ? 'Add to stock' : 'Take out of stock'}</button>`);
    if (!buy) {
        // Most recent game that already started, so "used one for Thursday" is one tap.
        const now = Date.now();
        const opt = [...f.querySelectorAll('#mv-game option')].find(o => o.value && (startMsOf((window.eventsList || []).find(e => e.id === o.value) || {}) || 0) <= now);
        if (opt) { f.querySelector('#mv-game').value = opt.value; f.querySelector('#mv-date').value = opt.dataset.date || ymd(new Date()); }
        linkGameToDate(f, 'mv-game', 'mv-date');
    }
};
window.saveSupplyMove = async function (id, type) {
    const me = window.currentUser; if (!me) return;
    const qty = num(val('mv-qty'));
    const paid = Math.round(num(val('mv-paid')) * 100);
    if (type === 'buy' && !(paid >= 0)) { toast('Enter what you paid.', 'error'); return; }
    const eventId = type === 'use' ? val('mv-game') : '';
    const eventTitle = eventId ? ((window.eventsList || []).find(e => e.id === eventId)?.title || '') : '';
    const date = val('mv-date') || ymd(new Date());
    const ref = doc(...comm(M.cid, 'supplies', id));
    const moveId = newId('mv');
    let result = null;
    const ok = await saving('mv-save', type === 'buy' ? 'Add to stock' : 'Take out of stock', () => runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error('That item was deleted.');
        const s = snap.data();
        result = applySupplyMove(s, type, qty, paid);
        tx.update(ref, { qty: result.qty, valueCents: result.valueCents });
        tx.set(doc(...comm(M.cid, 'supplyMoves', moveId)), {
            id: moveId, supplyId: id, name: s.name || '', unit: s.unit || '', type, qty, cents: result.cents, date,
            ...(eventId ? { eventId, eventTitle } : {}), by: String(me.uid), byName: myName(), createdAt: serverTimestamp()
        });
    }));
    if (!ok) return;
    document.getElementById('supply-move-modal')?.remove();
    const s = M.supplies.find(x => x.id === id) || {};
    toast(type === 'buy' ? `Added ${qty} ${s.unit || ''}. You have ${result.qty} now.` : `Used ${qty} ${s.unit || ''} (${money(result.cents)}). ${result.qty} left.`);
};
window.deleteSupply = async function (id) {
    const s = M.supplies.find(x => x.id === id); if (!s) return;
    if (!confirm(`Delete ${s.name}? Its history stays in the books.`)) return;
    try { await deleteDoc(doc(...comm(M.cid, 'supplies', id))); } catch (e) { toast("Couldn't delete it. Try again.", 'error'); }
};

// ---- equipment
window.openEquipmentForm = function () {
    popup('equip-modal', 'Add equipment', `
        ${lbl('What is it?', `<input id="eq-name" type="text" maxlength="40" placeholder="10 match balls" class="${IN}">`)}
        ${lbl('Total cost ($)', `<input id="eq-cost" type="number" inputmode="decimal" min="0" step="0.01" placeholder="250" class="${IN}">`)}
        ${lbl('How many games will it last?', `<input id="eq-life" type="number" inputmode="numeric" min="1" step="1" placeholder="50" class="${IN}">`)}
        <p class="text-[10px] text-white/50">A guess is fine: about 1 game a week for a year = 50 games. Balls ~50, pinnies ~100, portable goals ~150.</p>
        ${lbl('Bought on', `<input id="eq-date" type="date" value="${ymd(new Date())}" class="${IN}">`)}
        <button id="eq-save" onclick="saveEquipment()" class="w-full bg-[#00F296] text-slate-950 font-black py-3 rounded-xl text-sm">Save</button>`);
};
window.saveEquipment = async function () {
    const name = val('eq-name').trim().slice(0, 40), cost = num(val('eq-cost')), life = Math.round(num(val('eq-life')));
    if (!name) { toast('Give it a name.', 'error'); return; }
    if (!(cost > 0)) { toast('Enter what it cost.', 'error'); return; }
    if (!(life >= 1)) { toast('Enter how many games it should last.', 'error'); return; }
    const id = newId('eq');
    const ok = await saving('eq-save', 'Save', () => setDoc(doc(...comm(M.cid, 'equipment', id)), {
        id, name, costCents: Math.round(cost * 100), lifeGames: life, boughtDate: val('eq-date') || ymd(new Date()), createdAt: serverTimestamp()
    }));
    if (ok) { document.getElementById('equip-modal')?.remove(); toast(`${name}: ${money(Math.floor(cost * 100 / life))} a game.`); }
};
window.retireEquipment = async function (id) {
    const e = M.equipment.find(x => x.id === id); if (!e) return;
    if (!confirm(`${e.name} got lost or broke? Whatever value it had left counts as a cost today.`)) return;
    try { await updateDoc(doc(...comm(M.cid, 'equipment', id)), { retiredDate: ymd(new Date()) }); toast('Marked as lost / broken.'); }
    catch (err) { toast("Couldn't save. Try again.", 'error'); }
};
window.deleteEquipment = async function (id) {
    const e = M.equipment.find(x => x.id === id); if (!e) return;
    if (!confirm(`Delete ${e.name}? Its wear is taken out of the books too (use "Lost / broke" to keep it).`)) return;
    try { await deleteDoc(doc(...comm(M.cid, 'equipment', id))); } catch (err) { toast("Couldn't delete it. Try again.", 'error'); }
};

// ---- fixed costs (community or the owner's private FutNet app book)
const fixedRef = (kind, id) => kind === 'owner' ? doc(...ownerBook(M.ownerUid, 'fixedCosts', id)) : doc(...comm(M.cid, 'fixedCosts', id));
window.openFixedForm = function (kind) {
    popup('fixed-modal', kind === 'owner' ? '🔒 FutNet app cost' : 'Fixed cost', `
        ${lbl('What is it?', `<input id="fx-name" type="text" maxlength="40" placeholder="${kind === 'owner' ? 'Apple developer' : 'Storage unit'}" class="${IN}">`)}
        ${lbl('Amount ($)', `<input id="fx-amt" type="number" inputmode="decimal" min="0" step="0.01" placeholder="${kind === 'owner' ? '99' : '30'}" class="${IN}">`)}
        ${lbl('How often?', `<select id="fx-every" class="${IN}"><option value="month">Every month</option><option value="year">Every year (spread over 12 months)</option><option value="once">One time</option></select>`)}
        ${lbl('Starting', `<input id="fx-start" type="date" value="${ymd(new Date())}" class="${IN}">`)}
        <button id="fx-save" onclick="saveFixedCost('${kind}')" class="w-full bg-[#00F296] text-slate-950 font-black py-3 rounded-xl text-sm">Save</button>`);
};
window.saveFixedCost = async function (kind) {
    const name = val('fx-name').trim().slice(0, 40), amt = num(val('fx-amt'));
    if (!name) { toast('Give it a name.', 'error'); return; }
    if (!(amt > 0)) { toast('Enter the amount.', 'error'); return; }
    if (kind === 'owner' && !M.owner) return;
    const id = newId('fx');
    const ok = await saving('fx-save', 'Save', () => setDoc(fixedRef(kind, id), {
        id, name, amountCents: Math.round(amt * 100), every: val('fx-every') || 'month', startDate: val('fx-start') || ymd(new Date()), createdAt: serverTimestamp()
    }));
    if (ok) { document.getElementById('fixed-modal')?.remove(); toast(`${name} saved.`); }
};
window.endFixedCost = async function (kind, id) {
    if (!confirm('Stop counting this from this month on?')) return;
    try { await updateDoc(fixedRef(kind, id), { endDate: ymd(new Date()) }); } catch (e) { toast("Couldn't save. Try again.", 'error'); }
};
window.deleteFixedCost = async function (kind, id) {
    if (!confirm('Delete it? It comes out of past months too (use Stop to keep the past).')) return;
    try { await deleteDoc(fixedRef(kind, id)); } catch (e) { toast("Couldn't delete it. Try again.", 'error'); }
};

// ---- per-game costs setup
function readSetupInputs() {
    const s = JSON.parse(JSON.stringify(M.settings || {}));
    s.drive = { ...DEFAULTS.drive, ...(s.drive || {}) };
    s.wash = { ...DEFAULTS.wash, ...(s.wash || {}) };
    const set = (obj, key, id) => { const el = document.getElementById(id); if (el && el.value !== '') obj[key] = num(el.value); };
    set(s.drive, 'miles', 'cs-miles'); set(s.drive, 'mpg', 'cs-mpg'); set(s.drive, 'gasPrice', 'cs-gas'); set(s.drive, 'irsRate', 'cs-irs');
    set(s.wash, 'loads', 'cs-loads'); set(s.wash, 'detergentPrice', 'cs-det'); set(s.wash, 'loadsPerBottle', 'cs-det-loads');
    set(s.wash, 'kwhPerLoad', 'cs-kwh'); set(s.wash, 'kwhPrice', 'cs-kwh-price'); set(s.wash, 'waterPerLoad', 'cs-water');
    return s;
}
async function saveSettings(s, msg) {
    M.settings = s; draw();
    try { await setDoc(doc(...comm(M.cid, 'books', 'settings')), s, { merge: true }); if (msg) toast(msg); }
    catch (e) { console.error(e); toast("Couldn't save. Try again.", 'error'); }
}
window.toggleCostPart = function (key) { const s = readSetupInputs(); s[key].on = !s[key].on; saveSettings(s); };
window.setDriveMethod = function (m) { const s = readSetupInputs(); s.drive.method = m; saveSettings(s); };
window.saveCostSetup = function () {
    const s = readSetupInputs();
    const a = autoCostsFor(s);
    saveSettings(s, `Saved: ${money(a.total)} added to every game played.`);
};
window.toggleAutoCosts = function (eventId) {
    const s = JSON.parse(JSON.stringify(M.settings || {}));
    const skip = new Set(s.skipAuto || []);
    if (skip.has(eventId)) skip.delete(eventId); else skip.add(eventId);
    s.skipAuto = [...skip];
    saveSettings(s);
};

// ------------------------------------------------------------------ CSV (for a spreadsheet or your accountant)
window.downloadMoneyCsv = function () {
    const r = report();
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const amt = (c) => ((Number(c) || 0) / 100).toFixed(2);
    const rows = [['Date', 'Type', 'Description', 'Amount']];
    r.games.forEach(g => {
        if (g.total) rows.push([g.day, 'Income', `${g.title} (credit ${amt(g.credit)}, cash ${amt(g.cash)})`, amt(g.total)]);
        if (g.auto) rows.push([g.day, 'Per-game cost', `${g.title}: gas / washing`, '-' + amt(g.auto)]);
        if (g.wear) rows.push([g.day, 'Equipment wear', g.title, '-' + amt(g.wear)]);
    });
    r.expenseList.forEach(x => rows.push([x.date, 'Expense', `${kindLabel(x.category).replace(/^\S+\s/, '')}${x.note ? ' - ' + x.note : ''}${x.eventTitle ? ' (' + x.eventTitle + ')' : ''}`, '-' + amt(x.amountCents)]));
    M.supplyMoves.filter(mv => mv.type === 'use' && matcher(M.period)(mv.date))
        .forEach(mv => rows.push([mv.date, 'Supplies used', `${mv.qty} ${mv.unit || ''} ${mv.name || ''}${mv.eventTitle ? ' (' + mv.eventTitle + ')' : ''}`, '-' + amt(mv.cents)]));
    if (r.wearOther) rows.push(['', 'Equipment lost / broken', '', '-' + amt(r.wearOther)]);
    if (r.fixed) rows.push(['', 'Fixed costs', r.months.length > 1 ? `${r.months[0]} to ${r.months[r.months.length - 1]}` : (r.months[0] || ''), '-' + amt(r.fixed)]);
    const s = M.settings || {};
    if (s.drive && s.drive.on) {
        const miles = num(s.drive.miles) * r.games.filter(g => g.autoOn && g.hasPeople).length;
        rows.push(['', 'Miles driven (for taxes)', `${miles} miles · IRS 2026 rate 72.5c = ${(miles * 0.725).toFixed(2)}`, '']);
    }
    rows.push([], ['', 'Total income', '', amt(r.income)], ['', 'Total costs', '', '-' + amt(r.costs)], ['', r.profit >= 0 ? 'Profit' : 'Loss', '', amt(r.profit)],
        ['', 'Unearned (prepaid credit) today', '', amt(r.unearned)], ['', 'Supplies on hand today', '', amt(r.suppliesOnHand)]);
    const blob = new Blob([rows.map(row => row.map(q).join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(M.name || 'community').replace(/[^\w-]+/g, '_')}_money_${M.period}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
