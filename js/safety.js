// js/safety.js: Block / Report players and Mute notifications (same data as the iPhone and Android apps).
//
// Saved in artifacts/{appId}/users/{uid}/settings/safety:
//   blocked: { <uid>: { name, at } }           people I blocked
//   mutes:   { "game_<eventId>": untilMs,       no pushes for that match's comments until then
//              "cchat_<communityId>": untilMs } no pushes for that community chat until then
//   (always = MUTE_ALWAYS)
// Reports go to artifacts/{appId}/reports (the server tells the FutNet Admin account).
// The server reads the same doc: no pushes from blocked people, none for muted chats,
// and a private "heads up" when someone you blocked joins your game or community.
import { db, appId, auth } from './firebase-config.js';
import { doc, onSnapshot, setDoc, deleteField, addDoc, collection, getDocs, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";

export const MUTE_ALWAYS = 4102444800000;   // year 2100
const SAFE = { blocked: {}, mutes: {}, loaded: false };
window.futnetSafety = SAFE;
let unsub = null;
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const jsq = (v) => esc(String(v ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
const toast = (m, t) => window.showToast && window.showToast(m, t);
const myUid = () => (window.currentUser && window.currentUser.uid) || '';
const ref = () => doc(db, 'artifacts', appId, 'users', myUid(), 'settings', 'safety');

onAuthStateChanged(auth, (user) => {
    if (unsub) { unsub(); unsub = null; }
    SAFE.blocked = {}; SAFE.mutes = {}; SAFE.loaded = false;
    if (!user) return;
    unsub = onSnapshot(doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'safety'), (s) => {
        const d = (s.exists && s.exists()) ? s.data() : {};
        const before = JSON.stringify(Object.keys(SAFE.blocked).sort());
        SAFE.blocked = d.blocked && typeof d.blocked === 'object' ? d.blocked : {};
        SAFE.mutes = d.mutes && typeof d.mutes === 'object' ? d.mutes : {};
        SAFE.loaded = true;
        refreshMuteButtons();
        if (before !== JSON.stringify(Object.keys(SAFE.blocked).sort())) redrawEverything();
    }, () => {});
});

/** Redraw the screens that hide blocked people (chats, feed, game comments). */
function redrawEverything() {
    try { if (window.renderChatsList) window.renderChatsList(); } catch (e) { /* ignore */ }
    try { if (window.activeChatThreadId && window.renderActiveChatMessages && !String(window.activeChatThreadId).startsWith('community:')) window.renderActiveChatMessages(); } catch (e) { /* ignore */ }
    try { if (window.refreshCommunityChatView) window.refreshCommunityChatView(); } catch (e) { /* ignore */ }
    try { if (window.renderCommunityPageSafe) window.renderCommunityPageSafe(); } catch (e) { /* ignore */ }
    try { if (window.activeModalEventId && window.renderEventDetailModalContent) window.renderEventDetailModalContent(); } catch (e) { /* ignore */ }
    renderSafetySlot();
}

export function isBlocked(uid) { return !!uid && !!SAFE.blocked[String(uid)]; }
window.isBlocked = isBlocked;
window.blockedUids = () => Object.keys(SAFE.blocked);

// ---------------------------------------------------------------- small sheet (bottom on phones)
function sheet(html, id = 'safety-sheet') {
    document.getElementById(id)?.remove();
    const m = document.createElement('div');
    m.id = id;
    m.className = 'fixed inset-0 z-[400] bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-3';
    m.onclick = (e) => { if (e.target === m) m.remove(); };
    m.innerHTML = `<div class="bg-[#040E13] border border-white/15 rounded-3xl w-full max-w-sm p-4 space-y-2 text-white max-h-[88dvh] overflow-y-auto">${html}</div>`;
    document.body.appendChild(m);
    return m;
}
const closeSheet = (id = 'safety-sheet') => document.getElementById(id)?.remove();
window.closeSafetySheet = () => closeSheet();
const BASE_ROW = 'w-full flex items-center gap-3 text-left rounded-2xl px-4 py-3.5 text-sm font-bold';
const ROW = BASE_ROW + ' bg-white/5 hover:bg-white/10';

/**
 * ⋯ menu for a person: Block / Unblock and Report.
 * ctx (optional): { kind: 'profile'|'message'|'comment'|'post'|'chat', id, text, communityId, eventId }
 */
window.openBlockReport = function (uid, name, ctx = {}) {
    uid = String(uid || ''); name = String(name || 'this player');
    if (!uid || uid === myUid()) return;
    window._safetyCtx = { uid, name, ctx };
    const blocked = isBlocked(uid);
    sheet(`
        <div class="text-center pb-1"><div class="text-sm font-black truncate">${esc(name)}</div></div>
        ${blocked
            ? `<button onclick="unblockPlayer('${jsq(uid)}')" class="${ROW} text-[#00F296]"><i class="fa-solid fa-unlock w-5 text-center"></i> Unblock ${esc(name.split(' ')[0])}</button>`
            : `<button onclick="confirmBlockPlayer()" class="${ROW} text-red-400"><i class="fa-solid fa-ban w-5 text-center"></i> Block ${esc(name.split(' ')[0])}</button>`}
        <button onclick="openReportForm()" class="${ROW} text-amber-300"><i class="fa-solid fa-flag w-5 text-center"></i> Report${ctx.kind && ctx.kind !== 'profile' ? ' this ' + esc(ctx.kind === 'chat' ? 'player' : ctx.kind) : ''}</button>
        <button onclick="closeSafetySheet()" class="${ROW} justify-center text-white/70">Cancel</button>`);
};

window.confirmBlockPlayer = function () {
    const s = window._safetyCtx; if (!s) return;
    const first = esc(s.name.split(' ')[0]);
    sheet(`
        <div class="text-center space-y-2 pb-1">
            <div class="w-12 h-12 mx-auto rounded-full bg-red-500/15 text-red-400 flex items-center justify-center text-xl"><i class="fa-solid fa-ban"></i></div>
            <div class="text-base font-black">Block ${esc(s.name)}?</div>
        </div>
        <ul class="text-xs text-white/75 space-y-1.5 bg-black/40 border border-white/10 rounded-2xl p-3">
            <li>• You won't see ${first}'s messages, posts or comments.</li>
            <li>• You won't get notifications about anything ${first} does.</li>
            <li>• We'll give you a heads up if you're in the same game or community.</li>
            <li>• ${first} is <b>not</b> told that you blocked them.</li>
        </ul>
        <button onclick="blockPlayer()" class="${BASE_ROW} justify-center bg-red-500/90 hover:bg-red-500 text-white">Block</button>
        <button onclick="closeSafetySheet()" class="${ROW} justify-center text-white/70">Cancel</button>`);
};

window.blockPlayer = async function () {
    const s = window._safetyCtx; if (!s || !myUid()) return;
    try {
        await setDoc(ref(), { blocked: { [s.uid]: { name: s.name, at: Date.now() } } }, { merge: true });
        SAFE.blocked[s.uid] = { name: s.name, at: Date.now() };
        closeSheet();
        document.getElementById('player-profile-popup')?.remove();
        toast(`${s.name} is blocked.`);
        redrawEverything();
    } catch (e) { console.error(e); toast("Couldn't block. Check your connection.", 'error'); }
};

window.unblockPlayer = async function (uid) {
    uid = String(uid || ''); if (!uid || !myUid()) return;
    const name = (SAFE.blocked[uid] && SAFE.blocked[uid].name) || 'Player';
    try {
        await setDoc(ref(), { blocked: { [uid]: deleteField() } }, { merge: true });
        delete SAFE.blocked[uid];
        closeSheet();
        toast(`${name} is unblocked.`);
        redrawEverything();
        if (document.getElementById('blocked-list-sheet')) window.openBlockedList();
    } catch (e) { console.error(e); toast("Couldn't unblock. Check your connection.", 'error'); }
};

const REASONS = [
    ['spam', 'Spam or scam'],
    ['harassment', 'Bullying or harassment'],
    ['hate', 'Hate speech or threats'],
    ['inappropriate', 'Inappropriate photo, video or message'],
    ['fake', 'Fake profile'],
    ['other', 'Something else'],
];
window.openReportForm = function () {
    const s = window._safetyCtx; if (!s) return;
    sheet(`
        <div class="text-base font-black">Report ${esc(s.name)}</div>
        <p class="text-[11px] text-white/60">Tell us what's wrong. The FutNet team reviews every report. ${esc(s.name.split(' ')[0])} won't know who reported them.</p>
        <div class="space-y-1.5">${REASONS.map(([k, t], i) => `
            <label class="flex items-center gap-3 bg-white/5 rounded-xl px-3 py-2.5 cursor-pointer text-xs font-bold">
                <input type="radio" name="report-reason" value="${k}" ${i === 0 ? 'checked' : ''} class="accent-[#00F296] w-4 h-4"> ${t}</label>`).join('')}
        </div>
        <textarea id="report-note" maxlength="500" rows="3" placeholder="Anything else? (optional)"
            class="w-full bg-black/50 border border-white/15 rounded-xl px-3 py-2 text-base sm:text-xs text-white focus:outline-none focus:border-[#00F296]"></textarea>
        ${isBlocked(s.uid) ? '' : `<label class="flex items-center gap-2 text-xs font-bold px-1 cursor-pointer"><input type="checkbox" id="report-block" checked class="accent-red-500 w-4 h-4"> Also block ${esc(s.name.split(' ')[0])}</label>`}
        <button onclick="sendReport()" class="${BASE_ROW} justify-center bg-amber-400 hover:bg-amber-300 text-slate-950">Send report</button>
        <button onclick="closeSafetySheet()" class="${ROW} justify-center text-white/70">Cancel</button>`);
};

window.sendReport = async function () {
    const s = window._safetyCtx; if (!s || !myUid()) return;
    const reason = (document.querySelector('input[name="report-reason"]:checked') || {}).value || 'other';
    const note = String(document.getElementById('report-note')?.value || '').trim().slice(0, 500);
    const alsoBlock = !!document.getElementById('report-block')?.checked;
    const c = s.ctx || {};
    try {
        await addDoc(collection(db, 'artifacts', appId, 'reports'), {
            reporterUid: myUid(),
            reporterName: (window.userProfile && (window.userProfile.name || `${window.userProfile.firstName || ''} ${window.userProfile.lastName || ''}`.trim())) || '',
            targetUid: s.uid, targetName: s.name,
            reason, note,
            kind: c.kind || 'profile', itemId: String(c.id || ''), itemText: String(c.text || '').slice(0, 500),
            communityId: c.communityId || '', eventId: c.eventId || '',
            status: 'open', platform: 'web', createdAt: serverTimestamp(),
        });
        if (alsoBlock) await window.blockPlayer();
        closeSheet();
        toast('Thanks. Your report was sent to the FutNet team.');
    } catch (e) { console.error(e); toast("Couldn't send the report. Check your connection.", 'error'); }
};

// ---------------------------------------------------------------- Settings: Blocked players
export function renderSafetySlot() {
    const slot = document.getElementById('safety-slot'); if (!slot) return;
    const n = Object.keys(SAFE.blocked).length;
    slot.innerHTML = `<button onclick="openBlockedList()" class="w-full bg-[#07141E]/90 border border-[#00B4AE]/40 rounded-2xl p-3 flex items-center gap-3 text-left">
        <i class="fa-solid fa-ban w-5 text-center text-[#00B4AE]"></i><span class="text-xs font-bold text-white flex-1">Blocked players</span>
        <span class="text-[11px] font-bold text-white/50">${n}</span></button>`;
}
window.renderSafetySlot = renderSafetySlot;

window.openBlockedList = function () {
    const list = Object.entries(SAFE.blocked).sort((a, b) => ((b[1] && b[1].at) || 0) - ((a[1] && a[1].at) || 0));
    const photo = (uid, name) => window.resolvePlayerAvatar ? window.resolvePlayerAvatar({ uid, name }) : '';
    sheet(`
        <div class="flex items-center justify-between"><div class="text-base font-black">Blocked players</div>
            <button onclick="document.getElementById('blocked-list-sheet').remove()" class="w-8 h-8 rounded-full bg-white/10"><i class="fa-solid fa-xmark"></i></button></div>
        <p class="text-[11px] text-white/55">You don't see their messages, posts or comments, and you don't get notifications about them.</p>
        ${list.length ? list.map(([uid, v]) => `
            <div class="flex items-center gap-3 bg-white/5 rounded-xl p-2.5">
                <img src="${esc(photo(uid, v && v.name))}" onerror="this.src='https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg'" class="w-9 h-9 rounded-full object-cover">
                <span class="flex-1 min-w-0 text-xs font-bold truncate">${esc((v && v.name) || 'Player')}</span>
                <button onclick="unblockPlayer('${jsq(uid)}')" class="text-[11px] font-black text-[#00F296] border border-[#00F296]/50 rounded-full px-3 py-1.5">Unblock</button>
            </div>`).join('') : '<p class="text-xs text-white/45 text-center py-6">Nobody is blocked.</p>'}`, 'blocked-list-sheet');
};

// ---------------------------------------------------------------- Mute notifications
export function muteUntil(key) {
    const v = Number(SAFE.mutes[key] || 0);
    return v > Date.now() ? v : 0;
}
window.muteUntil = muteUntil;
function muteText(key) {
    const until = muteUntil(key);
    if (!until) return '<i class="fa-regular fa-bell mr-1.5"></i>Mute notifications';
    if (until >= MUTE_ALWAYS) return '<i class="fa-solid fa-bell-slash mr-1.5"></i>Muted';
    return `<i class="fa-solid fa-bell-slash mr-1.5"></i>Muted until ${esc(new Date(until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))}`;
}
/** A small "Mute notifications" button; it updates by itself when the setting changes. */
export function muteButtonHtml(key, what, extraClass = '') {
    return `<button type="button" data-mute-key="${esc(key)}" data-mute-what="${esc(what)}" onclick="openMuteSheet('${jsq(key)}', '${jsq(what)}')"
        class="text-[11px] font-bold rounded-full px-3 py-1.5 border transition ${muteUntil(key) ? 'text-amber-300 border-amber-400/50 bg-amber-400/10' : 'text-white/70 border-white/15 bg-black/30 hover:text-white'} ${extraClass}">${muteText(key)}</button>`;
}
window.muteButtonHtml = muteButtonHtml;
function refreshMuteButtons() {
    document.querySelectorAll('[data-mute-key]').forEach(b => {
        const k = b.dataset.muteKey;
        const on = !!muteUntil(k);
        b.innerHTML = muteText(k);
        b.classList.toggle('text-amber-300', on); b.classList.toggle('border-amber-400/50', on); b.classList.toggle('bg-amber-400/10', on);
        b.classList.toggle('text-white/70', !on); b.classList.toggle('border-white/15', !on); b.classList.toggle('bg-black/30', !on);
    });
}
window.refreshMuteButtons = refreshMuteButtons;
// "Muted until 3:45" turns back into "Mute notifications" when the time is up.
setInterval(refreshMuteButtons, 30000);

window.openMuteSheet = function (key, what) {
    const until = muteUntil(key);
    const hours = [1, 2, 3, 4, 5];
    sheet(`
        <div class="text-base font-black"><i class="fa-solid fa-bell-slash text-amber-300 mr-2"></i>Mute notifications</div>
        <p class="text-[11px] text-white/60">No notifications for new messages in ${esc(what)}. You can still read everything here.</p>
        ${until ? `<div class="text-[11px] font-bold text-amber-300">${until >= MUTE_ALWAYS ? 'Muted for good right now.' : 'Muted until ' + esc(new Date(until).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })) + '.'}</div>` : ''}
        <div class="grid grid-cols-5 gap-1.5">${hours.map(h => `<button onclick="setMute('${jsq(key)}', ${h})" class="rounded-xl py-3 bg-white/5 hover:bg-white/10 text-sm font-black">${h}h</button>`).join('')}</div>
        <button onclick="setMute('${jsq(key)}', 'always')" class="${ROW} justify-center">Always for ${esc(what)}</button>
        ${until ? `<button onclick="setMute('${jsq(key)}', 0)" class="${ROW} justify-center text-[#00F296]"><i class="fa-regular fa-bell"></i> Unmute</button>` : ''}
        <button onclick="closeSafetySheet()" class="${ROW} justify-center text-white/70">Cancel</button>`);
};

window.setMute = async function (key, hours) {
    if (!myUid() || !key) return;
    const until = hours === 'always' ? MUTE_ALWAYS : (hours ? Date.now() + hours * 3600000 : 0);
    try {
        await setDoc(ref(), { mutes: { [key]: until ? until : deleteField() } }, { merge: true });
        if (until) SAFE.mutes[key] = until; else delete SAFE.mutes[key];
        closeSheet();
        refreshMuteButtons();
        toast(!until ? 'Notifications are back on.' : hours === 'always' ? 'Muted. Unmute any time.' : `Muted for ${hours} hour${hours === 1 ? '' : 's'}.`);
    } catch (e) { console.error(e); toast("Couldn't save. Check your connection.", 'error'); }
};

// ---------------------------------------------------------------- Heads up before joining
function blockedIn(uids) {
    const seen = new Set();
    return uids.map(String).filter(u => u && u !== myUid() && isBlocked(u) && !seen.has(u) && seen.add(u))
        .map(u => (SAFE.blocked[u] && SAFE.blocked[u].name) || 'Someone');
}
function headsUp(names, where) {
    const who = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    return confirm(`Heads up: ${who}, who you blocked, ${names.length === 1 ? 'is' : 'are'} in ${where}.\n\nJoin anyway?`);
}
const uidOf = (p) => String((p && (p.uid || p.userId || p.id)) || '');

/** Wraps the join buttons once the other files have loaded (they're all on window). */
function wrapJoins() {
    const g = window.confirmJoinGameWithGuests;
    if (typeof g === 'function' && !g._safety) {
        const w = async function (eventId, guests) {
            const ev = (window.eventsList || []).find(e => String(e.id) === String(eventId)) || {};
            const names = blockedIn([...(ev.attendees || []), ...(ev.waitingList || [])].map(uidOf));
            if (names.length && !headsUp(names, 'this game')) return;
            return g.apply(this, arguments);
        };
        w._safety = true;
        window.confirmJoinGameWithGuests = w;
    }
    ['joinCommunity', 'requestJoinCommunity'].forEach(fn => {
        const f = window[fn];
        if (typeof f !== 'function' || f._safety) return;
        const w = async function (id) {
            if (Object.keys(SAFE.blocked).length) {
                try {
                    const snap = await getDocs(collection(db, 'artifacts', appId, 'communities', String(id), 'members'));
                    const c = (window.communitiesCache || {})[id] || {};
                    const names = blockedIn([c.creatorId || c.adminId || '', ...snap.docs.map(d => d.id)]);
                    if (names.length && !headsUp(names, c.name || 'this community')) return;
                } catch (e) { /* can't check: join anyway (the server still sends the heads up) */ }
            }
            return f.apply(this, arguments);
        };
        w._safety = true;
        window[fn] = w;
    });
    // Messaging someone you blocked: say so instead of opening the chat.
    const dm = window.openDirectChat;
    if (typeof dm === 'function' && !dm._safety) {
        const w = function (uid) {
            if (isBlocked(uid)) { toast('You blocked this player. Unblock them in Settings › Blocked players to message them.', 'error'); return; }
            return dm.apply(this, arguments);
        };
        w._safety = true;
        window.openDirectChat = w;
    }
}
setTimeout(wrapJoins, 0);
setTimeout(wrapJoins, 1500);
setTimeout(wrapJoins, 5000);

/** Little "Block or report" link for player cards. */
window.blockReportLinkHtml = function (uid, name, ctx = {}) {
    if (!uid || String(uid) === myUid() || String(uid).startsWith('manual_')) return '';
    const blocked = isBlocked(uid);
    return `<button type="button" onclick='openBlockReport(${JSON.stringify(String(uid)).replace(/'/g, "&#39;")}, ${JSON.stringify(String(name || "Player")).replace(/'/g, "&#39;")}, ${JSON.stringify(ctx).replace(/'/g, "&#39;")})'
        class="w-full text-center text-[11px] font-bold ${blocked ? 'text-[#00F296]' : 'text-white/45 hover:text-red-400'} py-1">
        <i class="fa-solid ${blocked ? 'fa-unlock' : 'fa-ban'} mr-1"></i>${blocked ? 'Blocked · Unblock or report' : 'Block or report'}</button>`;
};
