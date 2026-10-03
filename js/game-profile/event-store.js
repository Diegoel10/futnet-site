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
export async function mutateEvent(eventId, mutator) {
    const ref = eventDocRef(eventId);
    try {
        const result = await runTransaction(db, async (tx) => {
            const snap = await tx.get(ref);
            if (!snap.exists()) throw new Error('GAME_NOT_FOUND');
            const before = snap.data();
            const draft = JSON.parse(JSON.stringify(before));
            const verdict = await mutator(draft);
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
            return { aborted: false, event: { ...before, ...clean } };
        });

        if (!result.aborted) applyLocal(eventId, result.event);
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

window.mutateEvent = mutateEvent;

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