// js/livestream.js: Livestream a game.
//   An admin taps "Start livestream" in the game's Admin tab and pastes the YouTube Live link
//   (XbotGo streams to YouTube). FutNet plays it inside the game page:
//     🔴 Live tab = video on top, then the live score (from match management), then the live chat
//     (the game's comments: @mentions, replies, emoji reactions, photos).
//   The server pushes "🔴 LIVE now" to the whole community. "End livestream" keeps the video as a replay.
// Saved on the game: livestream = { url, videoId, status: 'live'|'ended', startedAt, startedBy, startedByName, endedAt? }
import { mutateEvent, escapeHtml as esc, jsArg } from './game-profile/event-store.js';
import { renderCommentsTab } from './game-profile/comments-tab.js';

const toast = (m, t) => window.showToast && window.showToast(m, t);
const myName = () => { const p = window.userProfile || {}; return p.name || p.firstName || window.currentUser?.displayName || 'Admin'; };

/** The YouTube video id from any YouTube link (watch, youtu.be, /live/, /embed/, /shorts/), or ''. */
export function youTubeId(url) {
    const s = String(url || '').trim();
    if (/^[\w-]{11}$/.test(s)) return s;
    let u;
    try { u = new URL(s.startsWith('http') ? s : 'https://' + s); } catch (e) { return ''; }
    const host = u.hostname.replace(/^www\.|^m\./, '');
    let id = '';
    if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
    else if (host.endsWith('youtube.com')) {
        id = u.searchParams.get('v') || '';
        const m = u.pathname.match(/^\/(?:live|embed|shorts|v)\/([\w-]{11})/);
        if (!id && m) id = m[1];
    }
    return /^[\w-]{11}$/.test(id) ? id : '';
}

export const liveOf = (ev) => (ev && ev.livestream && ev.livestream.videoId) ? ev.livestream : null;
export const isLive = (ev) => !!(liveOf(ev) && ev.livestream.status === 'live');

// ------------------------------------------------------------------ admin: start / end
window.openStartLivestream = function (eventId) {
    document.getElementById('livestream-modal')?.remove();
    const f = document.createElement('div');
    f.id = 'livestream-modal';
    f.className = 'fixed inset-0 z-[230] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm';
    f.innerHTML = `<div class="bg-[#040E13] border border-red-500/50 rounded-3xl max-w-sm w-full p-5 space-y-3 text-white" onclick="event.stopPropagation()">
        <div class="flex items-center justify-between"><h4 class="text-sm font-black">🔴 Start livestream</h4>
            <button onclick="document.getElementById('livestream-modal').remove()" class="text-white/50 text-lg"><i class="fa-solid fa-xmark"></i></button></div>
        <ol class="text-[11px] text-white/70 space-y-1 list-decimal pl-4">
            <li>Start the YouTube Live on your camera (XbotGo) or the YouTube app.</li>
            <li>On YouTube, open the live video and tap <b>Share → Copy link</b>.</li>
            <li>Paste it here.</li>
        </ol>
        <input id="ls-url" type="url" inputmode="url" placeholder="https://youtube.com/live/…" autocomplete="off"
            class="w-full bg-black/60 border border-red-500/50 rounded-xl px-3 py-2.5 text-white text-base sm:text-sm focus:outline-none focus:border-red-400">
        <p class="text-[10px] text-white/50">Everyone in the community gets a notification, and a red LIVE banner shows on the game and the community feed.</p>
        <button id="ls-go" onclick="startLivestream('${jsArg(eventId)}')" class="w-full bg-red-600 hover:bg-red-500 text-white font-black py-3 rounded-xl text-sm">Go live</button>
    </div>`;
    f.onclick = () => f.remove();
    document.body.appendChild(f);
    setTimeout(() => f.querySelector('#ls-url')?.focus(), 50);
};

window.startLivestream = async function (eventId) {
    const url = (document.getElementById('ls-url')?.value || '').trim();
    const videoId = youTubeId(url);
    if (!videoId) {
        toast(/youtube\.com\/(@|c\/|channel\/)/i.test(url) ? 'That\'s a channel link. Open the live video itself and copy its link (Share → Copy link).' : 'Paste a YouTube video link (like youtube.com/live/… or youtu.be/…).', 'error');
        return;
    }
    const b = document.getElementById('ls-go'); if (b) { b.disabled = true; b.textContent = 'Going live…'; }
    const me = window.currentUser;
    const res = await mutateEvent(eventId, (draft) => {
        draft.livestream = { url, videoId, status: 'live', startedAt: Date.now(), startedBy: String(me?.uid || ''), startedByName: myName() };
    });
    document.getElementById('livestream-modal')?.remove();
    if (!res.ok) return;
    toast("You're live! 🔴 The community was notified.");
    window.activeModalTab = 'live';
    if (window.renderEventDetailModalContent) window.renderEventDetailModalContent();
};

window.endLivestream = async function (eventId) {
    if (!confirm('End the livestream? The video stays on the game as a replay.')) return;
    const res = await mutateEvent(eventId, (draft) => {
        if (!draft.livestream) return false;
        draft.livestream = { ...draft.livestream, status: 'ended', endedAt: Date.now() };
    });
    if (res.ok && !res.aborted) toast('Livestream ended. The replay stays on the game.');
};

window.removeLivestream = async function (eventId) {
    if (!confirm('Remove the video from this game?')) return;
    const res = await mutateEvent(eventId, (draft) => { draft.livestream = null; });
    if (res.ok) { if (window.activeModalTab === 'live') window.activeModalTab = 'info'; window.renderEventDetailModalContent && window.renderEventDetailModalContent(); }
};

/** Top of the game's Admin tab. */
export function adminLiveCardHtml(ev) {
    const ls = liveOf(ev);
    if (ls && ls.status === 'live') return `<div class="bg-red-600/15 border-2 border-red-500 rounded-2xl p-3 flex items-center gap-3 mb-4">
        <span class="w-3 h-3 rounded-full bg-red-500 animate-pulse shrink-0"></span>
        <div class="flex-1 min-w-0"><div class="text-sm font-black text-white">You're live</div><div class="text-[10px] text-white/60">Started by ${esc(ls.startedByName || 'an admin')}</div></div>
        <button onclick="switchModalTab('live')" class="bg-white/10 border border-white/20 text-white font-black text-xs px-3 py-2 rounded-xl">Watch</button>
        <button onclick="endLivestream('${jsArg(ev.id)}')" class="bg-red-600 text-white font-black text-xs px-3 py-2 rounded-xl">End</button></div>`;
    return `<button onclick="openStartLivestream('${jsArg(ev.id)}')" class="w-full mb-4 bg-red-600 hover:bg-red-500 text-white font-black py-3.5 rounded-2xl text-sm flex items-center justify-center gap-2 shadow-[0_0_18px_rgba(239,68,68,0.35)]">
        <span class="w-2.5 h-2.5 rounded-full bg-white"></span> ${ls ? 'Start a new livestream' : 'Start livestream'}</button>`;
}

/** Red LIVE bar on the game page (any tab but Live). */
export function gameLiveBannerHtml(ev, tab) {
    if (!isLive(ev) || tab === 'live') return '';
    return `<button onclick="switchModalTab('live')" class="w-full bg-red-600 hover:bg-red-500 text-white rounded-2xl px-4 py-3 flex items-center gap-3 shadow-[0_0_18px_rgba(239,68,68,0.35)]">
        <span class="bg-white text-red-600 text-[10px] font-black px-2 py-0.5 rounded-full flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full bg-red-600 animate-pulse"></span> LIVE</span>
        <span class="flex-1 text-left text-sm font-black">This game is live now</span><span class="text-xs font-black">Watch ›</span></button>`;
}

/** Red LIVE banner at the top of a community's feed: one row per game streaming now. */
export function communityLiveBannerHtml(cid) {
    const live = (window.eventsList || []).filter(e => e.communityId === cid && isLive(e));
    return live.map(e => `<button onclick="openLiveGame('${jsArg(e.id)}')" class="w-full bg-red-600 hover:bg-red-500 text-white rounded-2xl px-4 py-3 flex items-center gap-3 shadow-[0_0_18px_rgba(239,68,68,0.35)]">
        <span class="bg-white text-red-600 text-[10px] font-black px-2 py-0.5 rounded-full flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full bg-red-600 animate-pulse"></span> LIVE</span>
        <span class="flex-1 min-w-0 text-left"><span class="block text-sm font-black truncate">${esc(e.title || 'Game')}</span><span class="block text-[10px] text-white/80">Tap to watch</span></span><span class="text-xs font-black">›</span></button>`).join('');
}
window.communityLiveBannerHtml = communityLiveBannerHtml;
window.openLiveGame = function (eventId) {
    if (!window.openEventDetails) return;
    window.openEventDetails(eventId);
    window.activeModalTab = 'live';
    if (window.renderEventDetailModalContent) window.renderEventDetailModalContent();
};

// ------------------------------------------------------------------ the 🔴 Live tab
function scoreHtml(ev) {
    const a = ev.liveMatchActive;
    if (!a) {
        const done = Array.isArray(ev.matches) ? ev.matches.length : 0;
        return done ? `<div class="text-[11px] text-white/60 text-center">${done} match${done === 1 ? '' : 'es'} played so far · the score shows here when the next one starts</div>` : '';
    }
    const g = (x) => Array.isArray(x) ? x.length : (Number(x) || 0);
    const col = (c) => /^#[0-9a-f]{3,8}$/i.test(String(c || '')) ? c : '#ffffff';
    const n = (Array.isArray(ev.matches) ? ev.matches.length : 0) + 1;
    return `<div class="bg-black/50 border border-white/10 rounded-2xl p-3">
        <div class="flex items-center justify-between text-[10px] font-black uppercase tracking-wider text-white/50 mb-2"><span>Live score</span><span class="text-[#00F296]">Match ${n}</span></div>
        <div class="flex items-center gap-2">
            <div class="flex-1 min-w-0 flex items-center gap-2"><span class="w-3 h-3 rounded-full shrink-0 border border-white/30" style="background:${col(a.teamAColor)}"></span><span class="text-sm font-black truncate">${esc(a.teamA || 'Team 1')}</span></div>
            <div class="text-2xl font-black font-mono shrink-0">${g(a.team1Goals)} <span class="text-white/40">-</span> ${g(a.team2Goals)}</div>
            <div class="flex-1 min-w-0 flex items-center gap-2 justify-end"><span class="text-sm font-black truncate">${esc(a.teamB || 'Team 2')}</span><span class="w-3 h-3 rounded-full shrink-0 border border-white/30" style="background:${col(a.teamBColor)}"></span></div>
        </div></div>`;
}

export function renderLiveTab(ev, isAdmin) {
    const ls = liveOf(ev);
    if (!ls) return '<p class="text-xs text-white/50 text-center py-8">No livestream on this game.</p>';
    const live = ls.status === 'live';
    setTimeout(mountPlayer, 0);
    return `<div class="space-y-3">
        <div class="flex items-center gap-2">
            ${live ? '<span class="bg-red-600 text-white text-[10px] font-black px-2 py-0.5 rounded-full flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span> LIVE</span>'
                : '<span class="bg-white/10 text-white/80 text-[10px] font-black px-2 py-0.5 rounded-full">▶ REPLAY</span>'}
            <span class="flex-1 text-xs text-white/60 truncate">${live ? `Streaming now · started by ${esc(ls.startedByName || 'an admin')}` : 'The livestream has ended. Watch the replay.'}</span>
            <a href="${esc(ls.url || `https://youtu.be/${ls.videoId}`)}" target="_blank" rel="noopener" class="text-[10px] font-black text-white/70 underline shrink-0">Open in YouTube</a>
        </div>
        <div id="live-video-slot" data-video="${esc(ls.videoId)}" class="w-full aspect-video rounded-2xl bg-black border border-white/10"></div>
        ${scoreHtml(ev)}
        ${isAdmin ? `<div class="flex gap-2">${live ? `<button onclick="endLivestream('${jsArg(ev.id)}')" class="flex-1 bg-red-600 text-white font-black text-xs py-2.5 rounded-xl">End livestream</button>`
            : `<button onclick="openStartLivestream('${jsArg(ev.id)}')" class="flex-1 bg-red-600 text-white font-black text-xs py-2.5 rounded-xl">Start a new livestream</button>
               <button onclick="removeLivestream('${jsArg(ev.id)}')" class="bg-black/50 border border-white/15 text-white/70 font-bold text-xs px-3 py-2.5 rounded-xl">Remove video</button>`}</div>` : ''}
        <div class="text-[10px] font-black uppercase tracking-wider text-[#00F296] pt-1">💬 Live chat</div>
        ${renderCommentsTab(ev)}
    </div>`;
}

// The video lives in one iframe kept outside the page, laid over the empty box above. The game page
// redraws on every comment or goal; the iframe isn't touched, so the video never restarts.
let player = null, playerVideo = '', loop = 0;
function mountPlayer() { if (!loop) loop = requestAnimationFrame(tick); }
function tick() {
    const slot = document.getElementById('live-video-slot');
    const visible = slot && slot.isConnected && slot.getClientRects().length > 0;
    if (!visible) {
        if (player) { player.remove(); player = null; playerVideo = ''; }
        loop = 0;
        return;
    }
    const vid = slot.dataset.video;
    if (!player) {
        player = document.createElement('div');
        player.id = 'futnet-live-player';
        player.style.cssText = 'position:fixed;z-index:40;border-radius:16px;overflow:hidden;background:#000;';
        document.body.appendChild(player);
    }
    if (playerVideo !== vid) {
        playerVideo = vid;
        player.innerHTML = `<iframe src="https://www.youtube.com/embed/${encodeURIComponent(vid)}?autoplay=1&playsinline=1&rel=0" title="Livestream"
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen style="width:100%;height:100%;border:0;display:block"></iframe>`;
    }
    const r = slot.getBoundingClientRect();
    // Hide whatever part of the video scrolled above the top of the screen (under the header).
    const cut = Math.max(0, -r.top);
    Object.assign(player.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`,
        clipPath: cut ? `inset(${cut}px 0 0 0)` : 'none', display: r.bottom <= 0 ? 'none' : 'block' });
    loop = requestAnimationFrame(tick);
}
