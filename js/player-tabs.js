// js/player-tabs.js: tabs on your Profile (Basic info / Player info / Stats / Events), Settings (the gear) with
// Privacy, and the page you see when you tap another player (Player info / Stats / Events / Basic info).
// Privacy is saved on the public card: directory/{uid}.privacy = { basic, player, stats, events } (true = hidden).
// Birthdays are saved as "1990-05-01" everywhere and shown as "May 1, 1990" (other players see "May 1").
import { db, appId } from './firebase-config.js';
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "1990-05-01" -> "May 1, 1990" (or "May 1"). Anything else is shown as it is. */
export function prettyDob(v, withYear = true) {
    const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/) || null;
    if (!m) {
        const us = String(v || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);   // old "05/01/1990" from an early app
        if (!us) return String(v || '');
        return `${MONTHS[+us[1] - 1]} ${+us[2]}${withYear ? ', ' + us[3] : ''}`;
    }
    return `${MONTHS[+m[2] - 1]} ${+m[3]}${withYear ? ', ' + m[1] : ''}`;
}
window.prettyDob = prettyDob;
/** Game dates: "2026-10-25" -> "Sun, Oct 25, 2026" (Month Day, Year, like the apps). */
export function fmtGameDate(v, weekday = true) {
    const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return String(v || '');
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    return d.toLocaleDateString('en-US', weekday ? { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}
window.fmtGameDate = fmtGameDate;

// ---------------- Profile status (directory/{uid}.status) ----------------
export const STATUSES = [
    ['', 'Ready to play!', ''], ['injured', 'Injured', '🤕'], ['traveling', 'Traveling', '✈️'],
    ['work', 'Busy with work', '💼'], ['school', 'Busy with school', '📚'],
];
const statusOf = (uid) => {
    if (uid && uid === window.currentUser?.uid && window.userProfile && window.userProfile.status !== undefined) return window.userProfile.status || '';
    const d = (window.cachedDirectoryList || window.directoryList || []).find(x => String(x.uid) === String(uid));
    return (d && d.status) || '';
};
/** The status emoji to show next to a name ('' for Ready to play). */
window.statusEmoji = (uid) => {
    const st = STATUSES.find(x => x[0] === statusOf(uid));
    return st && st[2] ? ` <span title="${st[1]}" class="not-italic">${st[2]}</span>` : '';
};
window.setMyStatus = async function (key) {
    const uid = window.currentUser?.uid; if (!uid) return;
    window.userProfile = { ...(window.userProfile || {}), status: key };
    const d = (window.cachedDirectoryList || window.directoryList || []).find(x => String(x.uid) === String(uid)); if (d) d.status = key;
    window.myProfileTab('basic');
    try {
        await setDoc(doc(db, 'artifacts', appId, 'directory', uid), { uid, status: key }, { merge: true });
        await setDoc(doc(db, 'artifacts', appId, 'users', uid, 'profile', 'data'), { status: key }, { merge: true });
        const st = STATUSES.find(x => x[0] === key);
        if (window.showToast) window.showToast(`Status: ${st ? st[1] + (st[2] ? ' ' + st[2] : '') : 'Ready to play!'}`);
    } catch (e) { if (window.showToast) window.showToast("Couldn't save. Check your connection.", 'error'); }
};

export const privacyOf = (d) => {
    const p = (d && d.privacy) || {};
    return { basic: !!p.basic, player: !!p.player, stats: !!p.stats, events: !!p.events };
};

const TAB_BTN = (on) => `flex-1 py-2 rounded-lg text-[11px] font-black transition truncate ${on ? 'bg-[#00F296] text-slate-950 shadow' : 'text-white/60 hover:text-white'}`;
export function tabsBar(id, tabs, current, onclick) {
    return `<div id="${id}" class="bg-black/45 border border-[#00B4AE]/30 p-1 rounded-xl flex items-center gap-1">
        ${tabs.map(([k, label]) => `<button type="button" data-tab="${k}" onclick="${onclick}('${k}')" class="${TAB_BTN(k === current)}">${label}</button>`).join('')}
    </div>`;
}
function markTabs(id, current) {
    document.querySelectorAll(`#${id} [data-tab]`).forEach(b => { b.className = TAB_BTN(b.dataset.tab === current); });
}

export function infoTile(icon, title, value) {
    return `<div class="bg-[#07141E]/85 border border-[#00B4AE]/40 rounded-2xl p-3 flex items-center gap-3 min-w-0">
        <div class="w-8 h-8 rounded-xl bg-[#00B4AE]/20 flex items-center justify-center text-[#00B4AE] shrink-0"><i class="fa-solid ${icon} text-xs"></i></div>
        <div class="min-w-0"><div class="text-[9px] font-black text-white/55 uppercase tracking-wider">${title}</div>
        <div class="text-sm font-bold text-white truncate">${esc(value) || '—'}</div></div>
    </div>`;
}
const privateNote = (name) => `<div class="text-center py-10 space-y-2"><i class="fa-solid fa-lock text-2xl text-white/40"></i>
    <div class="text-sm font-semibold text-white/60">${esc(name)} keeps this private.</div></div>`;
const footWord = (f) => f === 'both' ? 'Both feet' : f ? `${f[0].toUpperCase()}${f.slice(1)} foot` : '';

/** Field (read only) + strong foot. */
function playerInfoHtml(d, prefix) {
    const field = d.positionSpot && window.positionPickerHtml
        ? window.positionPickerHtml(prefix, d.positionSpot, d.position2Spot || '', d.positionSide || '', d.position2Side || '', { readOnly: true })
        : `<div class="text-center text-sm text-white/60 py-6">${d.position ? 'Plays: ' + esc(d.position) : 'No position picked yet.'}</div>`;
    return `<div class="space-y-3">${field}${infoTile('fa-shoe-prints', 'Strong foot', footWord(d.foot))}</div>`;
}

/** Games someone is in (from the games already loaded on the site). */
function gamesHtml(uid, which) {
    const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
    const mine = (window.eventsList || []).filter(ev => ev.organizerId === uid || (ev.attendees || []).some(a => a.uid === uid));
    const list = mine.filter(ev => {
        const day = String(ev.date || '').slice(0, 10);
        return which === 'upcoming' ? (day >= today && !ev.isSessionEnded) : (day < today || ev.isSessionEnded);
    }).sort((a, b) => which === 'upcoming' ? String(a.date).localeCompare(String(b.date)) : String(b.date).localeCompare(String(a.date)));
    if (!list.length) return `<div class="text-center text-xs text-white/40 py-6">No ${which} games.</div>`;
    return list.map(ev => `
        <div onclick="document.getElementById('player-stats-sheet')?.remove(); openEventDetails('${esc(ev.id)}')" class="bg-black/50 border border-white/10 hover:border-[#00F296] rounded-xl p-3 cursor-pointer transition flex items-center justify-between gap-2">
            <div class="min-w-0">
                <div class="flex items-center gap-2"><span class="text-xs font-black text-white truncate">${esc(ev.title || 'Soccer Match')}</span>
                <span class="text-[9px] px-2 py-0.5 rounded-full font-bold bg-[#00F296]/20 text-[#00F296] shrink-0">${esc(ev.format || '7v7')}</span></div>
                <p class="text-[10px] text-white/60"><i class="fa-solid fa-calendar text-[#00F296]"></i> ${esc(fmtGameDate(ev.date) || 'TBD')} • ${esc(ev.time || '')}</p>
            </div>
            <span class="text-[10px] font-bold text-white/70 shrink-0">View ›</span>
        </div>`).join('');
}
function gamesBlock(uid, key) {
    return `<div class="space-y-2">
        ${tabsBar(`${key}-games-tabs`, [['upcoming', 'Upcoming'], ['previous', 'Previous']], 'upcoming', `${key}GamesTab`)}
        <div id="${key}-games-list" class="space-y-2">${gamesHtml(uid, 'upcoming')}</div>
    </div>`;
}
function wireGames(uid, key) {
    window[`${key}GamesTab`] = (w) => {
        markTabs(`${key}-games-tabs`, w);
        const box = document.getElementById(`${key}-games-list`); if (box) box.innerHTML = gamesHtml(uid, w);
    };
}

// ---------------- Your Profile: tabs ----------------
const ls = { get(k, d) { try { return localStorage.getItem(k) || d; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } } };

/** Tabs + their content for your own profile (profile.js puts this under the header). */
export function myProfileTabsHtml() {
    const tab = ls.get('futnet.profileTab', 'basic');
    return `${tabsBar('my-profile-tabs', [['basic', 'Basic info'], ['player', 'Player info'], ['stats', 'Stats'], ['events', 'Events']], tab, 'myProfileTab')}
        <div id="my-profile-tab-body" class="space-y-3"></div>`;
}
window.myProfileTab = (tab) => {
    ls.set('futnet.profileTab', tab);
    markTabs('my-profile-tabs', tab);
    const box = document.getElementById('my-profile-tab-body'); if (!box) return;
    const p = window.userProfile || {};
    const uid = window.currentUser?.uid || '';
    if (tab === 'player') {
        box.innerHTML = `<div class="bg-[#07141E]/85 border border-[#00B4AE]/40 rounded-2xl p-3 space-y-2 shadow-lg">
            <div class="text-[11px] text-white/60 text-center">Tap a shirt to change it. It saves right away.</div>
            ${window.positionPickerHtml('pf', p.positionSpot || '', p.position2Spot || '', p.positionSide || '', p.position2Side || '')}
            <div class="border-t border-white/10 pt-3">
                <div class="text-[9px] font-black text-white/60 uppercase tracking-wider text-center mb-2">Strong foot (optional)</div>
                <div id="profile-foot">${window.footButtons ? window.footButtons(p.foot) : ''}</div>
            </div>
        </div>`;
    } else if (tab === 'stats') {
        box.innerHTML = `<div class="bg-[#07141E]/85 border border-[#00B4AE]/40 rounded-2xl p-3 shadow-lg"><div id="profile-stats-box"></div></div>`;
        if (window.mountPlayerStats && uid) window.mountPlayerStats('profile-stats-box', uid);
    } else if (tab === 'events') {
        wireGames(uid, 'mine');
        box.innerHTML = gamesBlock(uid, 'mine');
    } else {
        const full = `${p.firstName || ''} ${p.lastName || ''}`.trim();
        const cur = p.status || '';
        box.innerHTML = `<div class="bg-[#07141E]/85 border border-[#00B4AE]/40 rounded-2xl p-3 space-y-2">
            <div class="text-[9px] font-black text-white/55 uppercase tracking-wider">My status</div>
            <div class="flex flex-wrap gap-1.5">${STATUSES.map(([k, label, emo]) => `<button onclick="setMyStatus('${k}')" class="px-2.5 py-1.5 rounded-full text-[11px] font-bold border transition ${cur === k ? 'bg-[#00F296] text-slate-950 border-[#00F296]' : 'bg-black/40 text-white/75 border-white/15'}">${emo ? emo + ' ' : ''}${label}</button>`).join('')}</div>
            <div class="text-[10px] text-white/45">Shows next to your name for other players.</div>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            ${infoTile('fa-user', 'Name', full)}
            ${infoTile('fa-id-badge', 'Nickname', p.nickname || '')}
            ${infoTile('fa-cake-candles', 'Birthday', prettyDob(p.dob))}
            ${infoTile('fa-venus-mars', 'Gender', p.gender || '')}
        </div>
        <button onclick="openEditProfileModal()" class="w-full bg-[#00B4AE]/15 border border-[#00B4AE]/40 text-[#00B4AE] font-black py-2.5 rounded-xl text-xs"><i class="fa-solid fa-pen-to-square mr-1"></i> Edit basic info</button>`;
    }
};

// ---------------- Settings (the gear) + Privacy ----------------
window.openProfileSettings = async function () {
    document.getElementById('profile-settings-modal')?.remove();
    const uid = window.currentUser?.uid; if (!uid) return;
    let priv = { basic: false, player: false, stats: false, events: false };
    try { const s = await getDoc(doc(db, 'artifacts', appId, 'directory', uid)); priv = privacyOf(s.exists() ? s.data() : {}); } catch (e) { /* offline: show all off */ }
    const row = (k, label) => `<label class="flex items-center justify-between gap-3 py-2.5 cursor-pointer">
        <span class="text-sm text-white">${label}</span>
        <input type="checkbox" ${priv[k] ? 'checked' : ''} onchange="savePrivacy('${k}', this.checked)" class="w-5 h-5 accent-[#00B4AE]">
    </label>`;
    const btn = (icon, label, onclick, color = 'text-white', border = 'border-[#00B4AE]/40') => `
        <button onclick="${onclick}" class="w-full bg-[#07141E]/90 border ${border} rounded-2xl p-3 flex items-center gap-3 text-left">
            <i class="fa-solid ${icon} w-5 text-center ${color === 'text-white' ? 'text-[#00B4AE]' : color}"></i><span class="text-xs font-bold ${color}">${label}</span></button>`;
    const m = document.createElement('div');
    m.id = 'profile-settings-modal';
    m.className = 'fixed inset-0 z-[160] bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-3';
    m.onclick = (e) => { if (e.target === m) m.remove(); };
    m.innerHTML = `<div class="bg-[#040E13] border border-[#00B4AE]/40 rounded-3xl w-full max-w-sm p-4 space-y-3 text-white max-h-[88dvh] overflow-y-auto">
        <div class="flex items-center justify-between"><h3 class="text-lg font-black">Settings</h3>
            <button onclick="document.getElementById('profile-settings-modal').remove()" class="w-8 h-8 rounded-full bg-white/10"><i class="fa-solid fa-xmark"></i></button></div>
        ${btn('fa-pen-to-square', 'Edit profile details', "document.getElementById('profile-settings-modal').remove(); openEditProfileModal()")}
        ${btn('fa-key', 'Sign-in details', "document.getElementById('profile-settings-modal').remove(); openSignInDetails()")}
        <div id="owner-tools-slot"></div>
        <div id="safety-slot"></div>
        <div class="bg-[#07141E]/90 border border-[#00B4AE]/40 rounded-2xl px-3 py-1">
            <div class="text-[10px] font-black text-[#00B4AE] uppercase tracking-wider pt-2">Privacy</div>
            <div class="text-[11px] text-white/50">On = other players can't see it. You always see everything.</div>
            <div class="divide-y divide-white/10">
                ${row('basic', 'Hide Basic info (birthday, gender)')}
                ${row('player', 'Hide Player info (position, foot)')}
                ${row('stats', 'Hide Stats')}
                ${row('events', "Hide Events (games I'm in)")}
            </div>
        </div>
        ${btn('fa-right-from-bracket', 'Log Out', 'handleLogout()', 'text-orange-400', 'border-orange-500/40')}
        ${btn('fa-trash-can', 'Delete Profile', "document.getElementById('profile-settings-modal').remove(); confirmDeleteAccountPrompt()", 'text-red-400', 'border-red-500/40')}
    </div>`;
    document.body.appendChild(m);
    if (window.renderOwnerTools) window.renderOwnerTools();
    if (window.renderSafetySlot) window.renderSafetySlot();
};
window.savePrivacy = async function (key, hidden) {
    const uid = window.currentUser?.uid; if (!uid) return;
    try {
        await setDoc(doc(db, 'artifacts', appId, 'directory', uid), { uid, privacy: { [key]: !!hidden } }, { merge: true });
        if (window.showToast) window.showToast(hidden ? 'Hidden from other players' : 'Visible to other players');
    } catch (e) {
        if (window.showToast) window.showToast("Couldn't save. Check your connection.", 'error');
    }
};

// ---------------- Another player's page ----------------
/** Tabs for the player page (player-stats.js builds the header + Message / Add friend). */
export function playerPageTabsHtml() {
    return `${tabsBar('pp-tabs', [['player', 'Player info'], ['stats', 'Stats'], ['events', 'Events'], ['basic', 'Basic info']], 'player', 'playerPageTab')}
        <div id="pp-tab-body" class="space-y-3"><div class="text-center text-xs text-white/40 py-6">Loading…</div></div>`;
}
let PAGE = null;   // { uid, name, avatar, communityId, data }
export async function mountPlayerPage(uid, name, avatar, communityId) {
    PAGE = { uid, name, avatar, communityId, data: null };
    try {
        const s = await getDoc(doc(db, 'artifacts', appId, 'directory', uid));
        if (PAGE && PAGE.uid === uid) PAGE.data = s.exists() ? s.data() : {};
    } catch (e) { if (PAGE) PAGE.data = {}; }
    window.playerPageTab('player');
}
window.playerPageTab = (tab) => {
    const box = document.getElementById('pp-tab-body'); if (!box || !PAGE) return;
    markTabs('pp-tabs', tab);
    const d = PAGE.data || {};
    const isMe = PAGE.uid === window.currentUser?.uid;
    const mineOrMe = isMe ? { ...d, ...(window.userProfile || {}) } : d;
    const priv = privacyOf(d);
    const first = String(PAGE.name || 'This player').split(' ')[0];
    if (!isMe && priv[tab]) { box.innerHTML = privateNote(first); return; }
    if (tab === 'stats') {
        box.innerHTML = '<div id="player-stats-sheet-box"></div>';
        if (window.mountPlayerStats) window.mountPlayerStats('player-stats-sheet-box', PAGE.uid, { name: PAGE.name, avatar: PAGE.avatar, communityId: PAGE.communityId });
    } else if (tab === 'events') {
        wireGames(PAGE.uid, 'pp');
        box.innerHTML = gamesBlock(PAGE.uid, 'pp');
    } else if (tab === 'basic') {
        box.innerHTML = `<div class="space-y-2">
            ${infoTile('fa-id-badge', 'Nickname', mineOrMe.nickname || '')}
            ${infoTile('fa-cake-candles', 'Birthday', prettyDob(mineOrMe.dob, isMe))}
            ${infoTile('fa-venus-mars', 'Gender', mineOrMe.gender || '')}
        </div>`;
    } else {
        box.innerHTML = playerInfoHtml(mineOrMe, 'pv');
    }
};
