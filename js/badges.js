// js/badges.js: verified checkmarks next to names.
//   Blue  = real person (Diego saw them show up). Lapses after 60 days without a game with a real organizer.
//   Gold  = name and birthday checked (for tournaments). Their name and birthday are locked; nickname can change.
// Read from artifacts/{appId}/verifications/{uid} (only the server writes it, from futnet.site/manager).
import { db, appId } from './firebase-config.js';
import { collection, onSnapshot } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

window.verifiedMap = window.verifiedMap || {};
const SVG = (fill, title) => `<svg viewBox="0 0 24 24" width="1em" height="1em" aria-label="${title}" role="img" style="display:inline-block;vertical-align:-0.15em;margin-left:3px;flex-shrink:0"><title>${title}</title>
    <path fill="${fill}" d="M12 1.5l2.6 1.9 3.2-.2 1 3 2.6 1.9-1 3.1 1 3.1-2.6 1.9-1 3-3.2-.2L12 22.5l-2.6-1.9-3.2.2-1-3-2.6-1.9 1-3.1-1-3.1 2.6-1.9 1-3 3.2.2z"/>
    <path fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="M7.5 12.3l3 3 6-6.2"/></svg>`;
export const BLUE = '#1D9BF0', GOLD = '#E6B800';
/** 'gold' | 'blue' | '' for a player. */
export function badgeOf(uid) {
    const v = window.verifiedMap[String(uid || '')];
    if (!v) return '';
    if (v.gold) return 'gold';
    if (v.blue && (+v.blueUntil || 0) > Date.now()) return 'blue';
    return '';
}
/** The checkmark to put right after a name ('' when not verified). */
export function badgeHtml(uid) {
    const b = badgeOf(uid);
    return b === 'gold' ? SVG(GOLD, 'Verified: name and age checked') : b === 'blue' ? SVG(BLUE, 'Verified real player') : '';
}
window.badgeHtml = badgeHtml;
window.badgeOf = badgeOf;

let unsub = null, started = '';
function start() {
    if (unsub) unsub();
    unsub = onSnapshot(collection(db, 'artifacts', appId, 'verifications'), (s) => {
        const map = {};
        s.docs.forEach(d => { map[d.id] = d.data(); });
        window.verifiedMap = map;
        const me = window.currentUser && window.currentUser.uid;
        window.myVerification = me ? map[me] || null : null;
        lockGoldFields();
    }, () => {});
}
setInterval(() => { const u = window.currentUser && window.currentUser.uid; if (u && started !== u) { started = u; start(); } }, 1500);

// Names everywhere that already show the status emoji (rosters, members, player cards) get the check too.
(function wrapStatus() {
    const orig = window.statusEmoji;
    if (typeof orig !== 'function') { setTimeout(wrapStatus, 500); return; }
    if (orig._badge) return;
    const w = (uid) => badgeHtml(uid) + orig(uid);
    w._badge = true;
    window.statusEmoji = w;
})();

// Gold: name and birthday can't be edited (the nickname can).
function lockGoldFields() {
    const v = window.myVerification;
    if (!v || !v.gold) return;
    ['edit-firstname', 'edit-lastname', 'edit-dob'].forEach(id => {
        const el = document.getElementById(id);
        if (!el || el.dataset.goldLocked) return;
        el.readOnly = true; el.disabled = true; el.dataset.goldLocked = '1';
        el.style.opacity = '0.6';
        if (id === 'edit-firstname') el.insertAdjacentHTML('afterend', `<p class="text-[10px] mt-1" style="color:${GOLD}">${SVG(GOLD, 'Gold verified')} Your name and birthday are verified, so they can't be changed. You can still change your nickname.</p>`);
    });
}
new MutationObserver(() => { if (window.myVerification && window.myVerification.gold && document.getElementById('edit-firstname')) lockGoldFields(); })
    .observe(document.documentElement, { childList: true, subtree: true });
