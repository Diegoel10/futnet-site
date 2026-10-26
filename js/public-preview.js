// js/public-preview.js: share links for people who are not signed in (yet).
//   futnet.site/c/<link name>  -> community page preview   (index.html turns it into #c=<link name>)
//   futnet.site/g/<game id>    -> game preview              (index.html turns it into #event=<id>)
//   older links #community=<id> and #event=<id> work the same.
// The server (publicPreview) sends only safe info. "Join" opens Sign up; right after signing in the
// join request is sent by itself (community) or the game opens (game links already do that).
import { auth } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js";

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ss = {
    get(k) { try { return sessionStorage.getItem(k) || ''; } catch (e) { return ''; } },
    set(k, v) { try { if (v) sessionStorage.setItem(k, v); else sessionStorage.removeItem(k); } catch (e) { /* blocked */ } },
};
const preview = (kind, id) => httpsCallable(getFunctions(auth.app, 'us-central1'), 'publicPreview')({ kind, id }).then(r => r.data || {});
const gameDate = (d) => (window.fmtGameDate ? window.fmtGameDate(d) : d);

/** What the address says: { kind: 'community', key } or { kind: 'game', key } or null. */
function linkInAddress() {
    const h = location.hash || '';
    let m = h.match(/^#c=([^&]+)/);
    if (m) return { kind: 'community', key: decodeURIComponent(m[1]) };
    m = h.match(/^#community=([^&]+)/);
    if (m && !/[&]invite=/.test(h)) return { kind: 'community', key: decodeURIComponent(m[1]) };
    m = h.match(/[#&]event=([^&/]+)/);
    if (m) return { kind: 'game', key: decodeURIComponent(m[1]) };
    return null;
}
const LINK = linkInAddress();

function gameCard(g, big = false) {
    const left = g.ended ? 'Game ended' : g.spotsLeft > 0 ? `${g.spotsLeft} spot${g.spotsLeft === 1 ? '' : 's'} left` : 'Full · waitlist open';
    return `<div class="bg-black/45 border border-white/10 rounded-2xl p-3 space-y-1.5 text-left">
        <div class="flex items-center justify-between gap-2">
            <div class="font-black text-white ${big ? 'text-base' : 'text-sm'} truncate">${esc(g.title)}</div>
            ${g.format ? `<span class="text-[10px] px-2 py-0.5 rounded-full font-bold bg-[#00F296]/20 text-[#00F296] shrink-0">${esc(g.format)}</span>` : ''}
        </div>
        <div class="text-xs text-white/75 space-y-0.5">
            <div><i class="fa-solid fa-calendar text-[#00F296] w-4"></i> ${esc(gameDate(g.date))}${g.time ? ` · ${esc(g.time)}` : ''}</div>
            ${g.location ? `<div class="truncate"><i class="fa-solid fa-location-dot text-[#00F296] w-4"></i> ${esc(g.location)}</div>` : ''}
            <div><i class="fa-solid fa-users text-[#00F296] w-4"></i> ${esc(left)}${g.price > 0 ? ` · $${esc(g.price)} per player` : ' · Free'}</div>
        </div>
    </div>`;
}

function shell(inner) {
    const box = document.getElementById('auth-container');
    if (!box) return;
    document.getElementById('deeplink-banner')?.remove();
    let el = document.getElementById('public-preview');
    if (!el) {
        el = document.createElement('div');
        el.id = 'public-preview';
        el.className = 'relative z-10 w-full max-w-[400px] my-auto';
        box.insertBefore(el, box.firstChild);
    }
    ['view-login', 'view-signup'].forEach(id => document.getElementById(id)?.classList.add('hidden'));
    el.innerHTML = `<div class="bg-[#040E13]/95 border border-emerald-500/50 rounded-[24px] p-4 shadow-2xl space-y-3 backdrop-blur-md text-white">${inner}
        <div id="pp-actions" class="space-y-2 pt-1">
            <button onclick="publicPreviewAsk()" class="w-full py-3 rounded-2xl bg-gradient-to-r from-[#00F296] to-[#00B4AE] text-slate-950 font-black text-sm">${LINK.kind === 'game' ? 'Join this game' : 'Join this community'}</button>
        </div>
        <!-- After tapping Join: make an account, or sign in -->
        <div id="pp-account" class="hidden space-y-2 pt-1">
            <button onclick="publicPreviewJoin()" class="w-full py-3 rounded-2xl bg-gradient-to-r from-[#00F296] to-[#00B4AE] text-slate-950 font-black text-sm">Sign up</button>
            <button onclick="publicPreviewSignIn()" class="w-full py-3 rounded-2xl border border-white/30 text-white font-bold text-sm">I have an account · Sign in</button>
            <p class="text-[10px] text-white/45 text-center">A free FutNet account takes a minute.</p>
        </div></div>`;
}

function hidePreview() {
    document.getElementById('public-preview')?.remove();
}

/** Logged out: show the preview card where the login card is. */
async function showPreview() {
    shell('<div class="text-center py-8 text-sm text-white/60"><i class="fa-solid fa-futbol fa-spin text-[#00F296] mr-2"></i> Loading…</div>');
    let r = {};
    try { r = await preview(LINK.kind, LINK.key); } catch (e) { r = { ok: false, reason: 'error' }; }
    if (!document.getElementById('public-preview')) return;   // signed in meanwhile
    if (!r.ok) {
        const msg = r.reason === 'private' ? `${esc(r.name || 'This community')} is private. Sign in or make an account to see it.`
            : r.reason === 'not-found' ? "This link doesn't work anymore. You can still make an account and look around."
            : "Couldn't load this right now. Sign in or make an account to see it.";
        shell(`<div class="text-center space-y-2 py-2"><i class="fa-solid fa-lock text-2xl text-white/40"></i><p class="text-sm text-white/75">${msg}</p></div>`);
        if (r.id) ss.set('futnet_pending_join', r.id);
        return;
    }
    if (r.kind === 'game') {
        const g = r.game;
        if (g.communityId) ss.set('futnet_pending_join', '');   // games open by themselves after signing in
        shell(`<div class="text-center space-y-1">
                <div class="text-[10px] font-black uppercase tracking-widest text-[#00F296]">You're invited to a game ⚽</div>
                ${g.communityName ? `<div class="text-xs text-white/60">${esc(g.communityName)}</div>` : ''}
            </div>
            ${gameCard(g, true)}
            <div class="text-[11px] text-white/55 text-center">${g.going} going${g.capacity ? ` · ${g.capacity} spots in total` : ''}</div>`);
        return;
    }
    const c = r.community;
    ss.set('futnet_pending_join', c.id);
    const place = [c.city, c.state].filter(Boolean).join(', ');
    const top = (r.topScorers || []).map((p, i) => `<div class="flex items-center gap-2.5 py-1">
            <span class="w-5 text-center text-sm">${['🥇', '🥈', '🥉'][i] || i + 1}</span>
            ${p.avatar ? `<img src="${esc(p.avatar)}" class="w-7 h-7 rounded-full object-cover border border-white/20">` : `<span class="w-7 h-7 rounded-full bg-[#00F296]/25 flex items-center justify-center text-[11px] font-black">${esc((p.name || '?')[0])}</span>`}
            <span class="flex-1 text-sm font-bold truncate">${esc(p.name)}</span><span class="text-xs font-black text-[#00F296]">${p.goals} ⚽</span></div>`).join('');
    shell(`<div class="flex items-center gap-3">
            ${c.thumbnail ? `<img src="${esc(c.thumbnail)}" class="w-16 h-16 rounded-2xl object-cover border border-white/15 shrink-0">` : ''}
            <div class="min-w-0">
                <div class="text-lg font-black leading-tight truncate">${esc(c.name)}</div>
                <div class="text-xs text-white/60">${esc(place)}${place ? ' · ' : ''}${c.membersCount} member${c.membersCount === 1 ? '' : 's'}</div>
            </div>
        </div>
        ${c.description ? `<p class="text-sm text-white/80 leading-snug">${esc(c.description)}</p>` : ''}
        ${r.games && r.games.length ? `<div class="space-y-2"><div class="text-[10px] font-black uppercase tracking-wider text-[#00F296]">Upcoming games</div>${r.games.map(g => gameCard(g)).join('')}</div>` : ''}
        ${top ? `<div><div class="text-[10px] font-black uppercase tracking-wider text-[#00F296] mb-1">⚽ Top scorers</div>${top}</div>` : ''}
        ${c.rules ? `<details class="bg-black/35 rounded-xl px-3 py-2"><summary class="text-xs font-bold text-white/80 cursor-pointer">Community rules</summary><p class="text-xs text-white/70 mt-1 whitespace-pre-line">${esc(c.rules)}</p></details>` : ''}`);
}

window.publicPreviewAsk = function () {
    document.getElementById('pp-actions')?.classList.add('hidden');
    document.getElementById('pp-account')?.classList.remove('hidden');
};
window.publicPreviewJoin = function () {
    hidePreview();
    if (window.showSignupScreen) window.showSignupScreen();
    else document.getElementById('view-signup')?.classList.remove('hidden');
};
window.publicPreviewSignIn = function () {
    hidePreview();
    if (window.showLoginScreen) window.showLoginScreen();
    else document.getElementById('view-login')?.classList.remove('hidden');
};

/** Signed in from a community link: open it, and send the join request they asked for. */
async function afterSignIn(user) {
    if (!LINK || LINK.kind !== 'community') return;
    let id = LINK.key;
    if (/^#c=/.test(location.hash)) {
        try { const r = await preview('community', LINK.key); id = (r.community && r.community.id) || r.id || LINK.key; } catch (e) { /* use the key */ }
        try { history.replaceState(null, '', location.pathname + '#community=' + encodeURIComponent(id)); } catch (e) { /* ignore */ }
    }
    const pending = ss.get('futnet_pending_join');
    // wait until the communities part of the site is ready, then open it
    let tries = 0;
    const t = setInterval(async () => {
        tries++;
        if (!window.openCommunity || !window.communitiesCache || (!Object.keys(window.communitiesCache).length && tries < 25)) return;
        clearInterval(t);
        try { await window.openCommunity(id); } catch (e) { /* not visible: fine */ }
        if (pending && pending === id && window.requestJoinCommunity && !(window.myCommunityRoles || {})[id]) {
            ss.set('futnet_pending_join', '');
            setTimeout(() => window.requestJoinCommunity(id), 1500);   // after the first-time screens
        }
    }, 400);
}

if (LINK) {
    let handled = false;
    onAuthStateChanged(auth, (user) => {
        if (user) {
            hidePreview();
            // #c=<link name> (new short links) or a join they asked for: open the community + send the request.
            if (!handled && (/^#c=/.test(location.hash) || ss.get('futnet_pending_join'))) { handled = true; afterSignIn(user); }
            return;
        }
        // Logged out: give the login screen a moment to appear, then show the preview on it.
        setTimeout(() => { if (!auth.currentUser && !document.getElementById('public-preview')) showPreview(); }, 300);
    });
}
