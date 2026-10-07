// js/wa-chat.js: WhatsApp-style messages, shared by private chats, community chat and game comments.
//   - green bubbles for you, dark bubbles for others, with the little "tail" on the first bubble of a run
//   - day separators (Today, Yesterday, Mon, Oct 5)
//   - in groups: each person's name in their own color, and their photo next to their messages
//   - time inside the bubble (bottom right) and ✓✓ ticks on your messages in private chats
//   - "Diego is typing…" / "Multiple people are typing…" with the bouncing dots
import { db, appId, app } from './firebase-config.js';
import { getStorage, ref as storageRef, uploadBytesResumable, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";
import { doc, setDoc, collection, query, where, onSnapshot } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

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

/**
 * messages: [{ id, uid, name, avatar, text, ms, time, isRead, media? }]
 * opts: { myUid, group (show names + photos of others), ticks (show ✓✓ on mine), avatarOf(uid, name, avatar) }
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
        const time = ms ? timeOf(ms) : (m.time || '');
        const ticks = mine && opts.ticks ? `<span class="wa-ticks ${m.isRead ? 'read' : ''}">✓✓</span>` : '';
        const name = !mine && opts.group && startsRun
            ? `<div class="wa-name" style="color:${nameColor(m.uid || m.name)}">${esc(m.name || 'Player')}</div>` : '';
        const photo = !mine && opts.group
            ? (startsRun ? `<img class="wa-av" src="${esc(avatarOf(m.uid, m.name, m.avatar))}" onerror="this.src='${DEFAULT_AVATAR}'" style="align-self:flex-start">` : '<span class="wa-av-space"></span>')
            : '';
        const media = m.media && m.media.url ? mediaHtml(m.media) : '';
        const caption = media && (m.text === MEDIA_LABEL.image || m.text === MEDIA_LABEL.video) ? '' : m.text;
        html += `
            <div class="wa-row ${mine ? 'me' : ''} ${startsRun ? 'wa-gap-l' : 'wa-gap-s'}">
                ${photo}
                <div class="wa-bubble ${mine ? 'me' : 'them'} ${startsRun ? 'tail' : ''}">
                    ${name}${media}<span class="wa-text">${esc(caption)}</span><span class="wa-meta">${esc(time)}${ticks}</span>
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

Object.assign(window.waChat, { uploadMedia, mediaHtml, addAttachButton, showUploadProgress, hideUploadProgress, mediaErrorText, MEDIA_LABEL });