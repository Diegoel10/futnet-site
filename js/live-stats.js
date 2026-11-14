// js/live-stats.js: who watched a game's livestream, and for how long (admins see it on the 🔴 Live tab).
//   While someone has the Live tab open and on screen, every 30 seconds:
//     artifacts/{appId}/eventsList/{gameId}/liveViews/{uid} = { uid, name, avatar, devices: ['web'|'iphone'|'android'],
//         liveSec (+30 while it's live), replaySec (+30 after it ended), sessions (+1 per visit), firstMs, lastMs }
//     artifacts/{appId}/eventsList/{gameId}/liveViews/_minutes = { m: { 'HH:MM': beats } }  → how many watched at once
//   The apps write the same thing, so the numbers include everyone (website, iPhone, Android).
import { db, appId } from './firebase-config.js';
import { doc, collection, setDoc, onSnapshot, increment, arrayUnion } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { escapeHtml as esc } from './game-profile/event-store.js';

const BEAT = 30;   // seconds
const pad = (n) => String(n).padStart(2, '0');
const viewsCol = (gameId) => collection(db, 'artifacts', appId, 'eventsList', String(gameId), 'liveViews');
const myName = () => { const p = window.userProfile || {}; return p.name || `${p.firstName || ''} ${p.lastName || ''}`.trim() || window.currentUser?.displayName || 'Player'; };

// ------------------------------------------------------------------ counting (everyone)
const W = { gameId: '', timer: 0, started: false, mode: 'live', ev: null };

function onScreen() {
    const slot = document.getElementById('live-video-slot') || document.getElementById('live-ended-box');
    return !!(slot && slot.isConnected && slot.getClientRects().length > 0 && document.visibilityState === 'visible');
}

function beat(first) {
    const u = window.currentUser;
    if (!u || !u.uid || !W.gameId) return;
    if (!onScreen()) { stopWatching(); return; }
    const now = Date.now();
    const data = { uid: String(u.uid), name: myName(), avatar: (window.userProfile || {}).avatar || '', devices: arrayUnion('web'), lastMs: now };
    if (first) data.sessions = increment(1);
    else data[W.mode === 'live' ? 'liveSec' : 'replaySec'] = increment(BEAT);
    setDoc(doc(viewsCol(W.gameId), String(u.uid)), data, { merge: true }).catch(e => console.warn('liveViews', e));
    if (!first && W.mode === 'live') {
        const d = new Date();
        setDoc(doc(viewsCol(W.gameId), '_minutes'), { m: { [`${pad(d.getHours())}:${pad(d.getMinutes())}`]: increment(1) } }, { merge: true }).catch(() => {});
    }
    W.started = true;
}

/** Called each time the Live tab draws. Starts counting this person (once), every 30 seconds while it's on screen. */
export function watchLive(ev) {
    const ls = ev && ev.livestream;
    if (!ls) return;
    W.mode = ls.status === 'live' ? 'live' : 'replay';
    W.ev = ev;
    if (W.gameId === ev.id && W.timer) return;
    stopWatching();
    W.gameId = ev.id; W.started = false;
    setTimeout(() => { if (onScreen()) beat(true); }, 1500);
    W.timer = setInterval(() => beat(false), BEAT * 1000);
}
export function stopWatching() { if (W.timer) clearInterval(W.timer); W.timer = 0; W.gameId = ''; W.ev = null; }
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') { const ev = W.ev; stopWatching(); W.ev = ev; }
    else if (W.ev) setTimeout(() => { if (onScreen() && W.ev) watchLive(W.ev); }, 500);   // back on the Live tab: count again
});

// ------------------------------------------------------------------ the admin box
const S = { gameId: '', unsub: null, views: [], minutes: {}, err: '' };

function listen(gameId) {
    if (S.gameId === gameId) return;
    if (S.unsub) S.unsub();
    S.gameId = gameId; S.views = []; S.minutes = {}; S.err = '';
    S.unsub = onSnapshot(viewsCol(gameId), (s) => {
        S.views = []; S.minutes = {};
        s.docs.forEach(d => { if (d.id === '_minutes') S.minutes = (d.data() || {}).m || {}; else S.views.push(d.data()); });
        redraw();
    }, (e) => { console.warn('liveViews', e); S.err = "Couldn't load the viewers."; redraw(); });
}
function redraw() { const box = document.getElementById('live-stats-box'); if (box && window._liveStatsEv) box.innerHTML = statsInner(window._liveStatsEv); }

const dur = (s) => { s = Math.round(Number(s) || 0); if (s < 60) return s ? `${s}s` : '0'; const m = Math.round(s / 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`; };
const ago = (ms) => { const s = (Date.now() - (Number(ms) || 0)) / 1000; if (s < 75) return 'watching now'; if (s < 3600) return `${Math.round(s / 60)} min ago`; if (s < 86400) return `${Math.round(s / 3600)}h ago`; return new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' }); };
const devIcon = (d) => d === 'iphone' ? '📱 iPhone' : d === 'android' ? '🤖 Android' : '💻 Web';

/** The numbers, shared by the website and (in the same way) by the apps. */
export function liveStatsOf(ev, views, minutes) {
    const ls = ev.livestream || {};
    const from = Number(ls.startedAt) || 0, to = Number(ls.endedAt) || Date.now();
    const chats = {};
    (ev.comments || []).forEach(c => { const t = Number(c.createdAt) || 0; if (c.uid && t >= from && t <= to) chats[c.uid] = (chats[c.uid] || 0) + 1; });
    const people = views.filter(v => (Number(v.liveSec) || 0) + (Number(v.replaySec) || 0) > 0 || (Date.now() - (Number(v.lastMs) || 0)) < 75000)
        .map(v => ({ ...v, chats: chats[v.uid] || 0, total: (Number(v.liveSec) || 0) + (Number(v.replaySec) || 0) }))
        .sort((a, b) => b.total - a.total);
    const now = people.filter(v => (Date.now() - (Number(v.lastMs) || 0)) < 75000).length;
    const peak = Math.max(now, ...Object.values(minutes || {}).map(n => Math.ceil((Number(n) || 0) * BEAT / 60)), 0);
    const liveSec = people.reduce((s, v) => s + (Number(v.liveSec) || 0), 0);
    const replaySec = people.reduce((s, v) => s + (Number(v.replaySec) || 0), 0);
    const liveViewers = people.filter(v => (Number(v.liveSec) || 0) > 0).length;
    const devices = {};
    people.forEach(v => (v.devices || []).forEach(d => { devices[d] = (devices[d] || 0) + 1; }));
    return { people, now, peak, liveSec, replaySec, liveViewers, avg: liveViewers ? liveSec / liveViewers : 0,
        chatMsgs: Object.values(chats).reduce((a, b) => a + b, 0), chatters: Object.keys(chats).length, devices };
}

function statsInner(ev) {
    if (S.err) return `<p class="text-[11px] text-red-300">${esc(S.err)}</p>`;
    const st = liveStatsOf(ev, S.views, S.minutes);
    const tile = (v, l) => `<div class="bg-black/40 rounded-xl p-2 text-center"><div class="text-base font-black text-white">${v}</div><div class="text-[9px] font-bold uppercase tracking-wider text-white/50">${l}</div></div>`;
    return `<div class="grid grid-cols-3 gap-2">
            ${tile(`<span class="${st.now ? 'text-red-400' : ''}">${st.now}</span>`, 'Watching now')}
            ${tile(st.people.length, 'Viewers')}${tile(st.peak, 'Most at once')}
            ${tile(dur(st.avg), 'Avg watch')}${tile(dur(st.liveSec), 'Live watch time')}${tile(st.chatMsgs, 'Chat messages')}
        </div>
        ${Object.keys(st.devices).length ? `<div class="text-[10px] text-white/50">${Object.entries(st.devices).map(([d, n]) => `${devIcon(d)} ${n}`).join(' · ')}${st.replaySec ? ` · ▶ replay watch time ${dur(st.replaySec)}` : ''}</div>` : ''}
        <div class="space-y-1.5 max-h-72 overflow-y-auto">
            ${st.people.map(v => `<div class="flex items-center gap-2 bg-black/40 rounded-xl px-2.5 py-2">
                ${v.avatar ? `<img src="${esc(v.avatar)}" class="w-7 h-7 rounded-full object-cover shrink-0" alt="">` : `<span class="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-[11px] font-black shrink-0">${esc((v.name || '?').charAt(0).toUpperCase())}</span>`}
                <div class="flex-1 min-w-0"><div class="text-xs font-bold text-white truncate">${esc(v.name || 'Player')}</div>
                    <div class="text-[10px] text-white/50 truncate">${(v.devices || []).map(devIcon).join(', ')} · ${ago(v.lastMs)}${v.chats ? ` · 💬 ${v.chats}` : ''}</div></div>
                <div class="text-right shrink-0"><div class="text-xs font-black text-[#00F296]">${dur(v.liveSec)}</div>${v.replaySec ? `<div class="text-[9px] text-white/50">+${dur(v.replaySec)} replay</div>` : ''}</div>
            </div>`).join('') || '<p class="text-[11px] text-white/45 text-center py-2">Nobody has watched yet. Viewers show up here about 30 seconds after they open the Live tab.</p>'}
        </div>`;
}

/** 📊 Viewers box for the game's admins (on the Live tab). */
export function liveStatsHtml(ev) {
    listen(ev.id);
    window._liveStatsEv = ev;
    return `<div class="bg-black/50 border border-white/10 rounded-2xl p-3 space-y-2">
        <div class="flex items-center justify-between"><span class="text-[10px] font-black uppercase tracking-wider text-[#00F296]">📊 Viewers (admins only)</span>
            <span class="text-[9px] text-white/40">website + iPhone + Android</span></div>
        <div id="live-stats-box">${statsInner(ev)}</div></div>`;
}
