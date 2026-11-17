// game-analytics.js: 📈 Analytics for a regular game (Admin tab), same as the apps.
//   Who opened the game: eventsList/{gameId}/views/{uid}, written and read by the server (recordGameView / gameViews),
//   once per person per 30 minutes. The organizer's own visits don't count.
//   Plus the sign-up numbers from the game itself (going, waitlist, not going, +1s, late, no-shows).
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js";
import { escapeHtml as esc } from './game-profile/event-store.js';

const fns = () => getFunctions();
const AV = 'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/icons/person-circle.svg';

window.recordGameView = function (gameId) {
    if (!gameId || !window.currentUser) return;
    try { const k = 'futnet_gameview_' + gameId; const last = +localStorage.getItem(k) || 0; if (Date.now() - last < 30 * 60000) return; localStorage.setItem(k, String(Date.now())); } catch (e) { /* ignore */ }
    httpsCallable(fns(), 'recordGameView')({ gameId }).catch(() => {});
};

function shell(html) {
    let el = document.getElementById('game-analytics');
    if (!el) { el = document.createElement('div'); el.id = 'game-analytics'; el.className = 'fixed inset-0 z-[160] bg-[#01060A]/95 overflow-y-auto text-white'; document.body.appendChild(el); }
    el.innerHTML = `<div class="max-w-lg mx-auto p-4 space-y-4">
        <div class="flex items-center gap-3"><button onclick="document.getElementById('game-analytics')?.remove()" class="w-9 h-9 rounded-full bg-black/60 border border-white/20 flex items-center justify-center"><i class="fa-solid fa-chevron-left text-sm"></i></button>
        <h3 class="text-base font-black">📈 Analytics</h3></div>${html}</div>`;
}
const box = (n, label, color = 'text-white') => `<div class="bg-black/40 border border-white/10 rounded-xl p-2 text-center"><div class="text-xl font-black ${color}">${n}</div><div class="text-[10px] text-white/55">${label}</div></div>`;

window.openGameAnalytics = async function (eventId) {
    const ev = (window.eventsList || []).find(e => e.id === eventId) || {};
    const att = ev.attendees || [];
    const going = att.filter(a => !a.status || a.status === 'confirmed');
    const guests = att.reduce((n, a) => n + ((a.guests || []).length), 0);
    const signedUp = new Set([...att, ...(ev.waitingList || []), ...(ev.declinedList || [])].map(a => a && a.uid).filter(Boolean));
    const top = `<div class="text-[11px] font-black uppercase tracking-wider text-[#00F296]">Sign-ups</div>
        <div class="grid grid-cols-3 gap-2">${box(going.length, 'going', 'text-[#00F296]')}${box((ev.waitingList || []).length, 'waitlist')}${box((ev.declinedList || []).length, 'not going')}
        ${box(guests, '+1s')}${box(going.filter(a => a.attendance === 'late').length, 'late', 'text-amber-300')}${box(going.filter(a => a.attendance === 'noshow').length, 'no-shows', 'text-red-400')}</div>`;
    shell(top + '<p class="text-xs text-white/50 text-center py-6"><i class="fa-solid fa-spinner fa-spin mr-1"></i> Loading…</p>');
    let list = null;
    try { list = ((await httpsCallable(fns(), 'gameViews')({ gameId: eventId })).data || {}).list || []; } catch (e) { list = null; }
    if (!document.getElementById('game-analytics')) return;
    if (!list) { shell(top + '<p class="text-xs text-white/55 py-4">Couldn\'t load who opened it. Check your connection.</p>'); return; }
    const visits = list.reduce((n, v) => n + (+v.count || 0), 0), notIn = list.filter(v => !signedUp.has(v.uid)).length;
    shell(top + `<div class="text-[11px] font-black uppercase tracking-wider text-[#00F296]">Who opened the game</div>
        <div class="grid grid-cols-3 gap-2">${box(list.length, 'people', 'text-[#00F296]')}${box(visits, 'visits')}${box(notIn, 'looked, not in', 'text-amber-300')}</div>
        <p class="text-[10px] text-white/45">Counts everyone who opened this game (once per 30 minutes). Your own visits don't count.</p>
        <div class="space-y-1.5">${list.map(v => `<div class="flex items-center gap-3 bg-black/40 border border-white/10 rounded-xl px-3 py-2">
            <img src="${esc(v.avatar || AV)}" onerror="this.onerror=null;this.src='${AV}'" class="w-8 h-8 rounded-full object-cover">
            <span class="flex-1 min-w-0"><span class="block text-xs font-black truncate">${esc(v.name)} ${signedUp.has(v.uid) ? '<span class="text-[9px] text-[#00F296]">SIGNED UP</span>' : ''}</span>
            <span class="block text-[10px] text-white/50">${v.lastAt ? 'Last seen ' + esc(new Date(v.lastAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })) : ''}</span></span>
            <span class="text-xs font-black text-white/80">${+v.count || 1}×</span></div>`).join('') || '<p class="text-xs text-white/50 text-center py-4">Nobody has opened it yet. Share the game to get it seen!</p>'}</div>`);
};
