// js/livestream.js: Livestream a game.
//   An admin taps "Start livestream" in the game's Admin tab and pastes the YouTube Live link
//   (XbotGo streams to YouTube). FutNet plays it inside the game page:
//     🔴 Live tab = video on top, then the live score (from match management), then the live chat
//     (the game's comments: @mentions, replies, emoji reactions, photos).
//   The server pushes "🔴 LIVE now" to the whole community. "End livestream" keeps the video as a replay.
// Saved on the game: livestream = { url, provider: 'youtube'|'facebook', videoId (YouTube), embedUrl (Facebook),
//                                  status: 'live'|'ended', startedAt, startedBy, startedByName, endedAt? }
// Facebook Live works too (YouTube needs 50 subscribers to stream from a phone): the video must be Public.
import { mutateEvent, escapeHtml as esc, jsArg } from './game-profile/event-store.js';
import { renderCommentsTab } from './game-profile/comments-tab.js';
import { watchLive, liveStatsHtml } from './live-stats.js';

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

/** A Facebook video link (fb.watch, /videos/, /watch, /reel/, /share/v/ …), cleaned up, or ''. */
export function facebookVideoUrl(url) {
    const s = String(url || '').trim();
    let u;
    try { u = new URL(s.startsWith('http') ? s : 'https://' + s); } catch (e) { return ''; }
    const host = u.hostname.replace(/^(www|m|web|mbasic)\./, '');
    if (host === 'fb.watch') return u.pathname.length > 1 ? `https://fb.watch${u.pathname}` : '';
    if (host !== 'facebook.com' && host !== 'fb.com') return '';
    const p = u.pathname;
    const ok = /\/videos?\//.test(p) || /^\/(watch|video\.php|reel|share\/v|share\/r)\b/.test(p) || /\/live(_videos)?\/?$/.test(p) && u.searchParams.get('v');
    if (!ok) return '';
    const v = u.searchParams.get('v');
    return `https://www.facebook.com${p}${v ? '?v=' + encodeURIComponent(v) : ''}`;
}
/** An XbotGo watch link (cloud.xbotgo.net/live?userId=…), cleaned up, or ''. The camera's own page plays the stream. */
export function xbotgoUrl(url) {
    const s = String(url || '').trim();
    let u;
    try { u = new URL(s.startsWith('http') ? s : 'https://' + s); } catch (e) { return ''; }
    if (!/(^|\.)xbotgo\.(net|com)$/i.test(u.hostname)) return '';
    if (!/\/live/i.test(u.pathname) || !u.searchParams.get('userId')) return '';
    u.protocol = 'https:';
    return u.toString();
}
/** What to play from a pasted link: YouTube, Facebook or XbotGo (or null). */
export function liveSource(url) {
    const yt = youTubeId(url);
    if (yt) return { provider: 'youtube', videoId: yt, embedUrl: '' };
    const fb = facebookVideoUrl(url);
    if (fb) return { provider: 'facebook', videoId: '', embedUrl: `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(fb)}&show_text=false&autoplay=true&width=1280` };
    const xb = xbotgoUrl(url);
    if (xb) return { provider: 'xbotgo', videoId: '', embedUrl: xb };
    return null;
}
window.liveSource = liveSource;
/** Why a pasted link can't be played (shown to the admin). */
export function liveLinkProblem(url) {
    if (/youtube\.com\/(@|c\/|channel\/)/i.test(url)) return "That's a YouTube channel link. Open the live video itself and copy its link (Share → Copy link).";
    if (/facebook\.com|fb\.watch/i.test(url)) return "That's not a Facebook video link. Open the live video on Facebook, tap Share → Copy link, and paste that. (Set the live video to Public so everyone can watch.)";
    if (/xbotgo/i.test(url)) return "That's not an XbotGo watch link. In the XbotGo app, start the live and copy the watch link (it looks like cloud.xbotgo.net/live?userId=…).";
    return 'Paste an XbotGo, YouTube or Facebook live link (like cloud.xbotgo.net/live?userId=…, youtube.com/live/…, or facebook.com/…/videos/…).';
}
window.liveLinkProblem = liveLinkProblem;
const liveKey = (ls) => (ls && (ls.videoId || ls.embedUrl)) || '';
export const liveOf = (ev) => (ev && ev.livestream && liveKey(ev.livestream)) ? ev.livestream : null;
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
            <li><b>XbotGo:</b> start the live in the XbotGo app and copy its watch link (cloud.xbotgo.net/live?userId=…). It's the same link every time, so we remember it for you.</li>
            <li><b>YouTube / Facebook:</b> open the live video, tap <b>Share → Copy link</b>. On Facebook, set it to <b>Public</b>.</li>
            <li>Paste it here.</li>
        </ol>
        <input id="ls-url" type="url" inputmode="url" placeholder="XbotGo, YouTube or Facebook live link" autocomplete="off" value="${esc(lastLink())}"
            class="w-full bg-black/60 border border-red-500/50 rounded-xl px-3 py-2.5 text-white text-base sm:text-sm focus:outline-none focus:border-red-400">
        <label class="flex items-center gap-3 bg-black/40 border border-white/10 rounded-xl p-3 cursor-pointer">
            <input id="ls-notify" type="checkbox" checked class="w-5 h-5 accent-red-500 shrink-0">
            <span class="text-xs"><b>Notify the community</b><span class="block text-[10px] text-white/50">Untick it to test: no push goes out. The red LIVE banner still shows on the game and the feed.</span></span></label>
        <button id="ls-go" onclick="startLivestream('${jsArg(eventId)}')" class="w-full bg-red-600 hover:bg-red-500 text-white font-black py-3 rounded-xl text-sm">Go live</button>
    </div>`;
    f.onclick = () => f.remove();
    document.body.appendChild(f);
    setTimeout(() => f.querySelector('#ls-url')?.focus(), 50);
};

// The XbotGo watch link doesn't change, so it's filled in next time (this device only).
const lastLink = () => { try { return localStorage.getItem('futnet_xbotgo_link') || ''; } catch (e) { return ''; } };
window.liveLastLink = lastLink;
window.liveRememberLink = (url, src) => { try { if (src && src.provider === 'xbotgo') localStorage.setItem('futnet_xbotgo_link', url); } catch (e) { /* ignore */ } };
window.startLivestream = async function (eventId) {
    const url = (document.getElementById('ls-url')?.value || '').trim();
    const src = liveSource(url);
    if (!src) { toast(liveLinkProblem(url), 'error'); return; }
    window.liveRememberLink(url, src);
    const notify = document.getElementById('ls-notify') ? document.getElementById('ls-notify').checked : true;
    const b = document.getElementById('ls-go'); if (b) { b.disabled = true; b.textContent = 'Going live…'; }
    const me = window.currentUser;
    const res = await mutateEvent(eventId, (draft) => {
        draft.livestream = { url, ...src, status: 'live', startedAt: Date.now(), startedBy: String(me?.uid || ''), startedByName: myName(), notify };
    });
    document.getElementById('livestream-modal')?.remove();
    if (!res.ok) return;
    toast(notify ? "You're live! 🔴 The community was notified." : "You're live! 🔴 (no notification sent)");
    window.activeModalTab = 'live';
    if (window.renderEventDetailModalContent) window.renderEventDetailModalContent();
};

window.endLivestream = async function (eventId) {
    if (!confirm("End the livestream?\n\nYouTube / Facebook: the video stays on the game as a replay.\nXbotGo: the replay isn't kept on its link. Add the recording's YouTube link afterwards (🎬 Add the replay video).")) return;
    const res = await mutateEvent(eventId, (draft) => {
        if (!draft.livestream) return false;
        draft.livestream = { ...draft.livestream, status: 'ended', endedAt: Date.now() };
    });
    if (res.ok && !res.aborted) toast('Livestream ended. The replay stays on the game.');
};

/** After an XbotGo live: the admin pastes the recording's YouTube / Facebook link, and the Live tab plays it as the replay. */
window.openAddReplay = function (eventId) {
    document.getElementById('livestream-modal')?.remove();
    const f = document.createElement('div');
    f.id = 'livestream-modal';
    f.className = 'fixed inset-0 z-[230] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm';
    f.innerHTML = `<div class="bg-[#040E13] border border-red-500/50 rounded-3xl max-w-sm w-full p-5 space-y-3 text-white" onclick="event.stopPropagation()">
        <div class="flex items-center justify-between"><h4 class="text-sm font-black">🎬 Add the replay video</h4>
            <button onclick="document.getElementById('livestream-modal').remove()" class="text-white/50 text-lg"><i class="fa-solid fa-xmark"></i></button></div>
        <ol class="text-[11px] text-white/70 space-y-1 list-decimal pl-4">
            <li>The XbotGo recording is in the <b>Photos</b> of the phone that filmed it.</li>
            <li>Upload it to <b>YouTube</b> (Unlisted is fine) or Facebook (Public).</li>
            <li>Copy the video's link (Share → Copy link) and paste it here.</li>
        </ol>
        <input id="ls-replay-url" type="url" inputmode="url" placeholder="YouTube or Facebook video link" autocomplete="off"
            class="w-full bg-black/60 border border-red-500/50 rounded-xl px-3 py-2.5 text-white text-base sm:text-sm focus:outline-none focus:border-red-400">
        <button onclick="saveReplay('${jsArg(eventId)}')" class="w-full bg-red-600 hover:bg-red-500 text-white font-black py-3 rounded-xl text-sm">Save replay</button>
    </div>`;
    f.onclick = () => f.remove();
    document.body.appendChild(f);
};
window.saveReplay = async function (eventId) {
    const url = (document.getElementById('ls-replay-url')?.value || '').trim();
    const src = liveSource(url);
    if (!src || src.provider === 'xbotgo') { toast('Paste a YouTube or Facebook video link.', 'error'); return; }
    const res = await mutateEvent(eventId, (draft) => {
        const old = draft.livestream || {};
        draft.livestream = { ...old, url, ...src, status: 'ended', endedAt: old.endedAt || Date.now(), liveUrl: old.url || '', replayAddedAt: Date.now() };
    });
    document.getElementById('livestream-modal')?.remove();
    if (res.ok) { toast('Replay added. 🎬'); window.renderEventDetailModalContent && window.renderEventDetailModalContent(); }
};

window.removeLivestream = async function (eventId) {
    if (!confirm('Remove the video from this game?')) return;
    const res = await mutateEvent(eventId, (draft) => { draft.livestream = null; });
    if (res.ok) { if (window.activeModalTab === 'live') window.activeModalTab = 'info'; window.renderEventDetailModalContent && window.renderEventDetailModalContent(); }
};

/** Top of the game's Admin tab: only while live (the "Go live" button sits in Event Controls). */
export function adminLiveCardHtml(ev) {
    const ls = liveOf(ev);
    if (!(ls && ls.status === 'live')) return '';
    return `<div class="bg-red-600/15 border-2 border-red-500 rounded-2xl p-3 flex items-center gap-3 mb-4">
        <span class="w-3 h-3 rounded-full bg-red-500 animate-pulse shrink-0"></span>
        <div class="flex-1 min-w-0"><div class="text-sm font-black text-white">You're live</div><div class="text-[10px] text-white/60">Started by ${esc(ls.startedByName || 'an admin')}${ls.notify === false ? ' · no notification sent' : ''}</div></div>
        <button onclick="switchModalTab('live')" class="bg-white/10 border border-white/20 text-white font-black text-xs px-3 py-2 rounded-xl">Watch</button>
        <button onclick="endLivestream('${jsArg(ev.id)}')" class="bg-red-600 text-white font-black text-xs px-3 py-2 rounded-xl">End</button></div>`;
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
    // XbotGo's link is the live room: once the live ends there's nothing to play until a replay video is added.
    const xbEnded = ls.provider === 'xbotgo' && !live;
    if (!xbEnded) setTimeout(mountPlayer, 0);
    setTimeout(() => watchLive(ev), 0);   // 📊 count this viewer (every 30 s while the tab is on screen)
    return `<div class="space-y-3">
        <div class="flex items-center gap-2">
            ${live ? '<span class="bg-red-600 text-white text-[10px] font-black px-2 py-0.5 rounded-full flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span> LIVE</span>'
                : '<span class="bg-white/10 text-white/80 text-[10px] font-black px-2 py-0.5 rounded-full">▶ REPLAY</span>'}
            <span class="flex-1 text-xs text-white/60 truncate">${live ? `Streaming now · started by ${esc(ls.startedByName || 'an admin')}` : 'The livestream has ended. Watch the replay.'}</span>
            <a href="${esc(ls.url || `https://youtu.be/${ls.videoId}`)}" target="_blank" rel="noopener" class="text-[10px] font-black text-white/70 underline shrink-0">Open in ${ls.provider === 'facebook' ? 'Facebook' : ls.provider === 'xbotgo' ? 'XbotGo' : 'YouTube'}</a>
        </div>
        ${xbEnded ? `<div id="live-ended-box" class="w-full rounded-2xl bg-black/60 border border-white/10 p-5 text-center space-y-2">
                <div class="text-3xl">🎬</div><div class="text-sm font-black text-white">The live has ended</div>
                <p class="text-[11px] text-white/60">XbotGo doesn't keep the replay on its live link. ${isAdmin ? 'The recording is saved on the phone that filmed it (Photos). Upload it to YouTube and add the link here, so everyone can watch the replay.' : 'The replay shows here when the organizer adds it.'}</p>
                ${isAdmin ? `<button onclick="openAddReplay('${jsArg(ev.id)}')" class="bg-red-600 text-white font-black text-xs px-4 py-2.5 rounded-xl">🎬 Add the replay video</button>` : ''}
            </div>` : liveSlotHtml(ls)}
        ${ls.provider === 'xbotgo' && live ? `<p class="text-center text-[10px] text-white/45">It can take 10–20 seconds to start. The video is about 10 seconds behind real time.</p>
            <a href="${esc(ls.url)}" target="_blank" rel="noopener" class="block text-center text-[11px] text-white/60">Video not showing? <b class="text-white underline">Tap here to watch on XbotGo</b></a>` : ''}
        ${scoreHtml(ev)}
        ${isAdmin ? `<div class="flex gap-2">${live ? `<button onclick="endLivestream('${jsArg(ev.id)}')" class="flex-1 bg-red-600 text-white font-black text-xs py-2.5 rounded-xl">End livestream</button>`
            : `<button onclick="openStartLivestream('${jsArg(ev.id)}')" class="flex-1 bg-red-600 text-white font-black text-xs py-2.5 rounded-xl">Start a new livestream</button>
               <button onclick="removeLivestream('${jsArg(ev.id)}')" class="bg-black/50 border border-white/15 text-white/70 font-bold text-xs px-3 py-2.5 rounded-xl">Remove video</button>`}</div>` : ''}
        ${isAdmin ? liveStatsHtml(ev) : ''}
        <div class="text-[10px] font-black uppercase tracking-wider text-[#00F296] pt-1">💬 Live chat</div>
        ${renderCommentsTab(ev)}
    </div>`;
}

// The video lives in one iframe kept outside the page, laid over the empty box above. The game page
// redraws on every comment or goal; the iframe isn't touched, so the video never restarts.
let player = null, playerVideo = '', loop = 0;
function mountPlayer() { if (!loop) loop = requestAnimationFrame(tick); }
/** The empty box the video is laid over (YouTube or Facebook). */
export function liveSlotHtml(ls) {
    return `<div id="live-video-slot" data-video="${esc(liveKey(ls))}" data-embed="${esc(ls.embedUrl || '')}" class="w-full aspect-video rounded-2xl bg-black border border-white/10"></div>`;
}
window.liveSlotHtml = liveSlotHtml;
// VS Mode matches use the same player (their page sits on top of the app, so the video goes above it).
window.mountLivePlayer = mountPlayer;
window.youTubeId = youTubeId;
function tick() {
    const slot = document.getElementById('live-video-slot');
    const visible = slot && slot.isConnected && slot.getClientRects().length > 0;
    if (!visible) {
        if (player) { player.remove(); player = null; playerVideo = ''; }
        loop = 0;
        return;
    }
    const vid = slot.dataset.video;
    const src = slot.dataset.embed || `https://www.youtube.com/embed/${encodeURIComponent(vid)}?autoplay=1&playsinline=1&rel=0`;
    if (!player) {
        player = document.createElement('div');
        player.id = 'futnet-live-player';
        player.style.cssText = 'position:fixed;z-index:40;border-radius:16px;overflow:hidden;background:#000;';
        document.body.appendChild(player);
    }
    if (playerVideo !== vid) {
        playerVideo = vid;
        player.innerHTML = `<iframe src="${esc(src)}" title="Livestream"
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen style="width:100%;height:100%;border:0;display:block"></iframe>`;
    }
    player.style.zIndex = slot.closest('#vs-page') ? '140' : '40';
    const r = slot.getBoundingClientRect();
    // Hide whatever part of the video scrolled above the top of the screen (under the header).
    const cut = Math.max(0, -r.top);
    Object.assign(player.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`,
        clipPath: cut ? `inset(${cut}px 0 0 0)` : 'none', display: r.bottom <= 0 ? 'none' : 'block' });
    loop = requestAnimationFrame(tick);
}
