// js/game-profile/event-store.js
// One safe way to change a game: read the LIVE document, apply the change, write only what changed.
// (Before, every action wrote the whole local copy of the game, so a stale screen could overwrite
// other people's joins, goals or team changes.)
import { db, appId } from '../firebase-config.js';
import { doc, runTransaction } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

export function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    ));
}

// Only plain http(s) photo links that are small enough to live inside a game document.
export function safeAvatar(url) {
    return (typeof url === 'string' && /^https?:\/\//i.test(url) && url.length <= 200) ? url : '';
}

export function stripBigPhotos(value) {
    if (Array.isArray(value)) return value.map(stripBigPhotos);
    if (value && typeof value === 'object') {
        const clean = {};
        Object.keys(value).forEach(key => {
            const v = value[key];
            const isPhotoKey = key === 'avatar' || key === 'photoURL' || key === 'profilePicture' || key === 'image' || key === 'thumbnail';
            if (typeof v === 'string' && (v.startsWith('data:') || v.includes('base64') || v.length > 500)) return;
            if (isPhotoKey && typeof v === 'string' && v.length > 200) return;
            if (v === undefined) return;
            clean[key] = stripBigPhotos(v);
        });
        return clean;
    }
    return value;
}

export function eventDocRef(eventId) {
    const realDocId = (window.eventDocIds && window.eventDocIds[eventId]) || eventId;
    return doc(db, 'artifacts', appId, 'eventsList', String(realDocId));
}

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// mutator(draft) edits `draft` in place. Return false to cancel without writing.
// Resolves { ok, event, aborted }.
// `hooks` (optional) lets one change also touch other documents in the SAME transaction
// (used for community credit): hooks.read(tx) runs before any write and returns a context,
// the mutator receives it as 2nd argument, hooks.write(tx, draft, ctx) runs only if the game is saved.
export async function mutateEvent(eventId, mutator, hooks) {
    const ref = eventDocRef(eventId);
    try {
        const result = await runTransaction(db, async (tx) => {
            const snap = await tx.get(ref);
            if (!snap.exists()) throw new Error('GAME_NOT_FOUND');
            const before = snap.data();
            const draft = JSON.parse(JSON.stringify(before));
            const ctx = hooks && hooks.read ? await hooks.read(tx, before) : null;
            const verdict = await mutator(draft, ctx);
            if (verdict === false) return { aborted: true, event: before };

            const clean = stripBigPhotos(draft);
            const changed = {};
            Object.keys(clean).forEach(k => { if (!sameJson(clean[k], before[k])) changed[k] = clean[k]; });
            // keys the mutator deleted
            Object.keys(before).forEach(k => { if (!(k in clean)) changed[k] = null; });

            if (Object.keys(changed).length) {
                if (JSON.stringify(clean).length > 900000) throw new Error('GAME_TOO_LARGE');
                tx.update(ref, changed);
            }
            if (hooks && hooks.write) await hooks.write(tx, draft, ctx);
            return { aborted: false, event: { ...before, ...clean } };
        });

        if (!result.aborted) { applyLocal(eventId, result.event); redrawSoon(eventId); }
        return { ok: true, aborted: result.aborted, event: result.event };
    } catch (err) {
        console.error('mutateEvent failed:', err);
        if (typeof window.showToast === 'function') {
            window.showToast(
                err.message === 'GAME_NOT_FOUND' ? 'This game no longer exists.' :
                err.message === 'GAME_TOO_LARGE' ? 'Save failed: game data is too large.' :
                'Could not save. Please try again.', 'error');
        }
        return { ok: false, aborted: false, error: err };
    }
}

// Mirror a saved result into the in-memory list so the screen updates before the snapshot arrives.
export function applyLocal(eventId, fresh) {
    const list = window.eventsList || [];
    const local = list.find(ev => ev.id === eventId);
    if (!local) return;
    Object.assign(local, fresh); // never delete keys: the local copy may hold derived fields such as `id`
}

/** Show a saved change right away (e.g. a removed guest), instead of waiting for the live update from the server. */
function redrawSoon(eventId) {
    setTimeout(() => {
        try {
            if (window.activeModalEventId === eventId && window.renderEventDetailModalContent) {
                const act = (window.eventsList || []).find(ev => ev.id === eventId);
                window._activeEventSig = eventId + '|' + (act ? JSON.stringify(act) : '');
                window.renderEventDetailModalContent();
            }
            if (window.renderEvents) window.renderEvents();
        } catch (e) { /* the live update will redraw */ }
    }, 0);
}

window.mutateEvent = mutateEvent;

// ---------------------------------------------------------------- 📶 live match with bad / no internet
// The clock, goals and "save match" must work at a field with no signal. mutateEventLive():
//   1) applies the change to this phone's copy right away (screen + Game Stats update at once),
//   2) sends it to the server in the background, one change at a time, in order,
//   3) no signal: keeps the changes on this phone and retries until they go through ("Saved on this phone" badge).
//   While changes wait, server updates are shown WITH them on top (so nothing jumps back).
// The changes live in this page: closing the page before they sync loses them (the page warns you).
const outbox = [];                 // [{ eventId, mutator }]
let flushing = false, retryTimer = null;
const netError = (e) => /unavailable|offline|network|deadline|failed-precondition|internal|aborted|Failed to fetch/i.test(String((e && (e.code || '')) + ' ' + (e && e.message || e)));
const clone = (x) => JSON.parse(JSON.stringify(x));

/** Same as mutateEvent, but works offline. Resolves right away with the local result: { ok, aborted, event, queued }. */
export async function mutateEventLive(eventId, mutator) {
    const local = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!local) return mutateEvent(eventId, mutator);
    const draft = clone(local);
    let verdict;
    try { verdict = await mutator(draft); } catch (e) { console.error(e); return { ok: false, aborted: false, error: e }; }
    if (verdict === false) return { ok: true, aborted: true, event: local };
    applyLocal(eventId, draft);
    Object.keys(local).forEach(k => { if (!(k in draft)) delete local[k]; });
    redrawSoon(eventId);
    outbox.push({ eventId, mutator });
    showSyncBadge();
    flushOutbox();
    return { ok: true, aborted: false, event: local, queued: true };
}

async function sendOne(op) {
    const ref = eventDocRef(op.eventId);
    return runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error('GAME_NOT_FOUND');
        const before = snap.data();
        const draft = clone(before);
        if (await op.mutator(draft) === false) return { aborted: true, event: before };
        const clean = stripBigPhotos(draft), changed = {};
        Object.keys(clean).forEach(k => { if (!sameJson(clean[k], before[k])) changed[k] = clean[k]; });
        Object.keys(before).forEach(k => { if (!(k in clean)) changed[k] = null; });
        if (Object.keys(changed).length) tx.update(ref, changed);
        return { aborted: false, event: { ...before, ...clean } };
    });
}

async function flushOutbox() {
    if (flushing || !outbox.length) return;
    if (navigator.onLine === false) { showSyncBadge(); return; }   // the 'online' event starts it again
    flushing = true;
    clearTimeout(retryTimer);
    try {
        while (outbox.length) {
            const op = outbox[0];
            let r;
            try { r = await sendOne(op); }
            catch (e) {
                if (e && e.message === 'GAME_NOT_FOUND') { outbox.splice(0, outbox.length, ...outbox.filter(x => x.eventId !== op.eventId)); continue; }
                if (netError(e)) { retryTimer = setTimeout(flushOutbox, 5000); break; }
                console.error('live change not saved', e);
                outbox.shift();
                window.showToast && window.showToast('One change could not be saved. Check the score.', 'error');
                continue;
            }
            outbox.shift();
            // the server copy + whatever is still waiting on this phone
            const fresh = clone(r.event);
            for (const w of outbox) if (w.eventId === op.eventId) { try { await w.mutator(fresh); } catch (e) { /* ignore */ } }
            const local = (window.eventsList || []).find(ev => ev.id === op.eventId);
            if (local) { Object.assign(local, fresh); redrawSoon(op.eventId); }
        }
    } finally { flushing = false; showSyncBadge(); }
}

/** games.js calls this with every server update: put the changes still waiting on top. */
window.overlayPendingLive = function (list) {
    if (!outbox.length) return;
    list.forEach((ev, i) => {
        const mine = outbox.filter(op => op.eventId === ev.id);
        if (!mine.length) return;
        const d = clone(ev);
        mine.forEach(op => { try { op.mutator(d); } catch (e) { /* ignore */ } });
        list[i] = d;
    });
};
window.liveChangesWaiting = () => outbox.length;

// VS live taps are plain Firestore writes (they wait on the phone by themselves): counted here for the badge.
const extra = new Set();
export function trackLiveWrite(p) {
    extra.add(p); showSyncBadge();
    Promise.resolve(p).catch(() => {}).finally(() => { extra.delete(p); showSyncBadge(); });
    return p;
}
const waiting = () => outbox.length + extra.size;
let badgeTimer = null;
function showSyncBadge() {
    let b = document.getElementById('live-sync-badge');
    const n = waiting();
    if (!n) {
        clearTimeout(badgeTimer); badgeTimer = null;
        if (b && b.dataset.state !== 'done') {
            b.dataset.state = 'done';
            b.innerHTML = '✅ Synced';
            b.style.background = '#064e3b';
            setTimeout(() => { if (!waiting()) b.remove(); }, 2200);
        }
        return;
    }
    const off = navigator.onLine === false;
    // good signal: changes save in a blink, no badge. Only show it when offline or when it's taking a while.
    if (!b && !off) { if (!badgeTimer) badgeTimer = setTimeout(() => { badgeTimer = null; if (waiting()) drawBadge(true); }, 2500); return; }
    drawBadge(false);
}
function drawBadge(force) {
    const n = waiting(); if (!n) return;
    let b = document.getElementById('live-sync-badge');
    if (!b) {
        b = document.createElement('div');
        b.id = 'live-sync-badge';
        b.style.cssText = 'position:fixed;left:50%;top:calc(env(safe-area-inset-top,0px) + 8px);transform:translateX(-50%);z-index:100000;padding:6px 12px;border-radius:9999px;font:800 12px Inter,system-ui,sans-serif;color:#fff;box-shadow:0 6px 18px rgba(0,0,0,.5);pointer-events:none;max-width:94vw;text-align:center';
        document.body.appendChild(b);
    }
    b.dataset.state = 'wait';
    const off = navigator.onLine === false;
    b.style.background = off ? '#92400e' : '#1e3a8a';
    b.innerHTML = `${off ? '📶 No signal' : '⏳ Weak signal'}: ${n} change${n === 1 ? '' : 's'} saved on this phone. They sync by themselves. Keep this page open.`;
}
window.trackLiveWrite = trackLiveWrite;
window.addEventListener('online', () => { showSyncBadge(); flushOutbox(); });
window.addEventListener('offline', showSyncBadge);
window.addEventListener('beforeunload', (e) => { if (waiting()) { e.preventDefault(); e.returnValue = 'Some match changes are not saved yet.'; return e.returnValue; } });

// Remove a player and/or their guests from every team structure of a game draft.
// Guest uid format: `${hostUid}_guest_${index}`.
// pruneTeamsForUid(draft, uid)                      -> remove the player and all guests
// pruneTeamsForUid(draft, uid, { keepHost: true, keepGuests: n }) -> keep the player and guests 0..n-1
export function pruneTeamsForUid(draft, uid, opts = {}) {
    const id = String(uid);
    const keepHost = !!opts.keepHost;
    const keepGuests = opts.keepGuests || 0;
    const shouldDrop = (u) => {
        const s = String(u ?? '');
        if (s === id) return !keepHost;
        if (s.startsWith(id + '_guest_')) {
            const n = parseInt(s.slice(id.length + 7), 10);
            return !(n < keepGuests);
        }
        return false;
    };
    const ta = draft.teamAssignments;
    if (ta && typeof ta === 'object') {
        Object.keys(ta).forEach(k => {
            if (Array.isArray(ta[k])) ta[k] = ta[k].filter(p => !shouldDrop(p && p.uid));
        });
    }
    const ts = draft.teamSlots;
    if (ts && typeof ts === 'object') {
        Object.keys(ts).forEach(k => {
            const slots = ts[k] || {};
            Object.keys(slots).forEach(sl => { if (shouldDrop(slots[sl])) delete slots[sl]; });
        });
    }
    const caps = draft.teamCaptains;
    if (caps && typeof caps === 'object') {
        Object.keys(caps).forEach(k => { if (shouldDrop(caps[k])) delete caps[k]; });
    }
}

// For a value placed inside a quoted JS string in an inline handler: onclick="f('${jsArg(name)}')"
export function jsArg(value) {
    return escapeHtml(String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/[\r\n]+/g, ' '));
}

// Own goals: saved in the scoring team's goal list as "Own goal (Name)". The score counts them;
// player stats (top scorers, leaderboard) skip them. Same text on the website, iPhone and Android.
export const ownGoalLabel = (name) => `Own goal (${String(name || 'Player').trim()})`;
// "Unknown scorer" = Don't recall / someone else: counts for the team, for no player (same as an own goal).
export const UNKNOWN_SCORER = 'Unknown scorer';
export const isOwnGoal = (g) => /^(own goal|unknown scorer)\b/i.test(String((g && typeof g === 'object') ? (g.name || g.scorer || '') : (g || '')).trim());
