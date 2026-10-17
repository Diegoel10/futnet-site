// js/wa-chat.js: WhatsApp-style messages, shared by private chats, community chat and game comments.
//   - green bubbles for you, dark bubbles for others, with the little "tail" on the first bubble of a run
//   - day separators (Today, Yesterday, Mon, Oct 5)
//   - in groups: each person's name in their own color, and their photo next to their messages
//   - time inside the bubble (bottom right) and ✓✓ ticks on your messages in private chats
//   - "Diego is typing…" / "Multiple people are typing…" with the bouncing dots
import { db, appId, app } from './firebase-config.js';
import { getStorage, ref as storageRef, uploadBytesResumable, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";
import { doc, setDoc, collection, query, where, onSnapshot } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js";

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DEFAULT_AVATAR = 'https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg';

// WhatsApp's group name colors (readable on the dark bubbles).
const NAME_COLORS = ['#25D366', '#53BDEB', '#FF8A65', '#FFD279', '#A78BFA', '#F472B6', '#34D399', '#60A5FA',
    '#FB7185', '#FBBF24', '#2DD4BF', '#C084FC', '#F97316', '#4ADE80', '#38BDF8', '#E879F9'];
export function nameColor(key) {
    let h = 0; const s = String(key || '');
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return NAME_COLORS[h % NAME_COLORS.length];
}

// ---- styles (added once)
(function addStyles() {
    if (document.getElementById('wa-chat-styles')) return;
    const st = document.createElement('style');
    st.id = 'wa-chat-styles';
    st.textContent = `
    .wa-wall { background-color: #0B141A; background-image: radial-gradient(rgba(255,255,255,0.025) 1px, transparent 1px); background-size: 18px 18px; }
    .wa-row { display: flex; align-items: flex-end; gap: 6px; padding: 0 6px; }
    .wa-row.me { justify-content: flex-end; }
    .wa-gap-s { margin-top: 2px; } .wa-gap-l { margin-top: 10px; }
    .wa-av { width: 28px; height: 28px; border-radius: 9999px; object-fit: cover; flex-shrink: 0; }
    .wa-av-space { width: 28px; flex-shrink: 0; }
    .wa-bubble { position: relative; max-width: min(78%, 520px); padding: 6px 9px 8px 9px; border-radius: 10px; color: #E9EDEF;
        font-size: 14px; line-height: 1.35; box-shadow: 0 1px 0.5px rgba(0,0,0,0.25); word-wrap: break-word; overflow-wrap: anywhere; }
    .wa-bubble.them { background: #202C33; }
    .wa-bubble.me { background: #005C4B; }
    .wa-bubble.tail.them { border-top-left-radius: 0; }
    .wa-bubble.tail.me { border-top-right-radius: 0; }
    .wa-bubble.tail.them::before { content: ''; position: absolute; top: 0; left: -7px; border-top: 0 solid transparent; border-right: 8px solid #202C33; border-bottom: 10px solid transparent; }
    .wa-bubble.tail.me::before { content: ''; position: absolute; top: 0; right: -7px; border-left: 8px solid #005C4B; border-bottom: 10px solid transparent; }
    .wa-name { font-size: 12.5px; font-weight: 700; margin-bottom: 1px; }
    .wa-text { white-space: pre-wrap; }
    .wa-meta { float: right; display: inline-flex; align-items: center; gap: 3px; margin: 6px 0 -4px 10px; font-size: 10.5px; color: rgba(233,237,239,0.6); white-space: nowrap; position: relative; top: 4px; }
    .wa-ticks { font-size: 12px; letter-spacing: -3px; font-weight: 700; color: rgba(233,237,239,0.6); }
    .wa-ticks.read { color: #53BDEB; }
    .wa-day { display: flex; justify-content: center; margin: 12px 0 6px; }
    .wa-day span { background: #182229; color: #8696A0; font-size: 11.5px; font-weight: 600; padding: 4px 10px; border-radius: 8px; box-shadow: 0 1px 0.5px rgba(0,0,0,0.2); }
    .wa-typing { display: inline-flex; align-items: center; gap: 4px; }
    .wa-typing i { width: 6px; height: 6px; border-radius: 9999px; background: #8696A0; display: inline-block; animation: waDot 1.2s infinite ease-in-out; }
    .wa-typing i:nth-child(2) { animation-delay: .15s; } .wa-typing i:nth-child(3) { animation-delay: .3s; }
    @keyframes waDot { 0%, 60%, 100% { transform: translateY(0); opacity: .5 } 30% { transform: translateY(-4px); opacity: 1 } }
    .wa-typing-label { font-size: 11px; color: #8696A0; margin-left: 6px; font-style: italic; }
    .wa-col { display: flex; flex-direction: column; align-items: flex-start; max-width: min(78%, 520px); min-width: 0; }
    .wa-row.me .wa-col { align-items: flex-end; }
    .wa-col > .wa-bubble { max-width: 100%; }
    .wa-deleted { font-style: italic; color: rgba(233,237,239,0.55); }
    .wa-edited { font-style: italic; margin-right: 2px; }
    .wa-reacts { margin-top: -5px; margin-left: 8px; margin-right: 8px; position: relative; z-index: 1; display: inline-flex; align-items: center; gap: 2px;
        background: #202C33; border: 1.5px solid #0B141A; border-radius: 9999px; padding: 1px 7px; font-size: 13px; color: #8696A0; cursor: pointer; }
    .wa-reacts.mine { background: #103529; }
    .wa-more { position: absolute; top: 2px; right: 4px; width: 22px; height: 22px; border-radius: 9999px; border: 0; color: rgba(233,237,239,0.8);
        background: inherit; font-size: 12px; opacity: 0; cursor: pointer; transition: opacity .15s; }
    .wa-bubble:hover .wa-more, .wa-more:focus-visible { opacity: 1; }
    @media (hover: none) { .wa-more { display: none; } }
    .wa-menu-wrap { position: fixed; inset: 0; z-index: 10001; background: rgba(0,0,0,.55); display: flex; align-items: flex-end; justify-content: center; padding: 16px; }
    @media (min-width: 640px) { .wa-menu-wrap { align-items: center; } }
    .wa-menu { width: 100%; max-width: 360px; background: #233138; border-radius: 16px; padding: 10px; color: #E9EDEF; box-shadow: 0 10px 30px rgba(0,0,0,.5); }
    .wa-menu .emojis { display: flex; justify-content: space-between; padding: 4px 2px 10px; border-bottom: 1px solid rgba(255,255,255,.08); }
    .wa-menu .emojis button { font-size: 24px; width: 40px; height: 40px; border-radius: 9999px; }
    .wa-menu .emojis button.on { background: rgba(37,211,102,.25); }
    .wa-menu .item { display: flex; gap: 12px; align-items: center; width: 100%; text-align: left; padding: 12px 10px; border-radius: 10px; font-size: 15px; }
    .wa-menu .item:hover { background: rgba(255,255,255,.06); }
    .wa-menu .item.danger { color: #F15C6D; }
    .wa-menu textarea { width: 100%; min-height: 90px; background: #2A3942; color: #E9EDEF; border-radius: 10px; padding: 10px; font-size: 16px; border: 0; outline: none; }
    `;
    document.head.appendChild(st);
})();

// ---- dates
const dayKey = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
function dayLabel(ms) {
    const d = new Date(ms); const now = new Date();
    const y = new Date(); y.setDate(now.getDate() - 1);
    if (dayKey(ms) === dayKey(now.getTime())) return 'Today';
    if (dayKey(ms) === dayKey(y.getTime())) return 'Yesterday';
    const diffDays = (now - d) / 86400000;
    if (diffDays < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}
const timeOf = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** Milliseconds from any of the shapes we save (Firestore time, number, "msg_<ms>_x" ids). */
export function msOf(m) {
    const t = m.createdAt ?? m.timestamp ?? m.at;
    if (t && typeof t.toMillis === 'function') return t.toMillis();
    if (t && typeof t.seconds === 'number') return t.seconds * 1000;
    if (typeof t === 'number') return t > 1e12 ? t : t * 1000;
    const fromId = String(m.id || '').match(/^msg_(\d{12,})/);
    if (fromId) return parseInt(fromId[1], 10);
    return 0;
}

// ---- edit / delete / react (the server checks who is allowed: see messageAction in functions)
export const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '⚽', '🔥'];
export const DELETED_TEXT = 'This message was deleted';
const msgRegistry = {};   // "kind|id|key" -> { text, mine, canModerate, myReaction }

/** Runs an edit / delete / react on any message. kind: 'dm' | 'community' | 'game'. */
export async function messageAction(kind, id, msgId, action, value) {
    const fn = httpsCallable(getFunctions(app, 'us-central1'), 'messageAction');
    return (await fn({ kind, id, msgId, action, value: value ?? '' })).data;
}

function reactionsHtml(reactions, myUid, key) {
    const r = reactions && typeof reactions === 'object' ? reactions : {};
    const all = Object.values(r).filter(Boolean);
    if (!all.length) return '';
    const counts = {};
    all.forEach(e => { counts[e] = (counts[e] || 0) + 1; });
    const emojis = Object.keys(counts).sort((a, b) => counts[b] - counts[a]).slice(0, 3).join('');
    return `<button type="button" class="wa-reacts ${r[myUid] ? 'mine' : ''}" onclick="waMsgMenu('${esc(key)}')" aria-label="Reactions">${emojis}${all.length > 1 ? `<span style="font-size:11px;margin-left:3px">${all.length}</span>` : ''}</button>`;
}

const closeMenu = () => document.getElementById('wa-msg-menu')?.remove();
function openSheet(inner) {
    closeMenu();
    const w = document.createElement('div');
    w.id = 'wa-msg-menu'; w.className = 'wa-menu-wrap';
    w.innerHTML = `<div class="wa-menu" role="dialog">${inner}</div>`;
    w.addEventListener('click', (e) => { if (e.target === w) closeMenu(); });
    document.body.appendChild(w);
    return w;
}
async function runAction(key, action, value) {
    const [kind, id, msgId] = key.split('|');
    closeMenu();
    try { await messageAction(kind, id, msgId, action, value); }
    catch (err) {
        console.error('messageAction', err);
        if (window.showToast) window.showToast(err && err.message && !/internal/i.test(err.message) ? err.message : "Couldn't do that. Try again.", 'error');
    }
}

/** The menu for one message: reactions, Copy, Edit (yours), Delete (yours, or admins). */
window.waMsgMenu = function(key) {
    const m = msgRegistry[key];
    if (!m) return;
    const w = openSheet(`
        <div class="emojis">${REACTIONS.map(e => `<button type="button" data-e="${e}" class="${m.myReaction === e ? 'on' : ''}">${e}</button>`).join('')}</div>
        ${m.text ? '<button type="button" class="item" data-a="copy"><i class="fa-regular fa-copy w-5"></i> Copy</button>' : ''}
        ${m.mine && m.text ? '<button type="button" class="item" data-a="edit"><i class="fa-solid fa-pen w-5"></i> Edit</button>' : ''}
        ${m.mine || m.canModerate ? '<button type="button" class="item danger" data-a="delete"><i class="fa-regular fa-trash-can w-5"></i> Delete</button>' : ''}`);
    w.querySelectorAll('[data-e]').forEach(b => b.onclick = () => runAction(key, 'react', b.dataset.e));
    w.querySelector('[data-a="copy"]')?.addEventListener('click', () => {
        try { navigator.clipboard.writeText(m.text); if (window.showToast) window.showToast('Copied'); } catch (e) { /* ignore */ }
        closeMenu();
    });
    w.querySelector('[data-a="delete"]')?.addEventListener('click', () => {
        const who = m.mine ? 'this message' : "this person's message";
        if (confirm(`Delete ${who} for everyone?`)) runAction(key, 'delete');
    });
    w.querySelector('[data-a="edit"]')?.addEventListener('click', () => {
        const e = openSheet(`
            <div style="font-weight:700;margin:2px 4px 8px">Edit message</div>
            <textarea id="wa-edit-text" maxlength="1000"></textarea>
            <div style="display:flex;gap:8px;margin-top:10px">
                <button type="button" class="item" style="justify-content:center;background:rgba(255,255,255,.06)" data-a="cancel">Cancel</button>
                <button type="button" class="item" style="justify-content:center;background:#00A884;color:#0B141A;font-weight:700" data-a="save">Save</button>
            </div>`);
        const ta = e.querySelector('#wa-edit-text');
        ta.value = m.text; ta.focus();
        e.querySelector('[data-a="cancel"]').onclick = closeMenu;
        e.querySelector('[data-a="save"]').onclick = () => {
            const t = ta.value.trim();
            if (!t) return;
            if (t === m.text) { closeMenu(); return; }
            runAction(key, 'edit', t);
        };
    });
};

// Long-press (phones) and right-click (computers) on a bubble open the same menu.
(function bindPress() {
    let timer = null;
    const keyOf = (t) => t && t.closest && t.closest('.wa-bubble[data-k]')?.dataset.k;
    document.addEventListener('contextmenu', (e) => {
        const k = keyOf(e.target);
        if (k && !e.target.closest('a,video')) { e.preventDefault(); window.waMsgMenu(k); }
    });
    document.addEventListener('touchstart', (e) => {
        const k = keyOf(e.target);
        if (!k) return;
        timer = setTimeout(() => { timer = null; window.waMsgMenu(k); }, 480);
    }, { passive: true });
    const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
    document.addEventListener('touchend', cancel); document.addEventListener('touchmove', cancel, { passive: true });
})();

/**
 * messages: [{ id, uid, name, avatar, text, ms, time, isRead, media?, key?, deleted?, edited?, reactions? }]
 * opts: { myUid, group (show names + photos of others), ticks (show ✓✓ on mine), avatarOf(uid, name, avatar),
 *         scope: { kind: 'dm' | 'community' | 'game', id, canModerate } to allow edit / delete / react }
 */
export function renderWhatsApp(messages, opts = {}) {
    const myUid = String(opts.myUid || '');
    const avatarOf = opts.avatarOf || ((uid, name, av) => av || DEFAULT_AVATAR);
    let html = '';
    let lastDay = '';
    let prev = null;
    messages.forEach((m, i) => {
        const ms = m.ms || 0;
        const mine = !!myUid && String(m.uid) === myUid;
        if (ms) {
            const k = dayKey(ms);
            if (k !== lastDay) { html += `<div class="wa-day"><span>${esc(dayLabel(ms))}</span></div>`; lastDay = k; prev = null; }
        }
        // A "run" = messages from the same person within 5 minutes: only the first gets the tail, name and photo.
        const startsRun = !prev || String(prev.uid) !== String(m.uid) || (ms && prev.ms && ms - prev.ms > 5 * 60000);
        const time = m.timeText || (ms ? timeOf(ms) : (m.time || ''));
        const ticks = mine && opts.ticks ? `<span class="wa-ticks ${m.isRead ? 'read' : ''}">✓✓</span>` : '';
        const name = !mine && opts.group && startsRun
            ? `<div class="wa-name" style="color:${nameColor(m.uid || m.name)}">${esc(m.name || 'Player')}</div>` : '';
        const photo = !mine && opts.group
            ? (startsRun ? `<img class="wa-av" src="${esc(avatarOf(m.uid, m.name, m.avatar))}" onerror="this.src='${DEFAULT_AVATAR}'" style="align-self:flex-start">` : '<span class="wa-av-space"></span>')
            : '';
        const deleted = m.deleted === true;
        const media = !deleted && m.media && m.media.url ? mediaHtml(m.media) : '';
        const caption = media && (m.text === MEDIA_LABEL.image || m.text === MEDIA_LABEL.video) ? '' : m.text;
        // Messages that can be edited / deleted / reacted to get a key and a menu button.
        const sc = opts.scope;
        const msgKey = m.key || m.id;
        const key = sc && sc.kind && sc.id && msgKey && !deleted && !String(msgKey).startsWith('app_') ? `${sc.kind}|${sc.id}|${msgKey}` : '';
        if (key) {
            const reacts = m.reactions && typeof m.reactions === 'object' ? m.reactions : {};
            msgRegistry[key] = { text: caption || '', mine, canModerate: !!sc.canModerate, myReaction: reacts[myUid] || '' };
        }
        const body = deleted
            ? `<span class="wa-text wa-deleted"><i class="fa-solid fa-ban" style="margin-right:5px"></i>${DELETED_TEXT}</span>`
            : `${media}<span class="wa-text">${esc(caption)}</span>`;
        const edited = m.edited && !deleted ? '<span class="wa-edited">Edited</span>' : '';
        html += `
            <div class="wa-row ${mine ? 'me' : ''} ${startsRun ? 'wa-gap-l' : 'wa-gap-s'}">
                ${photo}
                <div class="wa-col">
                    <div class="wa-bubble ${mine ? 'me' : 'them'} ${startsRun ? 'tail' : ''}" ${key ? `data-k="${esc(key)}"` : ''}>
                        ${name}${body}<span class="wa-meta">${edited}${esc(time)}${ticks}</span>
                        ${key ? `<button type="button" class="wa-more" aria-label="Message options" onclick="waMsgMenu('${esc(key)}')"><i class="fa-solid fa-chevron-down"></i></button>` : ''}
                    </div>
                    ${!deleted ? reactionsHtml(m.reactions, myUid, key) : ''}
                </div>
            </div>`;
        prev = { uid: m.uid, ms };
    });
    return html;
}

/** "Diego is typing…" / "Multiple people are typing…" / '' */
export function typingText(names) {
    const list = (names || []).filter(Boolean);
    if (!list.length) return '';
    if (list.length === 1) return `${list[0]} is typing…`;
    return 'Multiple people are typing…';
}

/** The bouncing-dots bubble shown at the bottom of the conversation. */
export function typingBubbleHtml(names) {
    const t = typingText(names);
    if (!t) return '';
    return `<div class="wa-row wa-gap-l"><div class="wa-bubble them tail" style="padding:10px 12px">
        <span class="wa-typing"><i></i><i></i><i></i></span><span class="wa-typing-label">${esc(t)}</span></div></div>`;
}

// ---- typing for group rooms (community chat "community:<id>", game comments "game:<id>")
// Saved in the same `typing` collection the private chats already use:
//   typing/{uid}__{room} -> { uid, name, room, isTyping, atMs }
const TYPING_TTL = 7000;

export function watchTyping(room, onChange) {
    const me = window.currentUser?.uid;
    let latest = [];
    const emit = () => {
        const now = Date.now();
        onChange(latest.filter(t => t.isTyping && t.uid !== me && now - (t.atMs || 0) < TYPING_TTL).map(t => t.name || 'Someone'));
    };
    const unsub = onSnapshot(query(collection(db, 'artifacts', appId, 'typing'), where('room', '==', room)),
        (snap) => { latest = snap.docs.map(d => d.data()); emit(); }, () => {});
    const timer = setInterval(emit, 2500);   // hides people who stopped typing without saying so
    return () => { unsub(); clearInterval(timer); };
}

const typingState = {};
export function reportTyping(room) {
    const user = window.currentUser; if (!user || !room) return;
    const p = window.userProfile || {};
    const name = p.name || `${p.firstName || ''} ${p.lastName || ''}`.trim() || 'Someone';
    const ref = doc(db, 'artifacts', appId, 'typing', `${user.uid}__${room.replace(/[\/]/g, '_')}`);
    const st = typingState[room] || (typingState[room] = { last: 0, timer: null });
    const now = Date.now();
    if (now - st.last > 3000) {            // at most one save every 3 seconds while typing
        st.last = now;
        setDoc(ref, { uid: user.uid, name, room, isTyping: true, atMs: now }).catch(() => {});
    }
    clearTimeout(st.timer);
    st.timer = setTimeout(() => stopTyping(room), 3500);
}

export function stopTyping(room) {
    const user = window.currentUser; if (!user || !room) return;
    const st = typingState[room]; if (st) { clearTimeout(st.timer); st.last = 0; }
    const ref = doc(db, 'artifacts', appId, 'typing', `${user.uid}__${room.replace(/[\/]/g, '_')}`);
    setDoc(ref, { uid: user.uid, room, isTyping: false, atMs: Date.now() }, { merge: true }).catch(() => {});
}

window.waChat = { renderWhatsApp, typingText, typingBubbleHtml, watchTyping, reportTyping, stopTyping, nameColor, msOf };

// ======================================================================================
// Photos & videos
//   Saved in Firebase Storage; the message keeps a small "media" record:
//   media: { type: 'image' | 'video', url, w, h, thumbUrl?, duration? }
//   The message text is the caption, or "📷 Photo" / "🎥 Video" when there is none
//   (so chat lists and notifications still read nicely).
// ======================================================================================

const storage = getStorage(app);
export const MEDIA_LABEL = { image: '📷 Photo', video: '🎥 Video' };
const MAX_VIDEO_BYTES = 60 * 1024 * 1024;
const MAX_IMAGE_SIDE = 1600;

const fileExt = (type) => ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' }[type] || (type.startsWith('video') ? 'mp4' : 'jpg'));

function loadImage(src) {
    return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}
function canvasBlob(canvas, q = 0.82) {
    return new Promise(res => canvas.toBlob(b => res(b), 'image/jpeg', q));
}

/** Photos are shrunk (max 1600px, JPEG) before upload, so they send fast. */
async function preparePhoto(file) {
    const url = URL.createObjectURL(file);
    try {
        const img = await loadImage(url);
        const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        return { blob: await canvasBlob(c), contentType: 'image/jpeg', w, h };
    } finally { URL.revokeObjectURL(url); }
}

/** Videos keep their quality; we read their size and grab a preview picture. */
async function prepareVideo(file) {
    if (file.size > MAX_VIDEO_BYTES) throw new Error('TOO_BIG');
    const url = URL.createObjectURL(file);
    try {
        const v = document.createElement('video');
        v.muted = true; v.playsInline = true; v.preload = 'metadata'; v.src = url;
        await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = rej; setTimeout(res, 8000); });
        const duration = Math.round(v.duration || 0);
        let poster = null;
        try {
            v.currentTime = Math.min(0.5, (v.duration || 1) / 2);
            await new Promise(res => { v.onseeked = res; setTimeout(res, 4000); });
            const scale = Math.min(1, 720 / Math.max(v.videoWidth || 1, v.videoHeight || 1));
            const c = document.createElement('canvas');
            c.width = Math.round((v.videoWidth || 640) * scale); c.height = Math.round((v.videoHeight || 360) * scale);
            c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
            poster = await canvasBlob(c, 0.75);
        } catch (e) { /* no preview picture */ }
        return { blob: file, contentType: file.type || 'video/mp4', w: v.videoWidth || 0, h: v.videoHeight || 0, duration, poster };
    } finally { URL.revokeObjectURL(url); }
}

function uploadBlob(path, blob, contentType, onProgress) {
    return new Promise((resolve, reject) => {
        const task = uploadBytesResumable(storageRef(storage, path), blob, { contentType, cacheControl: 'public, max-age=31536000' });
        task.on('state_changed',
            s => onProgress && onProgress(s.bytesTransferred / (s.totalBytes || 1)),
            reject,
            async () => resolve(await getDownloadURL(task.snapshot.ref)));
    });
}

/**
 * Uploads a picked photo/video and returns the media record for the message.
 * folder: 'chat/<conversation>' | 'community/<id>' | 'comments/<eventId>'
 */
export async function uploadMedia(file, folder, onProgress) {
    const uid = window.currentUser?.uid;
    if (!uid) throw new Error('SIGNED_OUT');
    const isVideo = String(file.type).startsWith('video/');
    if (!isVideo && !String(file.type).startsWith('image/')) throw new Error('NOT_MEDIA');
    const stamp = Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const base = `${folder}/${uid}/${stamp}`;

    if (!isVideo) {
        const p = await preparePhoto(file);
        const url = await uploadBlob(`${base}.jpg`, p.blob, p.contentType, onProgress);
        return { type: 'image', url, w: p.w, h: p.h };
    }
    const p = await prepareVideo(file);
    let thumbUrl = '';
    if (p.poster) { try { thumbUrl = await uploadBlob(`${base}_thumb.jpg`, p.poster, 'image/jpeg'); } catch (e) { /* ok without */ } }
    const url = await uploadBlob(`${base}.${fileExt(p.contentType)}`, p.blob, p.contentType, onProgress);
    return { type: 'video', url, w: p.w, h: p.h, duration: p.duration, ...(thumbUrl ? { thumbUrl } : {}) };
}

/** Friendly message for a failed upload. */
export function mediaErrorText(err) {
    const m = String(err && (err.message || err.code) || '');
    if (m === 'TOO_BIG') return 'That video is too big (max 60 MB). Try a shorter clip.';
    if (m === 'NOT_MEDIA') return 'Only photos and videos can be sent.';
    if (m.includes('unauthorized')) return 'Upload not allowed. Storage rules may not be set up yet.';
    return 'Could not send the file. Please try again.';
}

// ---- a small "Sending… 45%" pill
export function showUploadProgress(label, pct) {
    let el = document.getElementById('wa-upload-pill');
    if (!el) {
        el = document.createElement('div'); el.id = 'wa-upload-pill';
        el.style.cssText = 'position:fixed;left:50%;bottom:96px;transform:translateX(-50%);z-index:9999;background:#202C33;color:#E9EDEF;font-size:12px;font-weight:700;padding:8px 14px;border-radius:9999px;box-shadow:0 4px 14px rgba(0,0,0,.4);border:1px solid rgba(255,255,255,.1)';
        document.body.appendChild(el);
    }
    el.textContent = `${label}${pct != null ? ' ' + Math.round(pct * 100) + '%' : ''}`;
}
export function hideUploadProgress() { document.getElementById('wa-upload-pill')?.remove(); }

/**
 * Adds a 📎 button right before an input. onFile(file) is called with the picked photo/video.
 * Safe to call on every render: only adds it once.
 */
export function addAttachButton(inputEl, onFile) {
    if (!inputEl || inputEl.dataset.waAttach === '1') return;
    inputEl.dataset.waAttach = '1';
    const picker = document.createElement('input');
    picker.type = 'file'; picker.accept = 'image/*,video/*'; picker.style.display = 'none';
    picker.addEventListener('change', () => { const f = picker.files && picker.files[0]; picker.value = ''; if (f) onFile(f); });
    const btn = document.createElement('button');
    btn.type = 'button'; btn.title = 'Send a photo or video'; btn.setAttribute('aria-label', 'Send a photo or video');
    btn.innerHTML = '<i class="fa-solid fa-paperclip"></i>';
    btn.style.cssText = 'width:40px;height:40px;flex-shrink:0;border-radius:9999px;display:flex;align-items:center;justify-content:center;color:#8696A0;font-size:18px;background:transparent';
    btn.addEventListener('click', () => picker.click());
    inputEl.parentNode.insertBefore(btn, inputEl);
    inputEl.parentNode.insertBefore(picker, inputEl);
}

// ---- inside the bubble
const fmtDuration = (s) => s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '';
export function mediaHtml(media) {
    if (!media || !media.url) return '';
    const ratio = media.w && media.h ? Math.max(0.5, Math.min(1.6, media.h / media.w)) : 0.75;
    const w = 260, h = Math.round(w * ratio);
    const box = `display:block;width:min(${w}px,62vw);aspect-ratio:${w}/${h};border-radius:8px;overflow:hidden;position:relative;background:#111B21;cursor:pointer;margin:-3px -6px 4px -6px`;
    const open = `waOpenMedia('${media.type}', '${esc(media.url)}')`;
    if (media.type === 'video') {
        return `<span style="${box}" onclick="${open}">
            ${media.thumbUrl ? `<img src="${esc(media.thumbUrl)}" style="width:100%;height:100%;object-fit:cover">` : '<span style="position:absolute;inset:0;background:#000"></span>'}
            <span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center">
                <span style="width:52px;height:52px;border-radius:9999px;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;color:#fff;font-size:20px"><i class="fa-solid fa-play" style="margin-left:3px"></i></span></span>
            ${media.duration ? `<span style="position:absolute;left:8px;bottom:6px;font-size:11px;color:#fff;text-shadow:0 1px 2px #000"><i class="fa-solid fa-video" style="margin-right:4px"></i>${fmtDuration(media.duration)}</span>` : ''}
        </span>`;
    }
    return `<span style="${box}" onclick="${open}"><img src="${esc(media.url)}" loading="lazy" style="width:100%;height:100%;object-fit:cover"></span>`;
}

/** Full-screen viewer, like tapping a photo in WhatsApp. */
window.waOpenMedia = function(type, url) {
    document.getElementById('wa-media-viewer')?.remove();
    const el = document.createElement('div');
    el.id = 'wa-media-viewer';
    el.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.95);display:flex;align-items:center;justify-content:center';
    el.innerHTML = `
        <button aria-label="Close" style="position:absolute;top:14px;right:14px;width:40px;height:40px;border-radius:9999px;background:rgba(255,255,255,.12);color:#fff;font-size:18px"><i class="fa-solid fa-xmark"></i></button>
        <a href="${esc(url)}" target="_blank" rel="noopener" download aria-label="Open original" style="position:absolute;top:14px;right:64px;width:40px;height:40px;border-radius:9999px;background:rgba(255,255,255,.12);color:#fff;font-size:16px;display:flex;align-items:center;justify-content:center"><i class="fa-solid fa-download"></i></a>
        ${type === 'video'
            ? `<video src="${esc(url)}" controls autoplay playsinline style="max-width:96vw;max-height:88vh;border-radius:6px"></video>`
            : `<img src="${esc(url)}" style="max-width:96vw;max-height:90vh;object-fit:contain">`}`;
    el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('button')) el.remove(); });
    document.body.appendChild(el);
};

Object.assign(window.waChat, { messageAction, uploadMedia, mediaHtml, addAttachButton, showUploadProgress, hideUploadProgress, mediaErrorText, MEDIA_LABEL });