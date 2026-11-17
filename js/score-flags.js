// js/score-flags.js: 🚩 a team captain flags a score they think is wrong (regular games and VS matches).
//   Captain (or any player, if the organizer allows it): "🚩 Wrong score?" under a saved match → a note + (optional) the score they think it was.
//   Organizer (Admin tab): flags ON / OFF for the game, the list of flags (Fixed / Dismiss), and
//   "🚫 Stop this captain" for someone who keeps flagging for no reason (Unblock any time).
//   Saved on the server (flagScore / scoreFlags). The organizer also gets a notification.
//   doc.scoreFlags = { off: true|false, banned: [uid], who: 'captains' | 'players', hours: 1 (0 = no limit) }
//     who:   captains only (default), or any player in the game
//     hours: how long after a match ends people can still flag it (default 1 hour)
import { app } from './firebase-config.js';
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js";

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const jsq = (v) => String(v ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const toast = (m, t) => window.showToast && window.showToast(m, t);
const fn = (name) => httpsCallable(getFunctions(app, 'us-central1'), name);
const me = () => (window.currentUser && window.currentUser.uid) || '';
const errText = (e) => String((e && e.message) || e || '').replace(/^.*?:\s*/, '') || "Couldn't send it.";

export const flagsOn = (doc) => !(doc && doc.scoreFlags && doc.scoreFlags.off);
/** The organizer's settings, with the defaults filled in. */
export function flagSettings(doc) {
    const f = (doc && doc.scoreFlags) || {};
    const h = Number(f.hours);
    return { off: !!f.off, banned: f.banned || [], who: f.who === 'players' ? 'players' : 'captains', hours: Number.isFinite(h) && h >= 0 ? h : 1 };
}
/** Can I flag a match that ended at `endedAt` (ms)? me = { captain, player } */
export function canFlagMatch(doc, endedAt, me) {
    const f = flagSettings(doc);
    if (f.off || flagBanned(doc)) return false;
    if (!(me.captain || (f.who === 'players' && me.player))) return false;
    if (f.hours && endedAt && Date.now() - endedAt > f.hours * 3600000) return false;
    return true;
}
const WINDOWS = [[0.5, '30 min'], [1, '1 hour'], [3, '3 hours'], [24, '1 day'], [0, 'No limit']];
const windowName = (h) => (WINDOWS.find(w => w[0] === h) || [h, h + ' hours'])[1];
/** A regular game's player (signed up or on a team). */
export function isEventPlayer(ev, uid = me()) {
    if (!ev || !uid) return false;
    if ((ev.attendees || []).some(a => a && String(a.uid) === String(uid))) return true;
    return Object.values(ev.teamAssignments || {}).some(list => (list || []).some(p => p && String(p.uid) === String(uid)));
}
/** When a saved match ended (ms), or 0 if we can't tell. */
export function matchEndedAt(m) {
    const t = (m && (m.endedAt || m.at || m.timestamp)) || 0;
    return typeof t === 'number' ? t : (Date.parse(t) || 0);
}
export const flagBanned = (doc, uid = me()) => !!(doc && doc.scoreFlags && (doc.scoreFlags.banned || []).includes(uid));

/** A regular game's captain (Team builder captains). */
export function isEventCaptain(ev, uid = me()) {
    if (!ev || !uid) return false;
    if (Object.values(ev.teamCaptains || {}).map(String).includes(String(uid))) return true;
    return (ev.attendees || []).some(a => a && String(a.uid) === String(uid) && a.isCaptain);
}

/** The small "🚩 Wrong score?" button under a saved match (only for captains, when flags are on). */
export function flagButtonHtml(kind, id, matchIndex, label, show) {
    if (!show) return '';
    return `<button onclick="event.stopPropagation(); openFlagScore('${kind}', '${esc(jsq(id))}', ${matchIndex}, '${esc(jsq(label))}')" class="text-[10px] font-bold text-amber-300/90 hover:text-amber-200 px-2 py-1 rounded-full border border-amber-400/30 bg-amber-400/5">🚩 Wrong score?</button>`;
}

window.openFlagScore = function (kind, id, matchIndex, label) {
    document.getElementById('flag-score-sheet')?.remove();
    const m = document.createElement('div');
    m.id = 'flag-score-sheet';
    m.className = 'fixed inset-0 z-[260] flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm sm:p-4';
    m.innerHTML = `<div class="bg-[#040E13] border border-amber-400/50 rounded-t-3xl sm:rounded-3xl w-full max-w-md p-5 space-y-3 text-white" onclick="event.stopPropagation()">
        <div class="flex items-center justify-between"><div class="text-base font-black">🚩 Flag this score</div>
            <button onclick="document.getElementById('flag-score-sheet').remove()" class="w-8 h-8 rounded-full bg-black/60 border border-white/15"><i class="fa-solid fa-xmark text-xs"></i></button></div>
        <div class="text-sm font-bold bg-black/40 border border-white/10 rounded-xl px-3 py-2">${esc(label)}</div>
        <div class="text-[11px] text-white/60">The organizer gets it and can fix the score.</div>
        <div class="text-[10px] font-black uppercase tracking-wider text-white/60">What was the real score? (optional)</div>
        <div class="flex items-center gap-2"><input id="fs-a" type="number" min="0" max="99" inputmode="numeric" class="w-20 bg-black/60 border border-white/20 rounded-xl px-3 py-2 text-center font-black"><span class="font-black">-</span><input id="fs-b" type="number" min="0" max="99" inputmode="numeric" class="w-20 bg-black/60 border border-white/20 rounded-xl px-3 py-2 text-center font-black"></div>
        <textarea id="fs-note" maxlength="300" rows="3" placeholder="What's wrong? e.g. Juan's goal was ours, not theirs." class="w-full bg-black/60 border border-white/20 rounded-xl px-3 py-2 text-sm"></textarea>
        <button id="fs-go" class="w-full bg-amber-400 text-slate-950 font-black py-3 rounded-xl text-sm">Send to the organizer</button>
    </div>`;
    m.onclick = () => m.remove();
    document.body.appendChild(m);
    m.querySelector('#fs-go').onclick = async (e) => {
        const note = m.querySelector('#fs-note').value.trim(), a = m.querySelector('#fs-a').value, b = m.querySelector('#fs-b').value;
        if (!note && (a === '' || b === '')) { toast('Write what\'s wrong, or the real score.', 'error'); return; }
        e.currentTarget.disabled = true; e.currentTarget.textContent = 'Sending…';
        try {
            await fn('flagScore')({ kind, id, match: matchIndex, note, a, b });
            m.remove(); toast('Flag sent to the organizer 🚩');
        } catch (err) { toast(errText(err), 'error'); e.currentTarget.disabled = false; e.currentTarget.textContent = 'Send to the organizer'; }
    };
};

// ---------------------------------------------------------------- organizer: the Admin tab box
// save(settings) is given by the page (games: mutateEvent, VS: the match update) and resolves when saved.
const boxes = {};   // key -> { kind, id, doc, save }
export function adminFlagsHtml(kind, id) {
    return `<div id="score-flags-${kind}-${esc(id)}" class="bg-black/40 border border-amber-400/30 rounded-2xl p-3 space-y-2"><div class="text-[11px] font-black uppercase tracking-wider text-amber-300">🚩 Score flags</div><div class="text-xs text-white/50">Loading…</div></div>`;
}
/** Call after the Admin tab is on screen. */
export function mountAdminFlags(kind, id, doc, save) {
    const old = boxes[kind + id];
    boxes[kind + id] = { ...(old || {}), kind, id, doc, save };
    if (old && old.list && Date.now() - (old.at || 0) < 60000) { drawFlags(kind, id); return; }   // the Admin tab redraws often: ask the server at most once a minute
    loadFlags(kind, id);
}
async function loadFlags(kind, id, action) {
    const b = boxes[kind + id]; if (!b) return;
    let list = null;
    try { list = ((await fn('scoreFlags')({ kind, id, ...(action || {}) })).data || {}).list || []; } catch (e) { list = null; }
    b.list = list; b.at = Date.now(); drawFlags(kind, id);
}
function drawFlags(kind, id) {
    const b = boxes[kind + id], el = document.getElementById(`score-flags-${kind}-${id}`);
    if (!b || !el) return;
    const set = flagSettings(b.doc), on = !set.off, banned = set.banned;
    const chip = (active, onclick, label) => `<button onclick="${onclick}" class="px-2.5 py-1 rounded-full text-[10px] font-black ${active ? 'bg-amber-400 text-slate-950' : 'bg-black/60 border border-white/15 text-white/75'}">${label}</button>`;
    const open = (b.list || []).filter(f => f.status === 'open');
    const names = {}; (b.list || []).forEach(f => { names[f.uid] = f.name; });
    const k = `'${kind}', '${jsq(id)}'`;
    el.className = `bg-black/40 border ${open.length ? 'border-amber-400/70' : 'border-white/10'} rounded-2xl p-3 space-y-2`;
    el.innerHTML = `<div class="flex items-center justify-between gap-2">
            <div><div class="text-[11px] font-black uppercase tracking-wider text-amber-300">🚩 Score flags${open.length ? ` (${open.length} new)` : ''}</div>
            <div class="text-[10px] text-white/50">${on ? `${set.who === 'players' ? 'Any player' : 'Captains'} can tell you a score is wrong, up to ${set.hours ? windowName(set.hours) + ' after each match' : 'any time'}.` : 'Nobody can flag scores in this game.'}</div></div>
            <button onclick="setFlagsOn(${k}, ${!on})" class="shrink-0 px-3 py-1.5 rounded-full text-[11px] font-black ${on ? 'bg-[#00F296] text-slate-950' : 'bg-black/60 border border-white/20 text-white/70'}">${on ? 'ON' : 'OFF'}</button></div>
        ${on ? `<div class="space-y-1.5 pt-1">
            <div class="text-[10px] font-black uppercase tracking-wider text-white/55">Who can flag</div>
            <div class="flex flex-wrap gap-1.5">${chip(set.who === 'captains', `setFlagsOpt(${k}, 'who', 'captains')`, '🧢 Only captains')}${chip(set.who === 'players', `setFlagsOpt(${k}, 'who', 'players')`, '👥 Any player in the game')}</div>
            <div class="text-[10px] font-black uppercase tracking-wider text-white/55 pt-1">How long after a match</div>
            <div class="flex flex-wrap gap-1.5">${WINDOWS.map(([h, l]) => chip(set.hours === h, `setFlagsOpt(${k}, 'hours', ${h})`, l)).join('')}</div>
        </div>` : ''}
        ${b.list === null ? '<div class="text-xs text-white/50">Couldn\'t load the flags. Is the newest server code deployed?</div>' : ''}
        ${(b.list || []).map(f => `<div class="border-t border-white/10 pt-2 space-y-1 ${f.status === 'open' ? '' : 'opacity-50'}">
            <div class="flex items-center justify-between gap-2"><span class="text-xs font-black truncate">${esc(f.name || 'Captain')}</span><span class="text-[10px] text-white/45 shrink-0">${f.at ? esc(new Date(f.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })) : ''}</span></div>
            <div class="text-[11px] text-white/80">${esc(f.label)}${f.a !== null && f.a !== undefined && f.b !== null && f.b !== undefined ? ` <b class="text-amber-200">→ says ${f.a} - ${f.b}</b>` : ''}</div>
            ${f.note ? `<div class="text-[11px] text-white/65 italic">"${esc(f.note)}"</div>` : ''}
            ${f.status === 'open' ? `<div class="flex flex-wrap gap-1.5 pt-1">
                <button onclick="doneFlag(${k}, '${jsq(f.id)}', 'fixed')" class="px-2.5 py-1 rounded-full text-[10px] font-black bg-[#00F296] text-slate-950">✓ Fixed it</button>
                <button onclick="doneFlag(${k}, '${jsq(f.id)}', 'dismissed')" class="px-2.5 py-1 rounded-full text-[10px] font-bold bg-black/60 border border-white/20">Score is right</button>
                ${banned.includes(f.uid) ? '' : `<button onclick="banFlagger(${k}, '${jsq(f.uid)}', '${jsq(f.name || '')}', true)" class="px-2.5 py-1 rounded-full text-[10px] font-bold text-red-300 border border-red-400/30">🚫 Stop this person</button>`}</div>`
                : `<div class="text-[10px] text-white/50">${f.status === 'fixed' ? '✓ Fixed' : 'Dismissed'}</div>`}
        </div>`).join('') || (b.list ? '<div class="text-xs text-white/45">No flags. 👍</div>' : '')}
        ${banned.length ? `<div class="border-t border-white/10 pt-2 text-[11px] text-white/60">Can't flag: ${banned.map(u => `<span class="inline-flex items-center gap-1 mr-2">${esc(names[u] || 'someone')} <button onclick="banFlagger(${k}, '${jsq(u)}', '', false)" class="text-[#00F296] font-bold underline">Unblock</button></span>`).join('')}</div>` : ''}`;
}
async function saveSet(kind, id, next) {
    const b = boxes[kind + id]; if (!b || !b.save) return false;
    try { await b.save(next); b.doc = { ...(b.doc || {}), scoreFlags: next }; drawFlags(kind, id); return true; }
    catch (e) { toast("Couldn't save it.", 'error'); return false; }
}
window.setFlagsOn = async (kind, id, on) => {
    const b = boxes[kind + id]; if (!b) return;
    const cur = (b.doc && b.doc.scoreFlags) || {};
    if (await saveSet(kind, id, { ...flagSettings(b.doc), off: !on })) toast(on ? 'Score flags are ON 🚩' : 'Score flags are OFF for this game.');
};
window.setFlagsOpt = async (kind, id, key, value) => {
    const b = boxes[kind + id]; if (!b) return;
    if (await saveSet(kind, id, { ...flagSettings(b.doc), [key]: value })) toast('Saved ✅');
};
window.banFlagger = async (kind, id, uid, name, ban) => {
    const b = boxes[kind + id]; if (!b) return;
    if (ban && !confirm(`Stop ${name || 'this person'} from flagging scores in this game?`)) return;
    const cur = flagSettings(b.doc), list = new Set(cur.banned);
    if (ban) list.add(uid); else list.delete(uid);
    if (await saveSet(kind, id, { ...cur, banned: [...list] })) toast(ban ? 'They can\'t flag scores here any more.' : 'Unblocked.');
};
window.doneFlag = (kind, id, flagId, status) => loadFlags(kind, id, { flagId, status });
