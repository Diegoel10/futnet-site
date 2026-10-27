// js/money-tracker.js: Community money tracker (admins only), kept like an accountant would:
//   - Money players pay you ahead (their credit) is NOT income yet: it's "unearned" (prepaid).
//   - It becomes INCOME when the game is played: game fees taken from credit (minus refunds) + cash
//     marked Paid at that game.
//   - EXPENSES are logged by the admins: field, water, balls, pinnies, referee...
//   Profit = income - expenses, for the period you pick (by game day / expense day).
//
// Firestore: artifacts/{appId}/communities/{id}/expenses/{id} =
//   { id, amountCents, category, note, date: 'YYYY-MM-DD', eventId?, eventTitle?, receiptUrl?, by, byName, createdAt }
// Income is worked out from the games (eventsList) and the credit ledger, nothing extra is saved.
import { db, appId } from './firebase-config.js';
import {
    doc, collection, getDocs, onSnapshot, setDoc, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { escapeHtml as esc, jsArg } from './game-profile/event-store.js';
import { feeCentsOf, plusOneExtraOf, startMsOf, unpaidList } from './money-rules.js';
import { uploadMedia, showUploadProgress, hideUploadProgress, mediaErrorText } from './wa-chat.js';

const toast = (m, t) => window.showToast && window.showToast(m, t);
const comm = (cid, ...p) => [db, 'artifacts', appId, 'communities', cid, ...p];
const money = (c) => { const v = Math.round(Number(c) || 0); return `${v < 0 ? '-' : ''}$${(Math.abs(v) / 100).toFixed(2)}`; };
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const tsMs = (t) => (t && typeof t.toMillis === 'function') ? t.toMillis() : (Number(t) || 0);

export const EXPENSE_KINDS = [
    ['field', '🏟️ Field'], ['drinks', '💧 Water & drinks'], ['balls', '⚽ Balls'],
    ['pinnies', '🎽 Pinnies'], ['referee', '🧑‍⚖️ Referee'], ['other', '📦 Other']
];
const kindLabel = (k) => (EXPENSE_KINDS.find(x => x[0] === k) || EXPENSE_KINDS[5])[1];

const M = { cid: null, name: '', ledger: [], credits: [], expenses: [], unsub: null, period: null, loading: true, error: '' };

// ------------------------------------------------------------------ the math (kept pure so it can be tested)
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

/**
 * Everything the screen shows. events = the community's games, ledger = credit ledger lines,
 * credits = balances, expenses = logged expenses, now = ms, inPeriod(dayString) -> bool.
 */
export function moneyReport({ events, ledger, credits, expenses, now, inPeriod }) {
    const byEvent = {};
    (events || []).forEach(ev => { byEvent[ev.id] = ev; });
    // Credit taken for each game (game fee lines are negative, refunds positive).
    const creditFor = {}, ledgerTitle = {}, ledgerLast = {};
    (ledger || []).forEach(l => {
        if (!l || !l.eventId || (l.type !== 'game' && l.type !== 'refund')) return;
        creditFor[l.eventId] = (creditFor[l.eventId] || 0) - (Number(l.amountCents) || 0);
        if (l.eventTitle) ledgerTitle[l.eventId] = l.eventTitle;
        ledgerLast[l.eventId] = Math.max(ledgerLast[l.eventId] || 0, tsMs(l.at));
    });
    const ids = new Set([...Object.keys(byEvent), ...Object.keys(creditFor)]);
    const games = [];
    let prepaidForUpcoming = 0;
    ids.forEach(id => {
        const ev = byEvent[id];
        const credit = creditFor[id] || 0;
        const start = ev ? startMsOf(ev) : ledgerLast[id];
        const played = !!(ev && ev.isSessionEnded) || (!!start && start <= now);
        if (!played) { prepaidForUpcoming += credit; return; }
        const cash = ev ? cashAtGame(ev) : { cents: 0, people: 0 };
        const day = ev ? String(ev.date || '').slice(0, 10) : (start ? ymd(new Date(start)) : '');
        const owed = ev ? unpaidList(ev).reduce((s, u) => s + u.cents, 0) : 0;
        if (!credit && !cash.cents && !owed) return;   // free game, nothing to show
        games.push({ id, title: (ev && ev.title) || ledgerTitle[id] || 'Game', day, credit, cash: cash.cents, total: credit + cash.cents, owed, deleted: !ev });
    });
    const exp = (expenses || []).filter(x => x && x.date);
    const gamesIn = games.filter(g => inPeriod(g.day)).sort((a, b) => b.day.localeCompare(a.day));
    const expIn = exp.filter(x => inPeriod(x.date)).sort((a, b) => b.date.localeCompare(a.date));
    // Expenses linked to a game: shown on that game's line (profit per game).
    const expByGame = {};
    exp.forEach(x => { if (x.eventId) expByGame[x.eventId] = (expByGame[x.eventId] || 0) + (Number(x.amountCents) || 0); });
    gamesIn.forEach(g => { g.expenses = expByGame[g.id] || 0; g.profit = g.total - g.expenses; });
    const income = gamesIn.reduce((s, g) => s + g.total, 0);
    const spent = expIn.reduce((s, x) => s + (Number(x.amountCents) || 0), 0);
    const byKind = {};
    expIn.forEach(x => { byKind[x.category || 'other'] = (byKind[x.category || 'other'] || 0) + (Number(x.amountCents) || 0); });
    const held = (credits || []).reduce((s, c) => s + Math.max(0, Number(c.balanceCents) || 0), 0);
    return {
        income, incomeCredit: gamesIn.reduce((s, g) => s + g.credit, 0), incomeCash: gamesIn.reduce((s, g) => s + g.cash, 0),
        expenses: spent, profit: income - spent, byKind,
        unearned: held + prepaidForUpcoming, held, prepaidForUpcoming,
        owed: gamesIn.reduce((s, g) => s + g.owed, 0),
        games: gamesIn, expenseList: expIn
    };
}

// ------------------------------------------------------------------ periods
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
const matcher = (key) => key === 'all' ? () => true
    : key.startsWith('y') ? (day) => String(day || '').startsWith(key.slice(1))
    : (day) => String(day || '').startsWith(key);

// ------------------------------------------------------------------ screen
window.openMoneyTracker = async function (cid) {
    const c = (window.communitiesCache || {})[cid] || {};
    M.cid = cid; M.name = c.name || 'Community'; M.loading = true; M.error = ''; M.period = M.period || periods()[0].key;
    let m = document.getElementById('money-tracker-modal');
    if (!m) {
        m = document.createElement('div');
        m.id = 'money-tracker-modal';
        m.className = 'fixed inset-0 z-[200] bg-[#03080F] overflow-y-auto';
        document.body.appendChild(m);
    }
    draw();
    if (M.unsub) { try { M.unsub(); } catch (e) {} }
    M.unsub = onSnapshot(collection(...comm(cid, 'expenses')), s => {
        M.expenses = s.docs.map(d => ({ id: d.id, ...d.data() }));
        draw();
    }, (e) => { console.warn('expenses', e); M.error = "Couldn't load the expenses."; draw(); });
    try {
        const [l, cr] = await Promise.all([getDocs(collection(...comm(cid, 'creditLedger'))), getDocs(collection(...comm(cid, 'credits')))]);
        M.ledger = l.docs.map(d => d.data());
        M.credits = cr.docs.map(d => d.data());
    } catch (e) { console.warn('money tracker', e); M.error = "Couldn't load the credit history."; }
    M.loading = false;
    draw();
};

window.closeMoneyTracker = function () {
    if (M.unsub) { try { M.unsub(); } catch (e) {} M.unsub = null; }
    document.getElementById('money-tracker-modal')?.remove();
};
window.setMoneyPeriod = function (key) { M.period = key; draw(); };

function report() {
    const events = (window.eventsList || []).filter(e => e.communityId === M.cid);
    return moneyReport({ events, ledger: M.ledger, credits: M.credits, expenses: M.expenses, now: Date.now(), inPeriod: matcher(M.period) });
}

function draw() {
    const m = document.getElementById('money-tracker-modal');
    if (!m) return;
    const r = report();
    const per = periods();
    const card = (label, value, color, sub = '') => `<div class="bg-black/40 border border-white/10 rounded-2xl p-3 text-center">
        <div class="text-[10px] font-black uppercase tracking-wider text-white/50">${label}</div>
        <div class="text-xl font-black mt-1" style="color:${color}">${value}</div>${sub ? `<div class="text-[10px] text-white/45 mt-0.5">${sub}</div>` : ''}</div>`;
    const kinds = Object.entries(r.byKind).sort((a, b) => b[1] - a[1]);
    m.innerHTML = `
    <div class="max-w-2xl mx-auto px-4 pt-4 pb-24 text-white space-y-4">
        <div class="flex items-center gap-3">
            <button onclick="closeMoneyTracker()" class="w-9 h-9 rounded-full bg-black/60 border border-white/15 flex items-center justify-center"><i class="fa-solid fa-arrow-left"></i></button>
            <div class="flex-1 min-w-0"><div class="text-[10px] font-black uppercase tracking-wider text-[#00F296]">💰 Money tracker</div>
                <div class="text-sm font-black truncate">${esc(M.name)}</div></div>
            <button onclick="downloadMoneyCsv()" class="text-[11px] font-black bg-black/60 border border-white/15 rounded-xl px-3 py-2"><i class="fa-solid fa-download mr-1"></i> CSV</button>
        </div>
        <select onchange="setMoneyPeriod(this.value)" class="w-full bg-black/60 border border-teal-500/50 rounded-xl px-3 py-2.5 text-white text-base sm:text-sm font-bold">
            ${per.map(p => `<option value="${p.key}" ${p.key === M.period ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}
        </select>
        ${M.error ? `<div class="text-xs text-red-300 bg-red-500/10 border border-red-500/40 rounded-xl p-3">${esc(M.error)}</div>` : ''}
        ${M.loading ? '<div class="text-xs text-white/50 text-center py-2"><i class="fa-solid fa-spinner fa-spin mr-1"></i> Loading…</div>' : ''}
        <div class="grid grid-cols-3 gap-2">
            ${card('Income', money(r.income), '#00F296', 'games played')}
            ${card('Expenses', money(r.expenses), '#FF8080')}
            ${card(r.profit >= 0 ? 'Profit' : 'Loss', money(r.profit), r.profit >= 0 ? '#00F296' : '#FF8080')}
        </div>
        <div class="bg-black/40 border border-white/10 rounded-2xl p-3 space-y-1 text-xs">
            <div class="flex justify-between"><span class="text-white/70">Game fees paid with credit</span><b>${money(r.incomeCredit)}</b></div>
            <div class="flex justify-between"><span class="text-white/70">Cash / other marked Paid at games</span><b>${money(r.incomeCash)}</b></div>
            ${r.owed ? `<div class="flex justify-between text-amber-300"><span>Still owed by players (not counted yet)</span><b>${money(r.owed)}</b></div>` : ''}
        </div>
        <div class="bg-sky-500/10 border border-sky-400/40 rounded-2xl p-3">
            <div class="flex items-center justify-between"><span class="text-[10px] font-black uppercase tracking-wider text-sky-300">Unearned (prepaid credit)</span><span class="text-base font-black text-sky-200">${money(r.unearned)}</span></div>
            <p class="text-[10px] text-white/55 mt-1">Money players paid ahead that isn't income yet. It becomes income when the games are played. Right now: ${money(r.held)} in members' credit${r.prepaidForUpcoming ? ` + ${money(r.prepaidForUpcoming)} already taken for upcoming games` : ''}.</p>
        </div>

        <div class="flex items-center justify-between pt-1"><div class="text-[10px] font-black uppercase tracking-wider text-[#00F296]">Expenses (${r.expenseList.length})</div>
            <button onclick="openExpenseForm()" class="bg-[#00F296] text-slate-950 font-black text-xs px-3 py-2 rounded-xl"><i class="fa-solid fa-plus mr-1"></i> Add expense</button></div>
        ${kinds.length ? `<div class="flex flex-wrap gap-1.5">${kinds.map(([k, v]) => `<span class="text-[10px] font-bold bg-black/50 border border-white/10 rounded-full px-2.5 py-1">${kindLabel(k)} <b class="text-[#FF8080]">${money(v)}</b></span>`).join('')}</div>` : ''}
        <div class="space-y-2">${r.expenseList.map(x => `
            <div class="flex items-center gap-3 bg-black/40 border border-white/10 rounded-xl p-2.5">
                <div class="flex-1 min-w-0"><div class="text-xs font-bold truncate">${kindLabel(x.category)}${x.note ? ` · ${esc(x.note)}` : ''}</div>
                    <div class="text-[10px] text-white/50">${esc(x.date)}${x.eventTitle ? ` · ${esc(x.eventTitle)}` : ''}${x.byName ? ` · by ${esc(x.byName)}` : ''}
                    ${x.receiptUrl ? ` · <a href="${esc(x.receiptUrl)}" target="_blank" rel="noopener" class="text-[#00F296] underline">receipt</a>` : ''}</div></div>
                <b class="text-sm text-[#FF8080] shrink-0">-${money(x.amountCents)}</b>
                <button onclick="deleteExpense('${jsArg(x.id)}')" class="w-7 h-7 shrink-0 rounded-full bg-red-500/10 border border-red-500/30 text-red-300 text-[10px]"><i class="fa-solid fa-trash-can"></i></button>
            </div>`).join('') || '<p class="text-xs text-white/45 italic">No expenses in this period.</p>'}</div>

        <div class="text-[10px] font-black uppercase tracking-wider text-[#00F296] pt-1">Income by game (${r.games.length})</div>
        <div class="space-y-2">${r.games.map(g => `
            <div class="bg-black/40 border border-white/10 rounded-xl p-2.5">
                <div class="flex items-center gap-2"><div class="flex-1 min-w-0"><div class="text-xs font-bold truncate">${esc(g.title)}${g.deleted ? ' <span class="text-white/40">(deleted)</span>' : ''}</div>
                    <div class="text-[10px] text-white/50">${esc(g.day)} · credit ${money(g.credit)} · cash ${money(g.cash)}${g.owed ? ` · <span class="text-amber-300">owed ${money(g.owed)}</span>` : ''}</div></div>
                    <b class="text-sm text-[#00F296] shrink-0">${money(g.total)}</b></div>
                ${g.expenses ? `<div class="text-[10px] text-white/60 mt-1">Expenses for this game ${money(g.expenses)} → <b class="${g.profit >= 0 ? 'text-[#00F296]' : 'text-[#FF8080]'}">${g.profit >= 0 ? 'profit' : 'loss'} ${money(g.profit)}</b></div>` : ''}
            </div>`).join('') || '<p class="text-xs text-white/45 italic">No paid games played in this period.</p>'}</div>
        <p class="text-[10px] text-white/35 text-center pt-2">Only admins see this page.</p>
    </div>`;
}

// ------------------------------------------------------------------ expenses
window.openExpenseForm = function () {
    const games = (window.eventsList || []).filter(e => e.communityId === M.cid)
        .sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).slice(0, 30);
    document.getElementById('expense-form-modal')?.remove();
    const f = document.createElement('div');
    f.id = 'expense-form-modal';
    f.className = 'fixed inset-0 z-[230] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm';
    const IN = 'w-full bg-black/60 border border-teal-500/50 rounded-xl px-3 py-2.5 text-white text-base sm:text-sm focus:outline-none focus:border-[#00F296]';
    f.innerHTML = `<div class="bg-[#040E13] border border-emerald-500/40 rounded-3xl max-w-sm w-full p-5 space-y-3 text-white max-h-[92vh] overflow-y-auto" onclick="event.stopPropagation()">
        <div class="flex items-center justify-between"><h4 class="text-sm font-black">Add expense</h4>
            <button onclick="document.getElementById('expense-form-modal').remove()" class="text-white/50 text-lg"><i class="fa-solid fa-xmark"></i></button></div>
        <label class="block"><span class="text-[10px] font-black uppercase text-white/60">Amount ($)</span>
            <input id="exp-amount" type="number" inputmode="decimal" min="0.01" step="0.01" placeholder="120" class="${IN} mt-1"></label>
        <div><span class="text-[10px] font-black uppercase text-white/60">What for?</span>
            <div class="grid grid-cols-2 gap-1.5 mt-1" id="exp-kinds">${EXPENSE_KINDS.map(([k, l], i) => `
                <button type="button" data-k="${k}" onclick="pickExpenseKind(this)" class="py-2 rounded-lg text-[11px] font-black ${i === 0 ? 'bg-[#00F296] text-slate-950' : 'bg-black/50 border border-white/15 text-white/80'}" ${i === 0 ? 'data-on="1"' : ''}>${l}</button>`).join('')}</div></div>
        <label class="block"><span class="text-[10px] font-black uppercase text-white/60">Date</span>
            <input id="exp-date" type="date" value="${ymd(new Date())}" class="${IN} mt-1"></label>
        <label class="block"><span class="text-[10px] font-black uppercase text-white/60">For a game? (optional)</span>
            <select id="exp-game" class="${IN} mt-1"><option value="">Not for one game</option>
                ${games.map(g => `<option value="${esc(g.id)}" data-date="${esc(String(g.date || '').slice(0, 10))}">${esc(String(g.date || '').slice(0, 10))} · ${esc(g.title || 'Game')}</option>`).join('')}</select></label>
        <label class="block"><span class="text-[10px] font-black uppercase text-white/60">Note (optional)</span>
            <input id="exp-note" type="text" maxlength="120" placeholder="e.g. Field rental 7-9pm" class="${IN} mt-1"></label>
        <label class="block"><span class="text-[10px] font-black uppercase text-white/60">Receipt photo (optional)</span>
            <input id="exp-receipt" type="file" accept="image/*" class="block w-full text-xs text-white/70 mt-1 file:mr-2 file:rounded-lg file:border-0 file:bg-black/60 file:text-white file:px-3 file:py-2"></label>
        <button id="exp-save" onclick="saveExpense()" class="w-full bg-[#00F296] text-slate-950 font-black py-3 rounded-xl text-sm">Save expense</button>
    </div>`;
    f.onclick = () => f.remove();
    document.body.appendChild(f);
    f.querySelector('#exp-game').addEventListener('change', (e) => {
        const d = e.target.selectedOptions[0]?.dataset.date;
        if (d) f.querySelector('#exp-date').value = d;   // the expense lands on the game's day
    });
};
window.pickExpenseKind = function (btn) {
    btn.parentNode.querySelectorAll('button').forEach(b => {
        b.dataset.on = b === btn ? '1' : '';
        b.className = `py-2 rounded-lg text-[11px] font-black ${b === btn ? 'bg-[#00F296] text-slate-950' : 'bg-black/50 border border-white/15 text-white/80'}`;
    });
};

window.saveExpense = async function () {
    const me = window.currentUser; if (!me || !M.cid) return;
    const amt = parseFloat(document.getElementById('exp-amount')?.value || '');
    if (!(amt > 0)) { toast('Enter the amount.', 'error'); return; }
    const date = document.getElementById('exp-date')?.value || ymd(new Date());
    const category = document.querySelector('#exp-kinds [data-on="1"]')?.dataset.k || 'other';
    const sel = document.getElementById('exp-game');
    const eventId = sel?.value || '';
    const eventTitle = eventId ? ((window.eventsList || []).find(e => e.id === eventId)?.title || '') : '';
    const note = (document.getElementById('exp-note')?.value || '').trim().slice(0, 120);
    const file = document.getElementById('exp-receipt')?.files?.[0];
    const btn = document.getElementById('exp-save'); if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    try {
        let receiptUrl = '';
        if (file) {
            showUploadProgress('Uploading receipt…', 0);
            try { receiptUrl = (await uploadMedia(file, `community/${M.cid}`, (p) => showUploadProgress('Uploading receipt…', p))).url || ''; }
            finally { hideUploadProgress(); }
        }
        const id = `exp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const p = window.userProfile || {};
        await setDoc(doc(...comm(M.cid, 'expenses', id)), {
            id, amountCents: Math.round(amt * 100), category, note, date,
            ...(eventId ? { eventId, eventTitle } : {}), ...(receiptUrl ? { receiptUrl } : {}),
            by: String(me.uid), byName: p.name || p.firstName || me.displayName || 'Admin', createdAt: serverTimestamp()
        });
        document.getElementById('expense-form-modal')?.remove();
        // Show the period the expense is in.
        if (!matcher(M.period)(date)) { M.period = date.slice(0, 7); draw(); }
        toast(`Expense saved: ${money(Math.round(amt * 100))}`);
    } catch (e) {
        console.error('expense', e);
        toast(e && e.message && /NOT_MEDIA|TOO_BIG|unauthorized/.test(e.message) ? mediaErrorText(e) : "Couldn't save the expense. Try again.", 'error');
        if (btn) { btn.disabled = false; btn.textContent = 'Save expense'; }
    }
};

window.deleteExpense = async function (id) {
    const x = M.expenses.find(e => e.id === id); if (!x) return;
    if (!confirm(`Delete this expense (${money(x.amountCents)})?`)) return;
    try { await deleteDoc(doc(...comm(M.cid, 'expenses', id))); toast('Expense deleted.'); }
    catch (e) { console.error(e); toast("Couldn't delete it. Try again.", 'error'); }
};

// ------------------------------------------------------------------ CSV (for a spreadsheet or your accountant)
window.downloadMoneyCsv = function () {
    const r = report();
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const amt = (c) => ((Number(c) || 0) / 100).toFixed(2);
    const rows = [['Date', 'Type', 'Description', 'Credit', 'Cash', 'Amount']];
    r.games.forEach(g => rows.push([g.day, 'Income', g.title, amt(g.credit), amt(g.cash), amt(g.total)]));
    r.expenseList.forEach(x => rows.push([x.date, 'Expense', `${kindLabel(x.category).replace(/^\S+\s/, '')}${x.note ? ' - ' + x.note : ''}${x.eventTitle ? ' (' + x.eventTitle + ')' : ''}`, '', '', '-' + amt(x.amountCents)]));
    rows.push([], ['', 'Total income', '', '', '', amt(r.income)], ['', 'Total expenses', '', '', '', '-' + amt(r.expenses)], ['', 'Profit', '', '', '', amt(r.profit)],
        ['', 'Unearned (prepaid credit) today', '', '', '', amt(r.unearned)]);
    const blob = new Blob([rows.map(row => row.map(q).join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(M.name || 'community').replace(/[^\w-]+/g, '_')}_money_${M.period}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
