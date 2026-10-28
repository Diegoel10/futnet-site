// js/communities.js: Communities (hubs) - list, create, community page (Info / Games / Feed / Admin),
// join + approval flow, community group chat (shown in the Chat tab) and community-owned games.
// Firestore layout matches the iOS app:
//   artifacts/{appId}/communities/{id}                    -> community doc
//   artifacts/{appId}/communities/{id}/members/{uid}      -> { uid, name, avatar, role: 'admin'|'member', joinedAt, adminUntil?, suspendedUntil? }
//   artifacts/{appId}/communities/{id}/requests/{uid}     -> { uid, name, avatar, requestedAt }
//   artifacts/{appId}/communities/{id}/feed/{postId}      -> status / photo / poll posts
//   artifacts/{appId}/communities/{id}/messages/{msgId}   -> group chat messages (new)
//   artifacts/{appId}/eventsList/{gameId}                 -> community games carry communityId (+ communityName)
import { db, appId, auth } from './firebase-config.js';
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js";
import {
    doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, query, orderBy, limit,
    onSnapshot, serverTimestamp, increment, arrayUnion, deleteField, runTransaction, where
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { escapeHtml as esc, jsArg, mutateEvent } from './game-profile/event-store.js';
import { memberCreditHtml, adminCreditHtml, payOptionsHtml, plusExtraHtml, readPayOptions, waitlistOptionsHtml, readWaitlistOptions, paymentMethodsFormHtml, readPaymentMethods } from './credits.js';
import { attachParkPicker, saveParkIfNew } from './parks.js';
import { computePlayerStats } from './leaderboard.js';
import './money-tracker.js';
import './analytics.js';
import { renderWhatsApp, typingBubbleHtml, typingText, watchTyping, msOf, uploadMedia, showUploadProgress, hideUploadProgress, mediaErrorText } from './wa-chat.js';

const DEFAULT_THUMB = 'https://images.unsplash.com/photo-1431324155629-1a6deb1dec8d?w=800';
const DEFAULT_AVATAR = 'https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg';
const BTN = 'px-3 py-2 rounded-xl text-xs font-bold transition';
const BTN_PRIMARY = `${BTN} bg-[#00F296] text-slate-950 hover:opacity-90`;
const BTN_DARK = `${BTN} bg-black/50 border border-white/15 text-white hover:bg-black`;
const BTN_DANGER = `${BTN} bg-red-500/20 border border-red-500/50 text-red-300 hover:bg-red-500/30`;
const HDR_BTN = 'flex flex-col items-center justify-center gap-1 py-2.5 rounded-xl bg-black/50 border border-white/15 hover:border-[#00F296]/60 text-white text-[11px] font-bold transition';
const INPUT = 'w-full bg-black/60 border border-teal-500/50 rounded-xl px-3 py-2.5 text-white text-base sm:text-xs focus:outline-none focus:border-[#00F296]';
const CARD = 'bg-[#040E13]/90 border border-emerald-500/30 rounded-2xl shadow-xl backdrop-blur-md';

window.communitiesCache = window.communitiesCache || {};     // id -> community data
window.myCommunityRoles = window.myCommunityRoles || {};     // id -> 'admin' | 'member'
window.communityChatThreads = [];

const S = {
    activeId: null, tab: 'info',
    members: [], requests: [], feed: [], busy: false,
    credits: {}, myCredit: null, ledger: [], creditFor: null,
    unsubs: [], chatUnsub: null, activeChatCommunity: null, chatMessages: []
};

const me = () => window.currentUser;
const myName = () => window.userProfile?.name
    || `${window.userProfile?.firstName || ''} ${window.userProfile?.lastName || ''}`.trim()
    || window.currentUser?.displayName || 'Player';
const myAvatar = () => window.userProfile?.avatar || window.currentUser?.photoURL || '';
const commRef = (id) => doc(db, 'artifacts', appId, 'communities', id);
const toast = (m, t) => window.showToast && window.showToast(m, t);
const tsMs = (t) => t?.toMillis ? t.toMillis() : (t?.seconds ? t.seconds * 1000 : (typeof t === 'number' ? t : 0));
const safeImg = (u, fb = DEFAULT_AVATAR) => {
    u = String(u || '');
    return (/^https?:\/\//i.test(u) || /^data:image\//i.test(u)) ? u : fb;
};
const creditOn = (c) => !!c && c.creditEnabled !== false;   // Credit system is ON unless an admin turns it off

// Profile pictures: live directory first (so old member records still show a photo), then the saved one,
// then a letter avatar made from the name. Never blank.
const usableImg = (u) => typeof u === 'string' && (/^https?:\/\//i.test(u) || /^data:image\//i.test(u));
const initialsUrl = (name) => `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(String(name || 'Player')).replace(/'/g, '%27')}`;
const avatarOf = (uidOrObj, fallback) => {
    const obj = (uidOrObj && typeof uidOrObj === 'object') ? uidOrObj : null;
    const uid = obj ? obj.uid : uidOrObj;
    const d = uid && Array.isArray(window.directoryList) ? window.directoryList.find(u => String(u.uid) === String(uid)) : null;
    const name = obj?.name || d?.name || [d?.firstName, d?.lastName].filter(Boolean).join(' ') || '';
    const saved = obj ? obj.avatar : fallback;
    const pick = [d?.avatar, d?.photoURL, saved].find(usableImg);
    return pick || initialsUrl(name);
};
const avatarImg = (who, cls) => {
    const obj = (who && typeof who === 'object') ? who : { uid: who };
    const name = obj.name || (Array.isArray(window.directoryList) ? window.directoryList.find(u => String(u.uid) === String(obj.uid))?.name : '') || '';
    return `<img src="${esc(avatarOf(obj))}" onerror="this.onerror=null;this.src='${initialsUrl(name)}'" class="${cls}">`;
};

// The directory (everyone's profile picture) must be loaded for pictures to show; load it once if it is not there yet.
let _dirLoading = null;
// Real name from the player directory when the member record has none (or just says "Player").
function normMember(m) {
    if (m && (!m.name || m.name === 'Player') && Array.isArray(window.directoryList)) {
        const d = window.directoryList.find(x => String(x.uid) === String(m.uid));
        const nm = d && (d.name || `${d.firstName || ''} ${d.lastName || ''}`.trim() || d.nickname);
        if (nm) return { ...m, name: nm };
    }
    return m;
}

// Admin tidy-up: fixes the member counter and fills in names missing from member records.
async function syncMemberRecords(id, raw) {
    const c = window.communitiesCache[id];
    if (!c || myRole(id) !== 'admin') return;
    try {
        if (raw.length && Number(c.membersCount) !== raw.length) await updateDoc(commRef(id), { membersCount: raw.length });
    } catch (e) { /* ignore */ }
    for (const m of raw) {
        const fixed = normMember(m);
        const patch = {};
        if (!m.name && fixed.name) patch.name = fixed.name;
        if (m.name === 'Player' && fixed.name && fixed.name !== 'Player') patch.name = fixed.name;
        if (Object.keys(patch).length) {
            try { await updateDoc(doc(db, 'artifacts', appId, 'communities', id, 'members', String(m.uid)), patch); } catch (e) { /* ignore */ }
        }
    }
}

async function ensureDirectory() {
    if (Array.isArray(window.directoryList) && window.directoryList.length) return;
    if (!_dirLoading) {
        _dirLoading = window.getPeopleList()
            .then(list => {
                if (!(Array.isArray(window.directoryList) && window.directoryList.length)) window.directoryList = list;
            })
            .catch(() => {})
            .finally(() => { _dirLoading = null; });
    }
    await _dirLoading;
    S.members = S.members.map(normMember);
    if (S.activeId) renderCommunityPage();
}
const fmtAgo = (ms) => {
    if (!ms) return '';
    const m = Math.floor((Date.now() - ms) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    if (m < 1440) return `${Math.floor(m / 60)}h ago`;
    return new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' });
};
const root = () => document.getElementById('tab-hub');

// ------------------------------------------------------------------ data loading
// Live list of communities: member counts, names and photos update on every screen as they change.
let communitiesUnsub = null;
function watchCommunities() {
    if (communitiesUnsub) return Promise.resolve();
    return new Promise((resolve) => {
        let first = true;
        communitiesUnsub = onSnapshot(collection(db, 'artifacts', appId, 'communities'), (snap) => {
            const map = {};
            snap.docs.forEach(d => { map[d.id] = { ...d.data(), id: d.id }; });
            window.communitiesCache = map;
            if (first) { first = false; resolve(); return; }
            // Redraw the Hub list if it's on screen (an open community redraws from its own listener).
            if (!S.activeId && !document.getElementById('tab-hub')?.classList.contains('hidden')) window.renderCommunitiesHub();
        }, (e) => { console.error('communities load', e); if (first) { first = false; resolve(); } });
    });
}

async function loadCommunities() {
    await watchCommunities();
    await loadMyRoles();
    rebuildChatThreads();
    if (window.renderEvents && !document.getElementById('tab-events')?.classList.contains('hidden')) window.renderEvents();
}

async function loadMyRoles() {
    if (!me()) return;
    const uid = me().uid;
    const ids = Object.keys(window.communitiesCache);
    const roles = {};
    await Promise.all(ids.map(async id => {
        const c = window.communitiesCache[id];
        if (c.adminId === uid || c.creatorId === uid) { roles[id] = 'admin'; return; }
        try {
            const s = await getDoc(doc(db, 'artifacts', appId, 'communities', id, 'members', uid));
            if (s.exists()) roles[id] = s.data().role === 'admin' ? 'admin' : 'member';
        } catch (e) { /* not a member / no access */ }
    }));
    window.myCommunityRoles = roles;
}

window.isCommunityMember = async function(communityId) {
    if (!me() || !communityId) return false;
    if (window.myCommunityRoles[communityId]) return true;
    const c = window.communitiesCache[communityId];
    if (c && (c.adminId === me().uid || c.creatorId === me().uid)) return true;
    try {
        const s = await getDoc(doc(db, 'artifacts', appId, 'communities', communityId, 'members', me().uid));
        if (s.exists()) { window.myCommunityRoles[communityId] = s.data().role === 'admin' ? 'admin' : 'member'; return true; }
    } catch (e) { /* ignore */ }
    return false;
};

function isSuspended(m) { return tsMs(m?.suspendedUntil) > Date.now(); }
// A suspension can cover joining games, chat and the feed. Older suspensions (no scope saved) cover everything.
const SUSPEND_SCOPES = [['games', 'Joining games'], ['chat', 'Chat'], ['feed', 'Feed']];
function suspendedScopes(m) {
    if (!isSuspended(m)) return null;
    const sc = m.suspendScope;
    if (sc && typeof sc === 'object') return { games: !!sc.games, chat: !!sc.chat, feed: !!sc.feed };
    return { games: true, chat: true, feed: true };
}
const scopeLabels = (sc) => SUSPEND_SCOPES.filter(([k]) => sc && sc[k]).map(([, l]) => l).join(', ');
const fmtDate = (ms) => ms ? new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
const suspFrom = (k) => !!(S.mySusp && S.mySusp[k]);

// Other screens (joining a game) ask: is this person suspended from X in this community?
window.communitySuspension = async function(communityId) {
    if (!me() || !communityId) return null;
    try {
        const ms = await getDoc(doc(db, 'artifacts', appId, 'communities', communityId, 'members', me().uid));
        if (!ms.exists()) return null;
        const d = ms.data(); const sc = suspendedScopes(d);
        return sc ? { ...sc, reason: d.suspendReason || '', until: tsMs(d.suspendedUntil) } : null;
    } catch (e) { return null; }
};
function isAdminRole(m, c) {
    if (!m) return false;
    if (m.uid === c?.adminId) return true;
    if (m.role !== 'admin') return false;
    const until = tsMs(m.adminUntil);
    return !until || until > Date.now();
}
const myRole = (id) => window.myCommunityRoles[id] || null;

// ------------------------------------------------------------------ HUB LIST
window.renderCommunitiesHub = async function() {
    const el = root();
    if (!el) return;
    stopCommunityListeners();
    S.activeId = null;
    const q = (document.getElementById('hub-search')?.value || '').toLowerCase().trim();
    if (!Object.keys(window.communitiesCache).length) await loadCommunities();

    let list = Object.values(window.communitiesCache);
    if (q) list = list.filter(c => `${c.name} ${c.city} ${c.state}`.toLowerCase().includes(q));
    list.sort((a, b) => (myRole(b.id) ? 1 : 0) - (myRole(a.id) ? 1 : 0) || (b.membersCount || 0) - (a.membersCount || 0));

    const focus = document.activeElement?.id === 'hub-search';
    const showSearch = q || Object.keys(window.communitiesCache).length > 4;   // only useful with several communities
    el.innerHTML = `
        <div class="flex items-center justify-between gap-3 px-1 pt-1">
            <div class="min-w-0">
                <h2 class="text-[22px] font-black text-white uppercase tracking-wide leading-tight">Communities</h2>
                <p class="text-white/60 text-[13px]">Your local football hubs &amp; leagues</p>
            </div>
            <button onclick="showCommunityCreation()" class="shrink-0 bg-[#00E08F] hover:opacity-95 text-slate-950 font-black text-sm px-4 py-2.5 rounded-2xl flex items-center gap-2 shadow-[0_0_14px_rgba(0,224,143,0.35)]">
                <i class="fa-solid fa-circle-plus"></i> New Hub</button>
        </div>
        ${showSearch ? `<input id="hub-search" oninput="renderCommunitiesHub()" value="${esc(q)}" class="${INPUT}" placeholder="Search communities by name or city...">` : ''}
        ${list.length === 0 ? `
            <div class="${CARD} p-10 text-center space-y-2">
                <i class="fa-solid fa-people-group text-4xl text-teal-400/60"></i>
                <div class="text-sm font-black text-white">No Communities Found</div>
                <p class="text-xs text-white/50">Create a community or join one via an invite link to get started.</p>
            </div>` : `
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            ${list.map(communityCard).join('')}
        </div>`}`;
    if (focus) { const i = document.getElementById('hub-search'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
    paintHubAdmins();
};

// ---- "Admin: Diego Ponce" on each community card (same as the iPhone app).
// Shown right away when known (player list loaded, or remembered on this device); otherwise a soft
// "Loading…" for a moment, never a fake "Organizer".
const ADMIN_KEY = (uid) => `futnet_admin_${uid}`;
function adminCardOf(uid) {
    if (!uid) return null;
    const d = (window.directoryList || []).find(u => String(u.uid) === String(uid));
    if (d) {
        const name = d.name || `${d.firstName || ''} ${d.lastName || ''}`.trim();
        const avatar = /^https?:\/\//.test(d.avatar || '') ? d.avatar : '';
        try { localStorage.setItem(ADMIN_KEY(uid), JSON.stringify({ name, avatar })); } catch (e) { /* private mode */ }
        return { name, avatar: d.avatar || '' };
    }
    try { const saved = JSON.parse(localStorage.getItem(ADMIN_KEY(uid)) || 'null'); if (saved && saved.name) return saved; } catch (e) { /* none */ }
    return null;
}
function adminRowHtml(uid) {
    const a = adminCardOf(uid);
    if (!a) return `<span class="w-7 h-7 rounded-full bg-white/10 shrink-0"></span><span class="text-xs text-white/40">Admin: Loading…</span>`;
    const pic = safeImg(a.avatar, '');
    return `${pic ? `<img src="${esc(pic)}" class="w-7 h-7 rounded-full object-cover border-2 border-[#00F296] shrink-0">`
        : `<span class="w-7 h-7 rounded-full border-2 border-[#00F296] bg-[#00F296]/20 flex items-center justify-center text-[11px] font-black text-white shrink-0">${esc((a.name || '?')[0])}</span>`}
        <span class="text-xs text-white/70 truncate">Admin: <b class="text-white">${esc(a.name || 'Organizer')}</b></span>`;
}
function paintHubAdmins() {
    document.querySelectorAll('[data-hub-admin]').forEach(el => {
        const html = adminRowHtml(el.getAttribute('data-hub-admin'));
        if (el.innerHTML !== html) el.innerHTML = html;
    });
}
window.addEventListener('futnet-people', paintHubAdmins);   // the player list just arrived: fill in the names

function communityCard(c) {
    const adminUid = c.creatorId || c.adminId || '';
    return `
    <div onclick="openCommunity('${jsArg(c.id)}')" class="bg-[#040E13]/95 border border-teal-500/30 rounded-[22px] overflow-hidden cursor-pointer hover:border-emerald-400 transition shadow-xl">
        <div class="bg-black/40">
            <img src="${esc(safeImg(c.thumbnail, DEFAULT_THUMB))}" class="block w-full h-auto max-h-[70vh] object-contain mx-auto">
        </div>
        <div class="px-5 pt-4 pb-4 space-y-3">
            <div class="flex items-center justify-between gap-3">
                <div class="min-w-0 space-y-1">
                    <h3 class="text-base font-black text-white truncate">${esc(c.name || 'Community')}</h3>
                    <div class="flex items-center gap-2 text-xs text-white/60">
                        ${c.city ? `<span class="truncate"><i class="fa-solid fa-location-dot text-[#00F296] mr-1"></i>${esc(c.city)}${c.state ? ', ' + esc(c.state) : ''}</span><span class="text-white/40">•</span>` : ''}
                        <span class="font-bold text-teal-300 shrink-0">${Number(c.membersCount) || 1} Member(s)</span>
                    </div>
                </div>
                <i class="fa-solid fa-chevron-right text-white/40 text-sm shrink-0"></i>
            </div>
            ${adminUid ? `<div class="h-px bg-white/10"></div>
            <div class="flex items-center gap-2.5 min-w-0" data-hub-admin="${esc(adminUid)}">${adminRowHtml(adminUid)}</div>` : ''}
        </div>
    </div>`;
}

// ------------------------------------------------------------------ CREATE / EDIT COMMUNITY
function resizeImageToJpeg(file, maxW = 800, quality = 0.7) {
    return new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onerror = reject;
        fr.onload = () => {
            const img = new Image();
            img.onerror = reject;
            img.onload = () => {
                const scale = Math.min(1, maxW / img.width);
                const cv = document.createElement('canvas');
                cv.width = Math.round(img.width * scale); cv.height = Math.round(img.height * scale);
                cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
                resolve(cv.toDataURL('image/jpeg', quality));
            };
            img.src = fr.result;
        };
        fr.readAsDataURL(file);
    });
}

function modalShell(id, title, subtitle, bodyHtml) {
    let m = document.getElementById(id);
    if (!m) { m = document.createElement('div'); m.id = id; document.body.appendChild(m); }
    m.className = 'fixed inset-0 z-[140] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-md sm:p-4';
    m.innerHTML = `
        <div class="bg-[#040E13] border border-emerald-500/40 rounded-t-3xl sm:rounded-3xl w-full max-w-md overflow-y-auto shadow-2xl text-white" style="max-height:88vh;max-height:88dvh">
            <div class="flex items-center justify-between px-5 pt-6 pb-2 sticky top-0 bg-[#040E13] z-10">
                <div><div class="text-sm font-black">${title}</div><div class="text-[10px] text-white/60">${subtitle || ''}</div></div>
                <button onclick="closeCommunityModal('${id}')" class="w-8 h-8 rounded-full bg-black/60 border border-white/15 flex items-center justify-center"><i class="fa-solid fa-xmark text-xs"></i></button>
            </div>
            <div class="p-5 pt-2 space-y-4">${bodyHtml}</div>
        </div>`;
    return m;
}
window.closeCommunityModal = (id) => document.getElementById(id)?.remove();

// Whole-screen page (like the New post screen) with a back/close button on top.
function fullScreenShell(id, title, subtitle, bodyHtml) {
    let m = document.getElementById(id);
    if (!m) { m = document.createElement('div'); m.id = id; document.body.appendChild(m); }
    m.className = 'fixed inset-0 z-[140] bg-[#040E13] flex flex-col text-white';
    m.innerHTML = `
        <div class="flex items-center gap-3 px-4 py-3 border-b border-white/10 shrink-0">
            <button onclick="closeCommunityModal('${id}')" class="w-9 h-9 rounded-full bg-black/60 border border-white/15 flex items-center justify-center" aria-label="Close"><i class="fa-solid fa-xmark text-sm"></i></button>
            <div class="min-w-0"><div class="text-base font-black truncate">${title}</div><div class="text-[11px] text-white/60 truncate">${subtitle || ''}</div></div>
        </div>
        <div class="flex-1 overflow-y-auto"><div class="max-w-2xl mx-auto w-full p-4 space-y-4">${bodyHtml}</div></div>`;
    return m;
}

const lbl = (t) => `<label class="block text-[10px] font-black uppercase tracking-wider text-[#00F296] mb-1">${t}</label>`;
const toggleRow = (id, title, sub, checked) => `
    <label class="flex items-center justify-between gap-3 bg-black/40 border border-white/10 rounded-xl p-3 cursor-pointer">
        <span><span class="block text-xs font-bold text-white">${title}</span><span class="block text-[10px] text-white/50">${sub}</span></span>
        <input id="${id}" type="checkbox" ${checked ? 'checked' : ''} class="w-5 h-5 accent-[#00F296] shrink-0">
    </label>`;

function communityFormBody(c, isEdit) {
    c = c || {};
    return `
        <div>${lbl('Community cover photo (optional)')}
            <label class="block min-h-[8rem] rounded-2xl overflow-hidden border border-teal-500/40 bg-black/50 cursor-pointer relative">
                <img id="cf-thumb-preview" src="${esc(safeImg(c.thumbnail, ''))}" class="block w-full h-auto max-h-64 object-contain mx-auto ${c.thumbnail ? '' : 'hidden'}">
                <div id="cf-thumb-empty" class="absolute inset-0 flex flex-col items-center justify-center text-xs font-bold text-white/70 ${c.thumbnail ? 'hidden' : ''}"><i class="fa-solid fa-image text-2xl text-[#00F296] mb-1"></i>Tap to add cover photo</div>
                <input type="file" accept="image/*" class="hidden" onchange="previewCommunityThumb(this)">
            </label></div>
        <div>${lbl('Community name *')}<input id="cf-name" maxlength="60" class="${INPUT}" value="${esc(c.name || '')}" placeholder="Community name"></div>
        <div class="flex gap-3">
            <div class="flex-1">${lbl('City *')}<input id="cf-city" class="${INPUT}" value="${esc(c.city || '')}" placeholder="City"></div>
            <div class="w-20">${lbl('State')}<input id="cf-state" maxlength="3" class="${INPUT}" value="${esc(c.state || 'FL')}"></div>
        </div>
        <div>${lbl('Group description')}<textarea id="cf-desc" rows="3" class="${INPUT}" placeholder="What's your group about?">${esc(c.description || '')}</textarea></div>
        <div>${lbl('Member requirements')}<textarea id="cf-req" rows="2" class="${INPUT}" placeholder="Any rules to join?">${esc(c.requirements || '')}</textarea></div>
        <div>${lbl('Community rules')}<textarea id="cf-rules" rows="2" class="${INPUT}" placeholder="Community rules...">${esc(c.rules || '')}</textarea></div>
        ${(() => {
            // Welcome message: on/off switch, then the text (hidden while off). Old communities with a text count as on.
            const on = c.welcomeEnabled === true || (c.welcomeEnabled !== false && !!c.welcomeMessage);
            return `<div class="space-y-2">
            <label class="flex items-center justify-between gap-3 bg-black/40 border border-white/10 rounded-xl p-3 cursor-pointer">
                <span><span class="block text-xs font-bold text-white">Send a welcome message</span><span class="block text-[10px] text-white/50">New members get it as a private chat from the creator, so they can reply</span></span>
                <input id="cf-welcome-on" type="checkbox" ${on ? 'checked' : ''} onchange="document.getElementById('cf-welcome-box').classList.toggle('hidden', !this.checked)" class="w-5 h-5 accent-[#00F296] shrink-0">
            </label>
            <div id="cf-welcome-box" class="${on ? '' : 'hidden'}">${lbl('Welcome message')}<textarea id="cf-welcome" rows="3" maxlength="1000" class="${INPUT}" placeholder="Hey {name}! Welcome to the group ⚽ Games are Tuesdays at 7…">${esc(c.welcomeMessage || '')}</textarea>
                <p class="text-[10px] text-white/50 mt-1">{name} becomes their first name. Sent once to each new member.</p></div>
            </div>`;
        })()}
        ${(() => {
            // Public share page: anyone with the link can look (no phone numbers, chat or member list), ON by default.
            const on = c.publicPreview !== false;
            const suggested = c.slug || slugify(c.name || '');
            return `<div class="space-y-2">
            <label class="flex items-center justify-between gap-3 bg-black/40 border border-white/10 rounded-xl p-3 cursor-pointer">
                <span><span class="block text-xs font-bold text-white">Public page (share link)</span><span class="block text-[10px] text-white/50">People without an account can see the info, games and Top scorers, then sign up to join</span></span>
                <input id="cf-public" type="checkbox" ${on ? 'checked' : ''} class="w-5 h-5 accent-[#00F296] shrink-0">
            </label>
            <div>${lbl('Link name')}
                <div class="flex items-center bg-black border border-teal-500/60 rounded-xl overflow-hidden">
                    <span class="pl-3 pr-1 text-xs text-white/50 shrink-0">futnet.site/c/</span>
                    <input id="cf-slug" maxlength="40" value="${esc(suggested)}" oninput="this.value=this.value.toLowerCase().replace(/[^a-z0-9-]/g,'-')" class="flex-1 min-w-0 bg-transparent py-2.5 pr-3 text-white text-base sm:text-sm focus:outline-none" placeholder="firefighters">
                </div>
                <p class="text-[10px] text-white/50 mt-1">Letters, numbers and dashes. Leave empty to use a long link.</p></div>
            </div>`;
        })()}
        ${isEdit ? '' : toggleRow('cf-approval', 'Require approval to join', 'Admins approve every join request', c.requireApproval !== false)}
        <button id="cf-submit" onclick="${isEdit ? `submitEditCommunity('${jsArg(c.id)}')` : 'submitCreateCommunity()'}" class="${BTN_PRIMARY} w-full py-3 text-sm">${isEdit ? 'Save Changes' : 'Create Community'}</button>`;
}

const slugify = (v) => String(v || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
/** Link name from the form, checked with the server. Returns '' (no name), the name, or null (taken: toast shown). */
async function readSlug(communityId, quietIfTaken = false) {
    const raw = slugify(document.getElementById('cf-slug')?.value || '');
    if (!raw) return '';
    if (raw.length < 3) { if (!quietIfTaken) toast('Link name needs at least 3 letters', 'error'); return quietIfTaken ? '' : null; }
    try {
        const r = await httpsCallable(getFunctions(auth.app, 'us-central1'), 'checkCommunitySlug')({ slug: raw, communityId: communityId || '' });
        if (r.data && r.data.taken) { if (!quietIfTaken) toast(`futnet.site/c/${raw} is taken. Try another name.`, 'error'); return quietIfTaken ? '' : null; }
        return (r.data && r.data.slug) || raw;
    } catch (e) { return quietIfTaken ? '' : raw; }   // server not updated yet: keep the name
}

window._cfThumb = null;
window.previewCommunityThumb = async function(input) {
    const f = input.files && input.files[0];
    if (!f) return;
    try {
        window._cfThumb = await resizeImageToJpeg(f);
        const img = document.getElementById('cf-thumb-preview');
        img.src = window._cfThumb; img.classList.remove('hidden');
        document.getElementById('cf-thumb-empty')?.classList.add('hidden');
    } catch (e) { toast('Could not read that image', 'error'); }
};

window.showCommunityCreation = function() {
    if (!me()) { toast('Please sign in first', 'error'); return; }
    window._cfThumb = null;
    modalShell('community-modal', 'Create Community', 'Build a hub with its own chat, games and feed', communityFormBody(null, false));
};

window.submitCreateCommunity = async function() {
    if (!me() || S.busy) return;
    const name = document.getElementById('cf-name').value.trim();
    const city = document.getElementById('cf-city').value.trim();
    if (!name || !city) { toast('Community name and city are required', 'error'); return; }
    S.busy = true;
    const btn = document.getElementById('cf-submit'); if (btn) btn.disabled = true;
    const slug = await readSlug('', true);   // new community: a taken name is just skipped (long link)
    const id = 'comm_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const uid = me().uid;
    const data = {
        id, name, city,
        state: document.getElementById('cf-state').value.trim() || 'FL',
        description: document.getElementById('cf-desc').value.trim(),
        requirements: document.getElementById('cf-req').value.trim(),
        rules: document.getElementById('cf-rules').value.trim(),
        welcomeMessage: (document.getElementById('cf-welcome')?.value || '').trim(),
        welcomeEnabled: !!document.getElementById('cf-welcome-on')?.checked,
        requireApproval: document.getElementById('cf-approval').checked, creditEnabled: true,
        adminOnlyFeed: false, matchesVisibleToNonMembers: true,
        thumbnail: window._cfThumb || DEFAULT_THUMB,
        slug, publicPreview: document.getElementById('cf-public')?.checked !== false,
        adminId: uid, membersCount: 1, createdAt: serverTimestamp()
    };
    try {
        await setDoc(commRef(id), data);
        await setDoc(doc(db, 'artifacts', appId, 'communities', id, 'members', uid),
            { uid, name: myName(), avatar: myAvatar(), role: 'admin', joinedAt: serverTimestamp() });
        window.communitiesCache[id] = { ...data, createdAt: null };
        window.myCommunityRoles[id] = 'admin';
        rebuildChatThreads();
        window.closeCommunityModal('community-modal');
        showShareModal(id);
        window.switchTab('hub');
    } catch (e) {
        console.error(e); toast('Could not create community', 'error');
    } finally { S.busy = false; }
};

window.submitEditCommunity = async function(id) {
    const name = document.getElementById('cf-name').value.trim();
    const city = document.getElementById('cf-city').value.trim();
    if (!name || !city) { toast('Community name and city are required', 'error'); return; }
    const upd = {
        name, city,
        state: document.getElementById('cf-state').value.trim() || 'FL',
        description: document.getElementById('cf-desc').value.trim(),
        requirements: document.getElementById('cf-req').value.trim(),
        rules: document.getElementById('cf-rules').value.trim(),
        welcomeMessage: (document.getElementById('cf-welcome')?.value || '').trim(),
        welcomeEnabled: !!document.getElementById('cf-welcome-on')?.checked,
        publicPreview: document.getElementById('cf-public')?.checked !== false
    };
    const slug = await readSlug(id);
    if (slug === null) return;   // taken: they pick another name
    upd.slug = slug;
    if (window._cfThumb) upd.thumbnail = window._cfThumb;
    try {
        await updateDoc(commRef(id), upd);
        window.communitiesCache[id] = { ...window.communitiesCache[id], ...upd };
        window.closeCommunityModal('community-modal');
        rebuildChatThreads();
        renderCommunityPage();
        toast('Community updated');
    } catch (e) { console.error(e); toast('Could not save changes', 'error'); }
};

window.editCommunityInfo = function(id) {
    window._cfThumb = null;
    modalShell('community-modal', 'Edit Community', 'Update hub info & thumbnail', communityFormBody(window.communitiesCache[id], true));
};

// ------------------------------------------------------------------ SHARE
// Short share link: futnet.site/c/<link name> (or the community id when there is no link name)
const communityLink = (id) => `https://futnet.site/c/${encodeURIComponent((window.communitiesCache[id] || {}).slug || id)}`;
function showShareModal(id) {
    const c = window.communitiesCache[id] || {};
    const link = communityLink(id);
    const wa = `https://api.whatsapp.com/send?text=${encodeURIComponent(`Join my football community '${c.name}' on FutNet: ${link}`)}`;
    modalShell('community-share-modal', 'Community Created! 🎉', `${esc(c.name)} is live. Invite players to join your hub.`, `
        <div class="flex items-center gap-2 bg-black/50 border border-teal-500/40 rounded-xl p-3">
            <span class="text-[11px] text-white/80 truncate flex-1">${esc(link)}</span>
            <button onclick="copyCommunityLink('${jsArg(id)}')" class="${BTN_PRIMARY} shrink-0">Copy Link</button>
        </div>
        <a href="${esc(wa)}" target="_blank" rel="noopener" class="${BTN} block text-center bg-green-500 text-black">WhatsApp</a>
        <button onclick="closeCommunityModal('community-share-modal')" class="${BTN_DARK} w-full py-3">Done</button>`);
}
// ---- Expiring invite links (admins): valid for 2 hours, join directly without approval.
const INVITE_HOURS = 2;
const inviteLink = (id, token) => `${location.origin}${location.pathname}#community=${encodeURIComponent(id)}&invite=${encodeURIComponent(token)}`;
const fmtClock = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

window.createCommunityInvite = async (id) => {
    if (!me()) return;
    const c = window.communitiesCache[id] || {};
    const btn = document.getElementById('invite-create-btn'); if (btn) btn.disabled = true;
    try {
        const token = Array.from(crypto.getRandomValues(new Uint8Array(12))).map(b => b.toString(36).padStart(2, '0')).join('').slice(0, 20);
        const expiresAtMs = Date.now() + INVITE_HOURS * 3600000;
        await setDoc(doc(db, 'artifacts', appId, 'communities', id, 'invites', token), {
            token, communityId: id, createdBy: me().uid, createdByName: myName(), createdAt: serverTimestamp(), expiresAtMs
        });
        const link = inviteLink(id, token);
        const box = document.getElementById('invite-result');
        if (box) {
            const wa = `https://api.whatsapp.com/send?text=${encodeURIComponent(`Join my football community '${c.name}' on FutNet (link works until ${fmtClock(expiresAtMs)}): ${link}`)}`;
            box.innerHTML = `
                <div class="flex items-center gap-2 bg-black/50 border border-teal-500/40 rounded-xl p-3">
                    <span class="text-[11px] text-white/80 truncate flex-1">${esc(link)}</span>
                    <button onclick="copyInviteLink('${jsArg(link)}')" class="${BTN_PRIMARY} shrink-0">Copy</button>
                </div>
                <p class="text-[11px] text-white/60 mt-2">Expires today at <b class="text-white">${fmtClock(expiresAtMs)}</b>. Anyone who opens it before then joins right away, no approval needed.</p>
                <a href="${wa}" target="_blank" rel="noopener" class="${BTN_DARK} block text-center w-full py-3 mt-2"><i class="fa-brands fa-whatsapp mr-1"></i> Send on WhatsApp</a>`;
        }
        if (btn) btn.textContent = 'Create a new link';
    } catch (e) { console.error(e); toast('Could not create invite link', 'error'); }
    finally { if (btn) btn.disabled = false; }
};
window.copyInviteLink = async (link) => {
    try { await navigator.clipboard.writeText(link); toast('Invite link copied!'); }
    catch (e) { window.prompt('Copy this link:', link); }
};

function showInviteProblem(adminName) {
    modalShell('invite-problem-modal', 'This invite link expired', '', `
        <p class="text-sm text-white/80">The link you have has expired. Ask <b class="text-white">${esc(adminName || 'a community admin')}</b> to send you another one.</p>
        <button onclick="closeCommunityModal('invite-problem-modal')" class="${BTN_PRIMARY} w-full py-3 text-sm">OK</button>`);
}

window.answerInvite = (yes) => { if (window._inviteAnswer) { const f = window._inviteAnswer; window._inviteAnswer = null; f(!!yes); } };

async function redeemInvite(id, token) {
    const uid = me().uid;
    const memRef = doc(db, 'artifacts', appId, 'communities', id, 'members', uid);
    try { if ((await getDoc(memRef)).exists()) return true; } catch (e) { /* ignore */ }
    let inv = null;
    try { const s = await getDoc(doc(db, 'artifacts', appId, 'communities', id, 'invites', token)); inv = s.exists() ? s.data() : null; }
    catch (e) { console.error(e); }
    if (!inv || !(Number(inv.expiresAtMs) > Date.now())) {
        let who = inv?.createdByName || '';
        if (!who) {
            try {
                const c = (await getDoc(commRef(id))).data();
                if (c?.adminId) who = (await getDoc(doc(db, 'artifacts', appId, 'communities', id, 'members', c.adminId))).data()?.name || '';
            } catch (e) { /* ignore */ }
        }
        showInviteProblem(who);
        return false;
    }
    // Ask first: nobody is added without tapping Accept.
    const cInfo = window.communitiesCache[id] || (await getDoc(commRef(id)).then(x => x.data()).catch(() => null)) || {};
    const accepted = await new Promise((resolve) => {
        window._inviteAnswer = resolve;
        modalShell('invite-accept-modal', 'You are invited', esc(cInfo.name || 'Community'), `
            <p class="text-sm text-white/90 leading-relaxed">${esc(inv.createdByName || 'An admin')} invited you to join <b>${esc(cInfo.name || 'this community')}</b>. Do you want to accept?</p>
            <div class="flex gap-3">
                <button onclick="answerInvite(false)" class="${BTN_DARK} flex-1 py-3">Not now</button>
                <button onclick="answerInvite(true)" class="${BTN_PRIMARY} flex-1 py-3">Accept</button>
            </div>`);
    });
    window.closeCommunityModal('invite-accept-modal');
    if (!accepted) return false;
    try {
        await setDoc(memRef, { uid, name: myName(), avatar: myAvatar(), role: 'member', joinedAt: serverTimestamp(), joinedVia: token });
        await updateDoc(commRef(id), { membersCount: increment(1) });
        try { await deleteDoc(doc(db, 'artifacts', appId, 'communities', id, 'requests', uid)); } catch (e) { /* none */ }
        window.myCommunityRoles[id] = 'member';
        const c = window.communitiesCache[id] || (await getDoc(commRef(id))).data() || {};
        toast(`Welcome to ${c.name || 'the community'}!`);
        await loadCommunities();
        return true;
    } catch (e) { console.error(e); toast('Could not join with this invite', 'error'); return false; }
}

window.shareCommunity = (id) => {
    const c = window.communitiesCache[id] || {};
    const needs = c.requireApproval !== false;
    const groupBlock = `
        <div class="space-y-2">
            <div class="text-[10px] font-black uppercase tracking-wider text-[#00F296]">Share group</div>
            <p class="text-[11px] text-white/60">${needs ? 'Anyone who opens this link can ask to join. An admin has to approve them.' : 'Anyone who opens this link can join.'}</p>
            <div class="flex items-center gap-2 bg-black/50 border border-teal-500/40 rounded-xl p-3">
                <span class="text-[11px] text-white/80 truncate flex-1">${esc(communityLink(id))}</span>
                <button onclick="copyCommunityLink('${jsArg(id)}')" class="${BTN_PRIMARY} shrink-0">Copy</button>
            </div>
        </div>`;
    const inviteBlock = myRole(id) === 'admin' ? `
        <div class="space-y-2 border-t border-white/10 pt-4">
            <div class="text-[10px] font-black uppercase tracking-wider text-[#00F296]">Game invite</div>
            <p class="text-[11px] text-white/60">A private link that works for ${INVITE_HOURS} hours. People who open it get in right away, no approval needed.</p>
            <button id="invite-create-btn" onclick="createCommunityInvite('${jsArg(id)}')" class="${BTN_PRIMARY} w-full py-3 text-sm">Create game invite (${INVITE_HOURS} hours)</button>
            <div id="invite-result"></div>
        </div>` : '';
    modalShell('community-share-modal', 'Share', esc(c.name), `
        ${groupBlock}${inviteBlock}
        <button onclick="closeCommunityModal('community-share-modal')" class="${BTN_DARK} w-full py-3">Done</button>`);
};
window.copyCommunityLink = async (id) => {
    try { await navigator.clipboard.writeText(communityLink(id)); toast('Link copied!'); }
    catch (e) { window.prompt('Copy this link:', communityLink(id)); }
};

// ------------------------------------------------------------------ COMMUNITY PAGE
function stopCommunityListeners() {
    S.unsubs.forEach(u => { try { u(); } catch (e) {} });
    S.unsubs = []; S.creditFor = null; S.credits = {}; S.myCredit = null; S.ledger = [];
}

// Credit listeners are only started for communities that switched Credit on (saves reads).
function ensureCreditListeners(c, role) {
    if (!role || !c || !creditOn(c) || S.creditFor === c.id) return;
    S.creditFor = c.id;
    const base = ['artifacts', appId, 'communities', c.id];
    const uid = me().uid;
    const sorter = (a, b) => tsMs(b.at) - tsMs(a.at);
    if (role === 'admin') {
        S.unsubs.push(onSnapshot(collection(db, ...base, 'credits'), s => {
            S.credits = {}; s.docs.forEach(d => { S.credits[d.id] = d.data(); }); if (document.getElementById('cm-list')) window.refreshCommunityMembersList();
            if (S.tab === 'credit') renderCommunityPage();
        }, () => {}));
        S.unsubs.push(onSnapshot(query(collection(db, ...base, 'creditLedger'), orderBy('at', 'desc'), limit(50)), s => {
            S.ledger = s.docs.map(d => d.data());
            if (S.tab === 'credit') renderCommunityPage();
        }, () => {}));
    } else {
        S.unsubs.push(onSnapshot(doc(db, ...base, 'credits', uid), s => {
            S.myCredit = s.exists() ? s.data() : null;
            if (S.tab === 'credit') renderCommunityPage();
        }, () => {}));
        S.unsubs.push(onSnapshot(query(collection(db, ...base, 'creditLedger'), where('uid', '==', uid)), s => {
            S.ledger = s.docs.map(d => d.data()).sort(sorter);
            if (S.tab === 'credit') renderCommunityPage();
        }, () => {}));
    }
}

// Keeps my own member record's picture and name current (old records may have none).
let _healedFor = null;
async function healMyMemberRecord(cid) {
    if (!me() || _healedFor === cid) return;
    const mine = S.members.find(m => m.uid === me().uid);
    if (!mine) return;
    _healedFor = cid;
    const d = Array.isArray(window.directoryList) ? window.directoryList.find(u => String(u.uid) === String(me().uid)) : null;
    const best = [window.userProfile?.avatar, d?.avatar, me().photoURL].find(u => usableImg(u) && u.length <= 60000);
    const patch = {};
    if (best && mine.avatar !== best) patch.avatar = best;
    if ((!mine.name || mine.name === 'Player') && myName() && myName() !== 'Player') patch.name = myName();
    if (!Object.keys(patch).length) return;
    try { await updateDoc(doc(db, 'artifacts', appId, 'communities', cid, 'members', me().uid), patch); }
    catch (e) { /* the rules may not allow it; pictures still come from the directory */ }
}

window.openCommunity = async function(id, tab) {
    if (!window.currentUser) return;
    stopCommunityListeners();
    S.activeId = id; S.tab = tab || 'info'; S.members = []; S.requests = []; S.feed = [];
    if (window.switchTab && document.getElementById('tab-hub')?.classList.contains('hidden')) window.switchTab('hub');
    let c = window.communitiesCache[id];
    if (!c) {
        try {
            const s = await getDoc(commRef(id));
            if (!s.exists()) { toast('Community not found', 'error'); return window.renderCommunitiesHub(); }
            c = { ...s.data(), id }; window.communitiesCache[id] = c;
        } catch (e) { toast('Could not open community', 'error'); return; }
    }
    // membership
    const uid = me().uid;
    let role = null, pending = false, mySusp = null;
    if (c.adminId === uid) role = 'admin';
    try {
        const ms = await getDoc(doc(db, 'artifacts', appId, 'communities', id, 'members', uid));
        if (ms.exists()) {
            role = (ms.data().role === 'admin' || c.adminId === uid) ? 'admin' : 'member';
            const sc = suspendedScopes(ms.data());
            if (sc) mySusp = { ...sc, reason: ms.data().suspendReason || '', until: tsMs(ms.data().suspendedUntil) };
        }
        else if (!role) pending = (await getDoc(doc(db, 'artifacts', appId, 'communities', id, 'requests', uid))).exists();
    } catch (e) { /* ignore */ }
    if (role) window.myCommunityRoles[id] = role; else delete window.myCommunityRoles[id];
    S.pending = pending; S.mySusp = mySusp;
    if (window.recordCommunityView) window.recordCommunityView(id, 'community', id, c.name || 'Community');   // analytics (admins aren't counted)

    const base = ['artifacts', appId, 'communities', id];
    ensureDirectory();
    S.unsubs.push(onSnapshot(collection(db, ...base, 'members'), s => {
        // The document id IS the user id, so a member record that lost its uid / name still shows up correctly.
        const raw = s.docs.map(d => ({ uid: d.id, ...d.data() }));
        S.members = raw.map(normMember);
        if (document.getElementById('cm-list')) window.refreshCommunityMembersList();   // members page open: keep it live
        renderCommunityPage();
        healMyMemberRecord(id);
        if (!s.metadata.fromCache) syncMemberRecords(id, raw);
    }, () => {}));
    if (role === 'admin') {
        S.unsubs.push(onSnapshot(collection(db, ...base, 'requests'), s => {
            S.requests = s.docs.map(d => d.data()); renderCommunityPage();
        }, () => {}));
    }
    if (role) {
        S.unsubs.push(onSnapshot(collection(db, ...base, 'feed'), s => {
            S.feed = s.docs.map(d => d.data()).sort((a, b) => tsMs(b.createdAt) - tsMs(a.createdAt) || 0);
            if (S.tab === 'feed') renderCommunityPage();
        }, () => {}));
    }
    S.unsubs.push(onSnapshot(commRef(id), s => {
        if (s.exists()) {
            window.communitiesCache[id] = { ...s.data(), id };
            ensureCreditListeners(window.communitiesCache[id], myRole(id));
            renderCommunityPage();
        }
    }, () => {}));
    renderCommunityPage();
};

window.renderHubTab = () => (S.activeId ? renderCommunityPage() : window.renderCommunitiesHub());

window.closeCommunity = function() {
    S.activeId = null; stopCommunityListeners(); window.renderCommunitiesHub();
};

window.setCommunityTab = (t) => { S.tab = t; renderCommunityPage(); };

// Games changed (someone joined, left, a new game...): redraw the community's Games tab so the
// "Going" counts are live. Only that tab, so typing in the feed or chat is never interrupted.
window.setCommunityGamesView = (v) => { S.gamesView = v === 'prev' ? 'prev' : 'up'; renderCommunityPage(); };
window.refreshCommunityGamesTab = () => {
    // Feed: redraw only when a game of this community starts or stops streaming (the LIVE banner).
    if (S.activeId && S.tab === 'feed') {
        const live = (window.eventsList || []).filter(e => e.communityId === S.activeId && e.livestream && e.livestream.status === 'live').map(e => e.id).join(',');
        if (live !== (window._commLiveSig ?? live)) { window._commLiveSig = live; renderCommunityPage(); }
        window._commLiveSig = live;
        return;
    }
    if (!(S.activeId && S.tab === 'games')) return;
    // Redraw only when this community's games changed (not when any game anywhere changed).
    const sig = S.activeId + '|' + JSON.stringify((window.eventsList || []).filter(e => e.communityId === S.activeId));
    if (sig === window._commGamesSig) return;
    window._commGamesSig = sig;
    renderCommunityPage();
};

function communityGames(id) {
    const all = (window.eventsList || []).filter(e => e.communityId === id);
    const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
    const up = all.filter(e => !e.isSessionEnded && (e.date || '') >= today).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    const prev = all.filter(e => !up.includes(e)).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    return { up, prev };
}

function renderCommunityPage() {
    const el = root();
    const id = S.activeId;
    if (!el || !id || document.getElementById('tab-hub')?.classList.contains('hidden')) return;
    const c = window.communitiesCache[id];
    if (!c) return;
    const role = myRole(id);
    const isAdmin = role === 'admin';
    const isMember = !!role;
    const focusId = document.activeElement?.id;
    const focusVal = document.activeElement?.value;

    const tabs = [['info', 'Info'], ['games', 'Games'], ['feed', 'Feed']];
    if (isMember && creditOn(c)) tabs.push(['credit', 'Credit']);
    if (isAdmin) tabs.push(['admin', `Admin${S.requests.length ? ` (${S.requests.length})` : ''}`]);
    if (!isMember && ['admin', 'credit'].includes(S.tab)) S.tab = 'info';
    if (S.tab === 'credit' && !creditOn(c)) S.tab = 'info';

    let body = '';
    if (S.tab === 'info') body = infoTab(c, isAdmin);
    else if (S.tab === 'games') body = gamesTab(c, isMember);
    else if (S.tab === 'feed') body = feedTab(c, isMember, isAdmin);
    else if (S.tab === 'credit' && isMember) body = isAdmin ? adminCreditHtml(c, S.members, S.credits, S.ledger) : memberCreditHtml(c, S.myCredit, S.ledger);
    else if (S.tab === 'admin' && isAdmin) body = adminTab(c);

    const html = `
        <div class="${CARD} overflow-hidden">
            <div class="relative bg-black/40">
                <img src="${esc(safeImg(c.thumbnail, DEFAULT_THUMB))}" class="block w-full h-auto max-h-[70vh] object-contain mx-auto">
                <div class="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-[#040E13] to-transparent pointer-events-none"></div>
                <button onclick="closeCommunity()" aria-label="Back" class="absolute top-3 left-3 w-9 h-9 rounded-full bg-black/60 border border-white/20 flex items-center justify-center"><i class="fa-solid fa-chevron-left text-xs"></i></button>
            </div>
            <div class="p-4 -mt-6 relative space-y-3">
                <div class="flex items-end justify-between gap-3">
                    <div class="min-w-0">
                        <h2 class="text-lg font-black text-white truncate">${esc(c.name)}</h2>
                        <p class="text-[11px] text-white/60">${c.city ? `<i class="fa-solid fa-location-dot text-[#00F296] mr-1"></i>${esc(c.city)}${c.state ? ', ' + esc(c.state) : ''} • ` : ''}${S.members.length || Number(c.membersCount) || 1} member(s)</p>
                    </div>
                    ${isMember ? '' : joinButton(c)}
                </div>
                <div class="grid grid-cols-4 gap-2">
                    ${isMember ? `
                    <button onclick="showCommunityMembers('${jsArg(id)}')" class="${HDR_BTN}"><i class="fa-solid fa-user-group text-[#00F296]"></i><span>Members</span></button>
                    <button onclick="showCommunityLeaderboard('${jsArg(id)}')" class="${HDR_BTN}"><i class="fa-solid fa-trophy text-[#00F296]"></i><span>Leaderboard</span></button>
                    <button onclick="openCommunityChat('${jsArg(id)}')" class="${HDR_BTN}"><i class="fa-solid fa-comments text-[#00F296]"></i><span>Chat</span></button>` : ''}
                    ${isMember ? '' : `<button onclick="messageCommunityAdmin('${jsArg(id)}')" class="${HDR_BTN} col-span-2"><i class="fa-solid fa-paper-plane text-[#00F296]"></i><span>Message admin</span></button>`}
                    <button onclick="shareCommunity('${jsArg(id)}')" class="${HDR_BTN} ${isMember ? '' : 'col-span-2'}"><i class="fa-solid fa-share-nodes text-[#00F296]"></i><span>Share</span></button>
                </div>
            </div>
        </div>
        ${`
        <div class="bg-black/40 border-2 border-emerald-500/30 p-1.5 rounded-2xl flex items-center gap-1 overflow-x-auto">
            ${tabs.map(([k, l]) => `<button onclick="setCommunityTab('${k}')" class="flex-1 py-2 px-3 rounded-xl text-xs font-bold whitespace-nowrap transition ${S.tab === k ? 'bg-[#00F296] text-slate-950 shadow' : 'text-white/70 hover:text-white'}">${l}</button>`).join('')}
        </div>`}
        ${S.mySusp ? `<div class="bg-red-500/10 border border-red-500/40 rounded-2xl p-3 text-xs text-white/90 leading-relaxed">
            <b class="text-red-300"><i class="fa-solid fa-ban mr-1"></i> You are suspended until ${esc(fmtDate(S.mySusp.until))}</b><br>
            Blocked from: <b>${esc(scopeLabels(S.mySusp))}</b>${S.mySusp.reason ? `<br>Reason: ${esc(S.mySusp.reason)}` : ''}
        </div>` : ''}
        <div class="${CARD} p-4 sm:p-5">${body}</div>`;
    // Nothing on screen changed (and nobody else redrew this area): leave it alone, so the page
    // doesn't flicker and a tap or typing isn't interrupted by a redraw.
    if (el._fnHtml === html && el._fnSet === el.innerHTML) return;
    el.innerHTML = html;
    el._fnHtml = html; el._fnSet = el.innerHTML;
    if (S.tab === 'feed') window.attachFeedMentions();

    if (focusId) {
        const n = document.getElementById(focusId);
        if (n && n.tagName !== 'BUTTON') { n.focus(); if (focusVal != null && n.value !== undefined) { n.value = focusVal; try { n.setSelectionRange(n.value.length, n.value.length); } catch (e) {} } }
    }
}

function joinButton(c) {
    if (S.pending) return `<div class="flex items-center gap-2 shrink-0">
        <span class="text-[11px] font-bold text-white/70"><i class="fa-solid fa-clock mr-1 text-amber-300"></i>Requested</span>
        <button onclick="cancelJoinRequest('${jsArg(c.id)}')" class="${BTN_DARK} shrink-0">Cancel request</button></div>`;
    const needs = c.requireApproval !== false;
    return `<button onclick="joinCommunity('${jsArg(c.id)}')" class="${BTN_PRIMARY} shrink-0">${needs ? 'Ask to Join' : 'Join Community'}</button>`;
}

window.joinCommunity = async function(id) {
    if (!me()) return;
    const c = window.communitiesCache[id];
    const uid = me().uid;
    const base = { uid, name: myName(), avatar: myAvatar() };
    try {
        if (c.requireApproval !== false) {
            await setDoc(doc(db, 'artifacts', appId, 'communities', id, 'requests', uid), { ...base, requestedAt: serverTimestamp() });
            S.pending = true; toast('Request sent! An admin will review it.');
        } else {
            await setDoc(doc(db, 'artifacts', appId, 'communities', id, 'members', uid), { ...base, role: 'member', joinedAt: serverTimestamp() });
            await updateDoc(commRef(id), { membersCount: increment(1) });
            window.myCommunityRoles[id] = 'member'; rebuildChatThreads();
            toast(`Welcome to ${c.name}!`);
            return window.openCommunity(id, S.tab);
        }
        renderCommunityPage();
    } catch (e) { console.error(e); toast('Could not join community', 'error'); }
};

// Take back a join request that is still waiting for approval.
window.cancelJoinRequest = async function(id) {
    if (!me()) return;
    if (!confirm('Cancel your request to join?')) return;
    try {
        await deleteDoc(doc(db, 'artifacts', appId, 'communities', id, 'requests', me().uid));
        S.pending = false; toast('Request cancelled.');
        (window._pendingCommRequests = window._pendingCommRequests || {})[id] = { pending: false, at: Date.now() };
        document.getElementById('community-only-modal')?.remove();
        if (window.activeModalEventId && window.renderEventDetailModalContent) window.renderEventDetailModalContent();
        renderCommunityPage();
    } catch (e) { console.error(e); toast('Could not cancel the request', 'error'); }
};

// Non-members can message the community's admin (opens a private chat).
window.messageCommunityAdmin = function(id) {
    const c = window.communitiesCache[id] || {};
    const adminUid = c.creatorId || c.adminId || '';
    if (!adminUid) { toast('No admin found for this community.', 'error'); return; }
    if (me() && adminUid === me().uid) { toast('You are the admin of this community.'); return; }
    if (window.openDirectChat) window.openDirectChat(adminUid);
};

// Used by the "community game only" window: ask to join (or join right away if no approval is needed).
window.requestJoinCommunity = async function(id) {
    if (!me()) return;
    const uid = me().uid;
    try {
        let c = window.communitiesCache[id];
        if (!c) {
            const s = await getDoc(commRef(id));
            if (!s.exists()) { toast('Community not found', 'error'); return; }
            c = { ...s.data(), id }; window.communitiesCache[id] = c;
        }
        const base = { uid, name: myName(), avatar: myAvatar() };
        if ((await getDoc(doc(db, 'artifacts', appId, 'communities', id, 'members', uid))).exists()) { toast('You are already a member.'); return; }
        if (c.requireApproval !== false) {
            if ((await getDoc(doc(db, 'artifacts', appId, 'communities', id, 'requests', uid))).exists()) { toast('Your request is already waiting for approval.', 'info'); }
            else { await setDoc(doc(db, 'artifacts', appId, 'communities', id, 'requests', uid), { ...base, requestedAt: serverTimestamp() }); toast('Request sent! An admin will review it.'); }
            // Remember it, so the game page and the "community game" box say "Request pending" (not "Request to join" again).
            (window._pendingCommRequests = window._pendingCommRequests || {})[id] = { pending: true, at: Date.now() };
            if (window.activeModalEventId && window.renderEventDetailModalContent) window.renderEventDetailModalContent();
        } else {
            await setDoc(doc(db, 'artifacts', appId, 'communities', id, 'members', uid), { ...base, role: 'member', joinedAt: serverTimestamp() });
            await updateDoc(commRef(id), { membersCount: increment(1) });
            window.myCommunityRoles[id] = 'member'; rebuildChatThreads();
            toast(`Welcome to ${c.name}!`);
        }
        document.getElementById('community-only-modal')?.remove();
    } catch (e) { console.error(e); toast('Could not send your request', 'error'); }
};

window.leaveCommunity = async function(id) {
    const c = window.communitiesCache[id];
    if (c.adminId === me().uid) { toast('The owner cannot leave. Delete the community instead.', 'error'); return; }
    if (!confirm('Leave this community?')) return;
    try {
        await deleteDoc(doc(db, 'artifacts', appId, 'communities', id, 'members', me().uid));
        await updateDoc(commRef(id), { membersCount: increment(-1) });
        delete window.myCommunityRoles[id]; rebuildChatThreads();
        window.closeCommunity();
    } catch (e) { console.error(e); toast('Could not leave community', 'error'); }
};

// ------------------------------------------------------------------ INFO TAB
// ---- Info: Top players (skill stars) and Top scorers, 5 each (server: communityTop)
const TOP = {};   // communityId -> { at, data }
// One list (title + up to 5 players). `empty` = text when nobody is on it yet.
function topRowsHtml(rows, right, cid, empty, first = '#FCD34D') {
    return rows.length ? rows.map((r, i) => `
            <button onclick="openPlayerStatsSheet('${jsArg(r.uid)}', '${jsArg(r.name)}', '', '${jsArg(cid)}')" class="w-full flex items-center gap-2.5 py-1.5 text-left">
                <span class="w-5 text-center text-xs font-black" style="color:${i === 0 ? first : 'rgba(255,255,255,.5)'}">${i + 1}</span>
                <img src="${esc(window.resolvePlayerAvatar ? window.resolvePlayerAvatar(r) : (r.avatar || DEFAULT_AVATAR))}" onerror="this.src='${DEFAULT_AVATAR}'" class="w-8 h-8 rounded-full object-cover border border-white/15 shrink-0">
                <span class="flex-1 min-w-0 text-xs font-bold text-white truncate">${esc(r.name)}</span>
                ${right(r)}
            </button>`).join('') : `<p class="text-[11px] text-white/45 py-2">${empty}</p>`;
}
function topListHtml(title, icon, rows, right, cid, color = '#00F296', empty = 'Shows up after a few finished games.', shareKey = '') {
    return `<div class="bg-black/40 border border-white/10 rounded-2xl p-3 h-full">
        <div class="flex items-center justify-between mb-2"><div class="text-[10px] font-black uppercase tracking-wider" style="color:${color}">${icon} ${title}</div>${(shareKey ? `<button onclick="shareTopList('${jsArg(cid)}','${shareKey}')" class="text-white/60 hover:text-white px-1" aria-label="Share"><i class="fa-solid fa-arrow-up-from-bracket text-[11px]"></i></button>` : '')}</div>
        ${topRowsHtml(rows, right, cid, empty, color === '#93C5FD' ? color : '#FCD34D')}
    </div>`;
}
// Info tab: Top players + Top scorers (5 each), and an underlined "More stats" link under them.
function topHtml(cid) {
    const t = TOP[cid];
    if (!t || Date.now() - t.at > 180000) loadTop(cid);
    if (!t) return `<div id="comm-top-box" class="text-[11px] text-white/45"><i class="fa-solid fa-spinner fa-spin mr-1"></i> Loading top players…</div>`;
    const d = t.data || { players: [], scorers: [] };
    const stars = (v) => window.starsHtml ? window.starsHtml(v, '#FCD34D', 'text-[10px]') : `⭐ ${v}`;
    return `<div id="comm-top-box" class="space-y-2">
        <div class="grid sm:grid-cols-2 gap-3">
            ${topListHtml('Top players', '<i class="fa-solid fa-star"></i>', d.players || [], r => stars(r.stars), cid, undefined, undefined, 'rated')}
            ${topListHtml('Top scorers', '<i class="fa-solid fa-futbol"></i>', d.scorers || [], r => `<span class="text-xs font-black text-[#00F296] shrink-0">${r.goals} ⚽</span>`, cid, undefined, undefined, 'goals')}
        </div>
        <div class="text-center"><button onclick="openCommunityMoreStats('${jsArg(cid)}')" class="text-xs font-bold text-white/70 underline underline-offset-4 hover:text-white">More stats</button></div>
    </div>`;
}

// ---- "More stats" page: swipe between 2 pages. Page 1 (green) Top players: most goals, most wins
// (sessions), best rated. Page 2 (turns red as you swipe) Wall of shame: most lost games, most lost
// sessions, most own goals. Numbers come from the server (communityTop).
const MS_THEMES = [
    { title: 'Top players', icon: '🏆', accent: '#00F296', bg: [4, 19, 13] },
    { title: 'Wall of shame', icon: '🤡', accent: '#F87171', bg: [30, 6, 8] }
];
function moreStatsPages(cid) {
    if (!TOP[cid]) return [0, 1].map(() => '<div class="text-xs text-white/50 py-10 text-center"><i class="fa-solid fa-spinner fa-spin mr-1"></i> Loading…</div>');
    const d = TOP[cid].data || {};
    const stars = (v) => window.starsHtml ? window.starsHtml(v, '#FCD34D', 'text-[10px]') : `⭐ ${v}`;
    const num = (txt, color) => `<span class="text-xs font-black shrink-0" style="color:${color}">${txt}</span>`;
    const box = (title, rows, right, color, empty, shareKey) => `<div class="bg-black/40 border border-white/10 rounded-2xl p-3">
        <div class="flex items-center justify-between mb-2"><div class="text-[11px] font-black uppercase tracking-wider" style="color:${color}">${title}</div>${(shareKey ? `<button onclick="shareTopList('${jsArg(cid)}','${shareKey}')" class="text-white/60 hover:text-white px-1" aria-label="Share"><i class="fa-solid fa-arrow-up-from-bracket text-[11px]"></i></button>` : '')}</div>
        ${topRowsHtml(rows || [], right, cid, empty, color === '#F87171' ? color : '#FCD34D')}</div>`;
    const G = '#00F296', R = '#F87171';
    const later = 'Shows up after a few finished games.';
    return [
        [box('⚽ Most goals', d.scorers, r => num(`${r.goals} ⚽`, G), G, later, 'goals'),
         box('🏆 Most wins (sessions)', d.sessionsWon, r => num(`${r.sessions} 🏆`, G), G, later, 'sessionsWon'),
         box('⭐ Best rated', d.players, r => stars(r.stars), G, later, 'rated')].join(''),
        [box('Most lost games', d.losses, r => num(`${r.losses} L`, R), R, 'Nobody has lost yet.', 'losses'),
         box('Most lost sessions (finished last)', d.sessionsLost, r => num(`${r.sessions}`, R), R, 'Nobody finished last yet.', 'sessionsLost'),
         box('Most own goals', d.ownGoals, r => num(`${r.ownGoals} 🙈`, R), R, 'No own goals yet. 👏', 'ownGoals')].join('')
    ];
}
window.openCommunityMoreStats = async (cid) => {
    const c = window.communitiesCache[cid];
    let m = document.getElementById('comm-more-stats');
    if (!m) { m = document.createElement('div'); m.id = 'comm-more-stats'; document.body.appendChild(m); }
    m.className = 'fixed inset-0 z-[140] flex flex-col text-white transition-colors';
    m.style.background = 'rgb(4,19,13)';
    const draw = () => {
        const pages = moreStatsPages(cid);
        m.innerHTML = `
        <div class="flex items-center gap-3 px-4 pt-4 pb-2 shrink-0">
            <button onclick="closeCommunityModal('comm-more-stats')" class="w-9 h-9 rounded-full bg-black/50 border border-white/15 flex items-center justify-center shrink-0" aria-label="Close"><i class="fa-solid fa-xmark text-sm"></i></button>
            <div class="min-w-0">
                <div data-ms-title class="text-2xl font-black truncate" style="color:${MS_THEMES[0].accent}">${MS_THEMES[0].icon} ${MS_THEMES[0].title}</div>
                <div class="text-[11px] text-white/60 truncate">${esc((c && c.name) || 'Community')}</div>
            </div>
        </div>
        <div class="flex justify-center gap-1.5 pb-2 shrink-0" data-ms-dots>
            ${pages.map((_, i) => `<button onclick="moreStatsGo(${i})" aria-label="Page ${i + 1}" class="w-2 h-2 rounded-full" style="background:${i === 0 ? '#3B82F6' : 'rgba(255,255,255,.3)'}"></button>`).join('')}
        </div>
        <div data-ms-row class="flex-1 flex overflow-x-auto snap-x snap-mandatory" style="scrollbar-width:none" onscroll="moreStatsScroll(this)">
            ${pages.map(h => `<div class="snap-center shrink-0 w-full h-full overflow-y-auto"><div class="max-w-2xl mx-auto p-4 space-y-3">${h}</div></div>`).join('')}
        </div>`;
    };
    draw();
    if (!TOP[cid] || Date.now() - TOP[cid].at > 180000) { await loadTop(cid); if (document.getElementById('comm-more-stats') === m) draw(); }
};
// ---- Share one list (phone share menu: WhatsApp, Messages...; on a computer it's copied).
const SHARE_LISTS = {
    goals:        ['⚽ Top scorers', 'scorers', r => `${r.goals} goal${r.goals === 1 ? '' : 's'}`],
    sessionsWon:  ['🏆 Most wins (sessions)', 'sessionsWon', r => `${r.sessions} session${r.sessions === 1 ? '' : 's'} won`],
    rated:        ['⭐ Top players (best rated)', 'players', r => `${r.stars} ★`],
    losses:       ['🤡 Wall of shame: most lost games', 'losses', r => `${r.losses} lost`],
    sessionsLost: ['🤡 Wall of shame: most lost sessions', 'sessionsLost', r => `finished last ${r.sessions}x`],
    ownGoals:     ['🤡 Wall of shame: most own goals', 'ownGoals', r => `${r.ownGoals} own goal${r.ownGoals === 1 ? '' : 's'} 🙈`]
};
window.shareTopList = async (cid, key) => {
    const def = SHARE_LISTS[key]; const d = (TOP[cid] && TOP[cid].data) || {};
    const rows = (d[def && def[1]] || []);
    if (!def || !rows.length) { toast('Nothing to share yet.', 'error'); return; }
    const c = window.communitiesCache[cid] || {};
    const medal = (i) => ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;
    const text = `${def[0]} · ${c.name || 'FutNet'}\n` + rows.map((r, i) => `${medal(i)} ${r.name}: ${def[2](r)}`).join('\n') + `\n\nSee more on FutNet ⚽`;
    try {
        if (navigator.share) { await navigator.share({ title: def[0], text, url: 'https://futnet.site' }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(text + ' https://futnet.site'); toast('Copied! Paste it in WhatsApp or anywhere.'); }
    catch (e) { prompt('Copy this:', text); }
};

// As you swipe, the page fades from green to red, and the title switches halfway.
window.moreStatsScroll = (row) => {
    const m = document.getElementById('comm-more-stats'); if (!m) return;
    const f = Math.max(0, Math.min(1, row.scrollLeft / Math.max(1, row.clientWidth)));
    const [a, b] = [MS_THEMES[0].bg, MS_THEMES[1].bg];
    m.style.background = `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * f)).join(',')})`;
    const t = MS_THEMES[f > 0.5 ? 1 : 0];
    const title = m.querySelector('[data-ms-title]');
    if (title) { title.textContent = `${t.icon} ${t.title}`; title.style.color = t.accent; }
    m.querySelectorAll('[data-ms-dots] button').forEach((d, i) => { d.style.background = i === (f > 0.5 ? 1 : 0) ? '#3B82F6' : 'rgba(255,255,255,.3)'; });
};
window.moreStatsGo = (i) => {
    const row = document.querySelector('#comm-more-stats [data-ms-row]');
    if (row) row.scrollTo({ left: i * row.clientWidth, behavior: 'smooth' });
};
let topLoading = {};
function loadTop(cid) {
    if (topLoading[cid]) return topLoading[cid];      // already loading: wait for the same answer
    topLoading[cid] = (async () => {
        try {
            const r = await httpsCallable(getFunctions(auth.app, 'us-central1'), 'communityTop')({ communityId: cid });
            TOP[cid] = { at: Date.now(), data: r.data };
        } catch (e) { TOP[cid] = { at: Date.now(), data: { players: [], scorers: [] } }; }
        topLoading[cid] = null;
        const box = document.getElementById('comm-top-box');
        if (box && S.activeId === cid && S.tab === 'info') box.outerHTML = topHtml(cid);
    })();
    return topLoading[cid];
}

// ---- "Creator" card with the admins under it (community Info + every game's info).
// creator / admins: { uid, name, avatar }. Tapping a person opens their player card.
const dirName = (uid) => {
    const d = Array.isArray(window.directoryList) ? window.directoryList.find(u => String(u.uid) === String(uid)) : null;
    return d ? (d.name || `${d.firstName || ''} ${d.lastName || ''}`.trim() || d.nickname || '') : '';
};
window.creatorAdminsHtml = function ({ creator, admins = [], cid = '' }) {
    if (!creator || (!creator.uid && !creator.name)) return '';
    const cname = creator.name || dirName(creator.uid) || 'Creator';
    const list = admins.filter(a => a && a.uid && String(a.uid) !== String(creator.uid));
    const tap = (p, nm) => p.uid ? `openPlayerStatsSheet('${jsArg(p.uid)}', '${jsArg(nm)}', '', '${jsArg(cid)}')` : '';
    return `<div class="bg-[#040E13]/95 border-2 border-[#00B4AE]/40 rounded-[22px] p-4 space-y-3 shadow-xl">
        <button onclick="${tap(creator, cname)}" class="w-full flex items-center gap-3 text-left">
            ${avatarImg({ ...creator, name: cname }, 'w-11 h-11 rounded-full object-cover border-2 border-[#00F296]/60 shadow-md shrink-0')}
            <div class="min-w-0 flex-1">
                <span class="text-[9px] font-black text-[#00F296] uppercase tracking-wider block">Creator</span>
                <span class="text-sm font-black text-white truncate block">${esc(cname)}</span>
            </div>
        </button>
        ${list.length ? `<div class="border-t border-white/10 pt-3">
            <div class="text-[9px] font-black text-white/50 uppercase tracking-wider mb-2">Admin${list.length === 1 ? '' : 's'}</div>
            <div class="flex flex-wrap gap-2">${list.map(a => { const nm = a.name || dirName(a.uid) || 'Admin'; return `
                <button onclick="${tap(a, nm)}" class="flex items-center gap-2 bg-black/40 border border-white/10 rounded-full pl-1 pr-3 py-1">
                    ${avatarImg({ ...a, name: nm }, 'w-6 h-6 rounded-full object-cover')}<span class="text-[11px] font-bold text-white">${esc(nm)}</span>
                </button>`; }).join('')}</div>
        </div>` : ''}
    </div>`;
};

// Admins of a community for the game screens (the community page uses its own member list).
const ADMINS = {};   // communityId -> { at, list, loading }
window.communityAdminsList = function (cid) {
    if (!cid) return [];
    const e = ADMINS[cid];
    if (!e || (!e.loading && Date.now() - e.at > 300000)) loadAdmins(cid);
    return (e && e.list) || [];
};
async function loadAdmins(cid) {
    const old = ADMINS[cid];
    ADMINS[cid] = { at: Date.now(), list: old ? old.list : [], loading: true };
    try {
        const c = window.communitiesCache[cid] || {};
        const snap = await getDocs(query(collection(db, 'artifacts', appId, 'communities', cid, 'members'), where('role', '==', 'admin')));
        const list = snap.docs.map(d => normMember({ uid: d.id, ...d.data() })).filter(m => isAdminRole(m, c));
        const changed = JSON.stringify(list.map(m => m.uid)) !== JSON.stringify((old && old.list || []).map(m => m.uid));
        ADMINS[cid] = { at: Date.now(), list, loading: false };
        // Redraw an open game's info once the admins arrive.
        const ev = (window.eventsList || []).find(e => e.id === window.activeModalEventId);
        if (changed && ev && ev.communityId === cid && window.activeModalTab === 'info' && (document.getElementById('tab-event-details-screen') || document.getElementById('event-detail-modal'))) window.renderEventDetailModalContent?.();
    } catch (e) { ADMINS[cid] = { at: Date.now(), list: old ? old.list : [], loading: false }; }
}

function infoTab(c, isAdmin) {
    const section = (t, v) => v ? `<div><div class="text-[10px] font-black uppercase tracking-wider text-[#00F296] mb-1">${t}</div><p class="text-xs text-white/80 whitespace-pre-line leading-relaxed">${esc(v)}</p></div>` : '';
    const admins = S.members.filter(m => isAdminRole(m, c));
    const people = S.members.slice();
    const isMember = !!myRole(c.id);
    return `
        <div class="space-y-4">
            ${topHtml(c.id)}
            ${window.creatorAdminsHtml({ creator: (() => { const cu = c.creatorId || c.adminId; return S.members.find(m => m.uid === cu) || { uid: cu, name: c.creatorName || '' }; })(), admins, cid: c.id })}
            ${section('About', c.description || (isMember ? '' : 'Join this community to view matches, announcements, and chat.'))}
            ${section('Member requirements', c.requirements)}
            <div class="bg-amber-500/10 border border-amber-400/30 rounded-xl p-3">
                <div class="text-[10px] font-black uppercase tracking-wider text-amber-300 mb-1"><i class="fa-solid fa-scroll mr-1"></i> Community rules</div>
                <p class="text-xs text-white/85 whitespace-pre-line leading-relaxed">${c.rules ? esc(c.rules) : `<span class="italic text-white/50">${isAdmin ? 'No rules yet. Add them with "Edit name, info & thumbnail" in the Admin tab.' : 'The admin has not added rules yet.'}</span>`}</p>
            </div>
            ${isMember ? `${isAdmin || c.adminId === me().uid ? '' : `<button onclick="leaveCommunity('${jsArg(c.id)}')" class="${BTN_DANGER} w-full">Leave Community</button>`}` : ''}
        </div>`;
}

// ---- Members page: search + sort (newest joined first by default)
const MEMBER_SORTS = [
    ['newest', 'Newest joined'], ['oldest', 'Oldest joined'],
    ['az', 'Name A–Z'], ['za', 'Name Z–A'],
    ['games', 'Most games played'], ['admins', 'Admins first'],
    ['credit', 'Highest credit']   // admins only, when the community uses Credit
];
const MV = { id: null, q: '', sort: 'newest', highlight: '' };
const foldText = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Games each member has played in this community (past or ended games where they were confirmed).
function gamesPlayedMap(cid) {
    const today = new Date(); const t = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const map = {};
    (window.eventsList || []).filter(e => e.communityId === cid && (e.isSessionEnded === true || String(e.date || '').slice(0, 10) < t))
        .forEach(e => (e.attendees || []).forEach(a => {
            if (!a || !a.uid || (a.status && a.status !== 'confirmed')) return;
            map[a.uid] = (map[a.uid] || 0) + 1;
        }));
    return map;
}

function membersListHtml() {
    const c = window.communitiesCache[MV.id]; if (!c) return '';
    const amAdmin = myRole(c.id) === 'admin' || c.adminId === me().uid;
    const showCredit = amAdmin && creditOn(c);
    const games = gamesPlayedMap(c.id);
    const nick = (m) => (Array.isArray(window.directoryList) ? window.directoryList.find(d => String(d.uid) === String(m.uid))?.nickname : '') || m.nickname || '';
    const bal = (m) => Number(S.credits[m.uid]?.balanceCents || 0);
    const joined = (m) => tsMs(m.joinedAt);
    const name = (m) => String(m.name || 'Player');

    const q = foldText(MV.q.trim());
    let list = S.members.filter(m => !q || foldText(name(m)).includes(q) || foldText(nick(m)).includes(q));
    const byName = (a, b) => name(a).localeCompare(name(b), undefined, { sensitivity: 'base' });
    const sorters = {
        newest: (a, b) => (joined(b) || 0) - (joined(a) || 0) || byName(a, b),
        oldest: (a, b) => (joined(a) || Infinity) - (joined(b) || Infinity) || byName(a, b),
        az: byName,
        za: (a, b) => byName(b, a),
        games: (a, b) => (games[b.uid] || 0) - (games[a.uid] || 0) || byName(a, b),
        admins: (a, b) => (isAdminRole(b, c) ? 1 : 0) - (isAdminRole(a, c) ? 1 : 0) || byName(a, b),
        credit: (a, b) => bal(b) - bal(a) || byName(a, b)
    };
    list.sort(sorters[MV.sort] || sorters.newest);

    const countEl = document.getElementById('cm-count');
    if (countEl) countEl.textContent = q ? `${list.length} of ${S.members.length}` : `${S.members.length} member${S.members.length === 1 ? '' : 's'}`;

    if (!list.length) return `<p class="text-xs text-white/50 italic text-center py-8">${q ? 'No members match your search.' : 'No members yet.'}</p>`;
    return list.map(m => {
        const isNew = MV.highlight && String(m.uid) === String(MV.highlight);
        const creator = String(m.uid) === String(c.adminId);
        const sc = suspendedScopes(m);
        const bits = [];
        if (joined(m)) bits.push(`Joined ${esc(fmtDate(joined(m)))}`);
        bits.push(`${games[m.uid] || 0} game${(games[m.uid] || 0) === 1 ? '' : 's'}`);
        if (showCredit) bits.push(`$${(bal(m) / 100).toFixed(2)}`);
        return `
        <button onclick="openMemberBox('${jsArg(m.uid)}')" class="w-full text-left flex items-center gap-3 bg-black/40 border ${isNew ? 'border-[#00F296] shadow-[0_0_12px_rgba(0,242,150,0.35)]' : 'border-white/10 hover:border-[#00F296]/50'} rounded-xl p-3 transition">
            ${avatarImg(m, 'w-11 h-11 rounded-full object-cover border border-emerald-500/40')}
            <div class="flex-1 min-w-0">
                <div class="flex items-center gap-1.5"><span class="text-sm font-bold text-white truncate">${esc(name(m))}${window.statusEmoji ? window.statusEmoji(m.uid) : ''}</span>
                    ${isNew ? '<span class="text-[8px] font-black uppercase text-slate-950 bg-[#00F296] rounded-full px-1.5 py-0.5">New</span>' : ''}</div>
                <div class="text-[10px] ${sc ? 'text-red-300' : 'text-white/50'} truncate">${sc ? `Suspended: ${esc(scopeLabels(sc))}` : bits.join(' • ')}</div>
            </div>
            ${isAdminRole(m, c) ? `<span class="text-[9px] font-black uppercase tracking-wider text-slate-950 bg-[#00F296] rounded-full px-2 py-0.5">${creator ? 'Creator' : 'Admin'}</span>` : ''}
            <i class="fa-solid fa-chevron-right text-white/30 text-xs"></i>
        </button>`;
    }).join('');
}

window.refreshCommunityMembersList = () => {
    const box = document.getElementById('cm-list'); if (box) box.innerHTML = membersListHtml();
};
window.searchCommunityMembers = (v) => { MV.q = String(v || ''); window.refreshCommunityMembersList(); };
window.sortCommunityMembers = (v) => { MV.sort = v; window.refreshCommunityMembersList(); };

// highlightUid (optional): a member to point out, e.g. the person who just joined.
window.showCommunityMembers = (id, highlightUid) => {
    const c = window.communitiesCache[id]; if (!c) return;
    MV.id = id; MV.q = ''; MV.sort = 'newest'; MV.highlight = highlightUid || '';
    const amAdmin = myRole(c.id) === 'admin' || c.adminId === me().uid;
    const sorts = MEMBER_SORTS.filter(([k]) => k !== 'credit' || (amAdmin && creditOn(c)));
    fullScreenShell('community-members-modal', 'Members', esc(c.name), `
        <div class="sticky top-0 z-10 bg-[#040E13] pb-2 space-y-2">
            <div class="flex gap-2">
                <div class="relative flex-1">
                    <i class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-white/40 text-xs"></i>
                    <input id="cm-search" type="search" placeholder="Search members" autocomplete="off" oninput="searchCommunityMembers(this.value)"
                        class="w-full bg-black/50 border border-white/15 focus:border-[#00F296] outline-none rounded-xl pl-8 pr-3 py-2.5 text-sm text-white placeholder-white/40">
                </div>
                <select onchange="sortCommunityMembers(this.value)" aria-label="Sort members"
                    class="bg-black/50 border border-white/15 rounded-xl px-2 py-2.5 text-xs font-bold text-white max-w-[45%]">
                    ${sorts.map(([k, l]) => `<option value="${k}" ${k === MV.sort ? 'selected' : ''}>${l}</option>`).join('')}
                </select>
            </div>
            <div id="cm-count" class="text-[10px] font-bold text-white/50 uppercase tracking-wider"></div>
        </div>
        <div id="cm-list" class="space-y-2">${membersListHtml()}</div>`);
    window.refreshCommunityMembersList();   // fills the count line too
};
// [tab, label, value, -, how many they played on this tab, its word]
const LB_TABS = [['wins', 'Most Won Matches', 'matchesWon', 'won', 'played', 'match'], ['sessions', 'Most Won Sessions', 'sessionsWon', 'won', 'sessionsPlayed', 'session'], ['goals', 'Most Goals', 'goals', 'goals', 'played', 'match']];
const lbPlayed = (r, t) => { const n = r[t[4]] || 0; return `${n} ${t[5]}${n === 1 ? '' : (t[5] === 'match' ? 'es' : 's')}`; };
function leaderboardHtml(c, tab) {
    const events = (window.eventsList || []).filter(e => e.communityId === c.id);
    const cur = LB_TABS.find(t => t[0] === tab) || LB_TABS[0];
    const rows = computePlayerStats(events).filter(p => p[cur[2]] > 0)
        .sort((a, b) => b[cur[2]] - a[cur[2]] || (b[cur[4]] || 0) - (a[cur[4]] || 0) || String(a.name).localeCompare(String(b.name))).slice(0, 25);
    return `
        <div class="grid grid-cols-3 gap-1 bg-black/50 border border-white/10 rounded-xl p-1">
            ${LB_TABS.map(t => `<button onclick="setCommunityLeaderboardTab('${jsArg(c.id)}','${t[0]}')" class="py-2 px-1 rounded-lg text-[10px] font-black leading-tight transition ${t[0] === cur[0] ? 'bg-[#00F296] text-slate-950' : 'text-white/70 hover:text-white'}">${t[1]}</button>`).join('')}
        </div>
        ${rows.length ? `<div class="divide-y divide-white/10 bg-black/30 rounded-xl border border-white/10">${rows.map((r, i) => `
            <div class="flex items-center gap-3 p-2.5 text-xs">
                <span class="w-6 text-center font-black text-white/60">${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</span>
                ${avatarImg({ uid: r.uid, name: r.name, avatar: r.avatar }, 'w-8 h-8 rounded-full object-cover')}
                <span class="flex-1 truncate font-bold text-white">${esc(r.name)}</span>
                <span class="text-white/50 text-[10px]">${lbPlayed(r, cur)}</span>
                <span class="font-black text-[#00F296] w-10 text-right">${r[cur[2]]}</span>
            </div>`).join('')}</div>`
        : '<p class="text-xs text-white/50 italic text-center py-6">Nothing here yet. Finish a community match and the rankings will show up.</p>'}`;
}
window.setCommunityLeaderboardTab = (id, tab) => {
    const c = window.communitiesCache[id]; const box = document.getElementById('lb-body'); if (!c || !box) return;
    box.innerHTML = leaderboardHtml(c, tab);
};
window.showCommunityLeaderboard = (id) => {
    const c = window.communitiesCache[id]; if (!c) return;
    modalShell('community-leaderboard-modal', 'Leaderboard', esc(c.name), `<div id="lb-body" class="space-y-3">${leaderboardHtml(c, 'wins')}</div>`);
};

// ------------------------------------------------------------------ GAMES TAB + COMMUNITY GAME CREATION
function gamesTab(c, isMember) {
    const { up, prev } = communityGames(c.id);
    const card = (ev) => (window.renderEventCardHtml ? window.renderEventCardHtml(ev) : '');
    if (!isMember && c.matchesVisibleToNonMembers === false) {
        return `<p class="text-xs text-white/60 text-center py-6">Games are visible to members only. Join this community to see them.</p>`;
    }
    return `<div class="space-y-5">
        ${isMember && !suspFrom('games') && (c.adminOnlyGames === false || myRole(c.id) === 'admin') ? `<button onclick="showCommunityGameCreation('${jsArg(c.id)}')" class="${BTN_PRIMARY} w-full py-3"><i class="fa-solid fa-plus mr-1"></i> Create Game in ${esc(c.name)}</button>` : ''}
        <div class="flex bg-black/40 border border-white/10 rounded-2xl p-1 gap-1">
            ${[['up', `Upcoming (${up.length})`], ['prev', `Previous (${prev.length})`]].map(([k, l]) => `
                <button onclick="setCommunityGamesView('${k}')" class="flex-1 py-2 rounded-xl text-xs font-black transition ${(S.gamesView || 'up') === k ? 'bg-gradient-to-r from-[#00F296] to-[#00B4AE] text-slate-950' : 'text-white/70 hover:text-white'}">${l}</button>`).join('')}
        </div>
        ${(S.gamesView || 'up') === 'up'
            ? `<div class="grid grid-cols-1 gap-4">${up.map(card).join('') || '<p class="text-xs text-white/50 italic text-center py-4">No upcoming games yet.</p>'}</div>`
            : `<div class="grid grid-cols-1 gap-4">${prev.slice(0, 40).map(card).join('') || '<p class="text-xs text-white/50 italic text-center py-4">No previous games yet.</p>'}</div>`}
    </div>`;
}

window.showCommunityGameCreation = function(communityId, opts = {}) {
    const c = window.communitiesCache[communityId];
    if (!c) return;
    // "Only admins can create games" is on unless the admin turned it off.
    if ((opts.mode || 'create') !== 'edit' && c.adminOnlyGames !== false && myRole(communityId) !== 'admin') {
        toast('Only admins can create games in this community.', 'error'); return;
    }
    const mode = opts.mode === 'edit' || opts.mode === 'copy' ? opts.mode : 'create';
    const src = mode === 'create' ? null : (window.eventsList || []).find(e => e.id === opts.eventId);
    if (mode !== 'create' && !src) return;
    // New game: start from the last game made in this community (time, park, teams, format, price, settings).
    const last = mode === 'create' ? (window.eventsList || []).filter(e => e.communityId === communityId)
        .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.createdAt?.seconds || b.createdAt || '').localeCompare(String(a.createdAt?.seconds || a.createdAt || '')))[0] || null : null;
    const tpl = src || last;
    window._cgMode = { mode, eventId: opts.eventId || null };
    const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
    const to24 = (t) => {
        t = String(t || '').trim(); if (!t) return '19:00';
        const m = t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i); if (!m) return '19:00';
        let h = parseInt(m[1], 10); const ap = (m[3] || '').toUpperCase();
        if (ap === 'PM' && h < 12) h += 12; if (ap === 'AM' && h === 12) h = 0;
        return String(h).padStart(2, '0') + ':' + m[2];
    };
    const loc = String(tpl?.location || '');
    const lm = loc.match(/^(.*?)\s*\(([^,()]*),\s*([^()]*)\)\s*$/);
    const park0 = tpl ? (lm ? lm[1] : loc) : '';
    const city0 = tpl ? (lm ? lm[2] : (c.city || '')) : (c.city || '');
    const state0 = tpl ? (lm ? lm[3] : (c.state || 'FL')) : (c.state || 'FL');
    const feeNow = tpl ? (String(tpl.fee || '').trim() && String(tpl.fee) !== '0' ? String(tpl.fee) : 'Free') : 'Free';
    const feeOpts = ['Free', ...Array.from({ length: 14 }, (_, i) => `$${i + 2}`)]; if (!feeOpts.includes(feeNow)) feeOpts.push(feeNow);
    const plusNow = tpl ? (tpl.allowPlusOnes ? 'Yes' : 'No') : 'No';
    const sel = (id, opts2, cur, extra = '') => `<select id="${id}" ${extra} class="${INPUT}">${opts2.map(o => `<option ${o === cur ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
    const heading = mode === 'edit' ? 'Edit Game' : mode === 'copy' ? 'Copy Game' : `Create Game in ${esc(c.name)}`;
    const btnText = mode === 'edit' ? 'Save Changes' : mode === 'copy' ? 'Publish Copy' : 'Create Game';
    const titleVal = tpl ? (tpl.title || '') : '';
    modalShell('community-game-modal', heading, `${esc(c.name)} · Community game`, `
        <div>${lbl('Game / event title (optional)')}<input id="cg-title" class="${INPUT}" placeholder="Soccer pick-up (default)" value="${esc(titleVal)}"></div>
        ${toggleRow('cg-open', 'Open to non-members', 'Non-members can ask to join. The organizer or an admin approves them.', tpl ? tpl.openToNonMembers === true : true)}
        <div class="flex gap-3">
            <div class="flex-1">${lbl('Date')}<input id="cg-date" type="date" min="${today}" value="${esc(mode === 'edit' && src?.date ? src.date : today)}" class="${INPUT}"></div>
            <div class="flex-1">${lbl('Time')}<input id="cg-time" type="time" value="${to24(tpl?.time)}" class="${INPUT}"></div>
        </div>
        <div class="relative">${lbl('Park & location *')}<input id="cg-park" class="${INPUT}" placeholder="Start typing a park name (required)" value="${esc(park0)}"></div>
        <div class="flex gap-3">
            <div class="flex-1">${lbl('City *')}<input id="cg-city" class="${INPUT}" value="${esc(city0)}"></div>
            <div class="w-20">${lbl('State')}<input id="cg-state" maxlength="3" class="${INPUT}" value="${esc(state0)}"></div>
        </div>
        <div class="flex gap-3">
            <div class="flex-1">${lbl('Teams')}${sel('cg-teams', ['2', '3', '4'], String(tpl?.teamsCount || 3))}</div>
            <div class="flex-1">${lbl('Format')}${sel('cg-format', Array.from({ length: 10 }, (_, i) => `${i + 3}v${i + 3}`), tpl?.format || '7v7')}</div>
            <div class="flex-1">${lbl('Fee')}${sel('cg-fee', feeOpts, feeNow, 'onchange="refreshCgOptions()"')}</div>
        </div>
        ${last ? `<p class="text-[10px] text-[#00F296]/80 -mt-1"><i class="fa-solid fa-wand-magic-sparkles mr-1"></i>Filled in from your last game. Just pick the date.</p>` : ''}
        <!-- Everything else: closed until they open it -->
        <details id="cg-adv" class="group bg-black/30 border border-white/10 rounded-2xl" ${mode === 'edit' ? '' : ''}>
            <summary class="list-none cursor-pointer px-3 py-3 flex items-center justify-between">
                <span><span class="block text-xs font-black text-white">Advanced settings</span>
                <span class="block text-[10px] text-white/50">Payment & refunds, waitlist, description, rules, plus ones${last ? ' (same as your last game)' : ''}</span></span>
                <i class="fa-solid fa-chevron-down text-white/60 transition group-open:rotate-180"></i>
            </summary>
            <div class="px-3 pb-3 space-y-3">
        <div id="cg-pay-wrap" class="hidden">${creditOn(c) ? payOptionsHtml('cg', tpl ? { ...tpl, payWithCredit: tpl.payWithCredit === true, refundPolicy: tpl.refundPolicy || 'hours:1' } : {}) : ''}</div>
        ${waitlistOptionsHtml('cg', tpl || {})}
        <div>${lbl('Description')}<textarea id="cg-desc" rows="2" class="${INPUT}">${esc(tpl?.description || '')}</textarea></div>
        <div>${lbl('Rules')}<textarea id="cg-rules" rows="2" class="${INPUT}">${esc(tpl?.rules || '')}</textarea></div>
        ${toggleRow('cg-accept', 'Users must accept rules to be confirmed', 'Players see the rules and the refund policy and tap "I accept" before they join.', tpl ? tpl.requireAcceptance === true : true)}
        <div class="flex gap-3 items-end">
            <div class="flex-1">${lbl('Allow plus ones?')}${sel('cg-plus', ['No', 'Yes'], plusNow, 'onchange="refreshCgOptions()"')}</div>
            <div class="flex-1">${lbl('Max plus ones')}${sel('cg-plus-limit', ['1', '2', '3', '4', '5', '6'], String(tpl?.plusOneLimit || 1))}</div>
        </div>
        <div id="cg-p1-wrap" class="hidden">${creditOn(c) ? plusExtraHtml('cg', { plusOneExtra: tpl && tpl.plusOneExtra !== undefined ? tpl.plusOneExtra : 1 }) : ''}</div>
            </div>
        </details>
        <button id="cg-submit" onclick="submitCommunityGame('${jsArg(communityId)}')" class="${BTN_PRIMARY} w-full py-3 text-sm">${btnText}</button>`);
    attachParkPicker({ input: 'cg-park', city: 'cg-city', state: 'cg-state' });
    // A game that was already saved as both "must pay" and "open to non-members" keeps working as it is.
    window._cgLegacyOpen = !!(mode === 'edit' && src && src.openToNonMembers === true && src.payWithCredit === true);
    window.refreshCgOptions();
    const mustBox = document.getElementById('cg-must');
    if (mustBox) mustBox.addEventListener('change', () => { window._cgLegacyOpen = false; window.refreshCgOptions(); });
    document.getElementById('cg-fee')?.addEventListener('change', () => { window._cgLegacyOpen = false; });
};

// Shows the payment options only when the game has a fee (and the +1 extra only when plus ones are allowed).
window.refreshCgOptions = () => {
    const paid = (document.getElementById('cg-fee')?.value || 'Free') !== 'Free';
    const plus = document.getElementById('cg-plus')?.value === 'Yes';
    document.getElementById('cg-pay-wrap')?.classList.toggle('hidden', !paid);
    document.getElementById('cg-p1-wrap')?.classList.toggle('hidden', !(paid && plus));

    // Must-pay games are for community members only (the fee comes out of their community credit).
    const must = paid && !!document.getElementById('cg-must')?.checked && !document.getElementById('cg-pay-wrap')?.classList.contains('hidden');
    const open = document.getElementById('cg-open');
    if (open) {
        const lock = must && !window._cgLegacyOpen;
        if (lock) open.checked = false;
        open.disabled = lock;
        const row = open.closest('label');
        if (row) {
            row.classList.toggle('opacity-50', lock);
            const sub = row.querySelector('span span:nth-child(2)');
            if (sub) sub.textContent = lock
                ? 'Not available for must-pay games: only community members can join them.'
                : 'Non-members can ask to join. The organizer or an admin approves them.';
        }
    }
};

window.submitCommunityGame = async function(communityId) {
    if (!me() || S.busy) return;
    const c = window.communitiesCache[communityId];
    const { mode, eventId } = window._cgMode || { mode: 'create' };
    const v = (id) => document.getElementById(id)?.value?.trim() || '';
    const park = v('cg-park'), city = v('cg-city'), state = v('cg-state') || 'FL';
    if (!park || !city) { toast('Please enter park name and city', 'error'); return; }
    const date = v('cg-date');
    if (!date) { toast('Please pick a date', 'error'); return; }
    let time = v('cg-time');
    if (time.includes(':')) {
        const [hh, mm] = time.split(':'); let h = parseInt(hh, 10);
        const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; time = `${h}:${mm.replace(/[^0-9]/g, '')} ${ap}`;
    }
    const allowPlusOnes = v('cg-plus') === 'Yes';
    const fee = v('cg-fee');
    const openToNonMembers = document.getElementById('cg-open').checked;
    const requireAcceptance = document.getElementById('cg-accept').checked;
    const credit = (() => {
        if (!creditOn(c) || fee === 'Free') return { payWithCredit: false, refundPolicy: 'always', plusOneExtra: 0 };
        const o = readPayOptions('cg');
        return { ...o, plusOneExtra: allowPlusOnes ? o.plusOneExtra : 0 };
    })();
    const fields = {
        title: v('cg-title') || 'Soccer pick-up (default)',
        openToNonMembers, visibility: openToNonMembers ? 'Public' : 'Private', requireAcceptance,
        date, time, location: `${park} (${city}, ${state})`,
        description: v('cg-desc'), rules: v('cg-rules'),
        teamsCount: parseInt(v('cg-teams'), 10) || 3, format: v('cg-format'),
        fee, price: parseFloat(fee.replace('$', '')) || 0,
        ...credit,
        ...readWaitlistOptions('cg'),
        allowPlusOnes, plusOneLimit: allowPlusOnes ? (parseInt(v('cg-plus-limit'), 10) || 1) : 0
    };
    const btn = document.getElementById('cg-submit');

    if (mode === 'edit') {
        S.busy = true; if (btn) btn.disabled = true;
        try {
            const res = await mutateEvent(eventId, (draft) => { Object.assign(draft, fields); });
            if (res.ok) {
                saveParkIfNew(park, city, state);
                window.closeCommunityModal('community-game-modal');
                toast('Game updated successfully!');
            } else if (btn) btn.disabled = false;
        } catch (e) { console.error(e); toast('Failed to update game', 'error'); if (btn) btn.disabled = false; }
        finally { S.busy = false; }
        return;
    }

    const id = 'evt_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const name = myName(), avatar = myAvatar() || DEFAULT_AVATAR;
    const ev = {
        id, communityId, communityName: c.name, ...fields,
        joinRequests: [],
        organizerId: me().uid, organizer: name, organizerAvatar: avatar, hostName: name, hostAvatar: avatar,
        attendees: [{ uid: me().uid, name, avatar, role: 'Organizer', status: 'confirmed', paid: 'Free', guests: [] }],
        waitingList: [], declinedList: [], comments: [], matches: [], isSessionEnded: false,
        createdAt: new Date().toISOString()
    };
    S.busy = true; if (btn) btn.disabled = true;
    try {
        await setDoc(doc(db, 'artifacts', appId, 'eventsList', id), ev);
        saveParkIfNew(park, city, state);
        window.closeCommunityModal('community-game-modal');
        toast(mode === 'copy' ? 'Game copied and published!' : '⚽ Community game published!');
        renderCommunityPage();
    } catch (e) { console.error(e); toast('Failed to save game', 'error'); if (btn) btn.disabled = false; }
    finally { S.busy = false; }
};

// ------------------------------------------------------------------ FEED TAB
function feedTab(c, isMember, isAdmin) {
    if (!isMember) {
        return `<div class="text-center py-8 space-y-3">
            <div class="w-14 h-14 mx-auto rounded-full bg-black/50 border border-emerald-500/30 flex items-center justify-center text-[#00F296] text-xl"><i class="fa-solid fa-lock"></i></div>
            <p class="text-sm font-black text-white">Join the community to see the feed</p>
            <p class="text-[11px] text-white/60">Announcements, polls and photos are shared with members only.</p>
            <div class="flex justify-center">${joinButton(c)}</div>
        </div>`;
    }
    const canPost = isMember && !suspFrom('feed') && (!c.adminOnlyFeed || isAdmin);
    return `<div class="space-y-4">
        ${window.communityLiveBannerHtml ? window.communityLiveBannerHtml(c.id) : ''}
        ${canPost ? `
        <button onclick="openPostComposer()" class="w-full flex items-center gap-3 bg-black/30 border border-white/10 rounded-xl p-3 text-left hover:bg-black/50 transition">
            ${avatarImg({ uid: me().uid, name: myName(), avatar: myAvatar() }, 'w-9 h-9 rounded-full object-cover shrink-0')}
            <span class="flex-1 text-xs text-white/50 bg-black/40 border border-white/10 rounded-full px-4 py-2.5">Share something with ${esc(c.name || 'the community')}...</span>
            <i class="fa-regular fa-image text-[#00F296] text-lg"></i>
        </button>` : (isMember ? `<p class="text-[11px] text-white/50 text-center">${suspFrom('feed') ? 'You are suspended from posting.' : 'Only admins can post in this community.'}</p>` : '')}
        ${S.feed.length === 0 ? '<p class="text-xs text-white/50 italic text-center py-4">No posts yet.</p>' : S.feed.map(p => postCard(p, c, isAdmin)).join('')}
    </div>`;
}

// "@Diego Ponce" in a post or comment, highlighted when that person is in the community.
function mentionText(text) {
    let html = esc(text || '');
    const names = S.members.map(m => memberName(m)).filter(n => n && n !== 'Player').sort((a, b) => b.length - a.length);
    names.forEach(n => {
        const e = esc(n);
        html = html.split('@' + e).join(`<span class="text-[#00F296] font-bold">@${e}</span>`);
    });
    return html;
}
/** uids of the members mentioned as "@Full Name" in a text. */
function mentionsIn(text) {
    const t = String(text || '');
    return S.members.filter(m => memberName(m) !== 'Player' && t.includes('@' + memberName(m)) && m.uid !== me().uid).map(m => String(m.uid));
}

function postCard(p, c, isAdmin) {
    const uid = me().uid;
    const liked = (p.likedBy || []).includes(uid);
    const canDelete = p.authorId === uid || isAdmin;
    const poll = p.poll;
    const votes = poll?.votes || {};
    const totalVotes = Object.keys(votes).length;
    const myVote = votes[uid];
    return `<div data-view-post="${esc(p.id)}" data-view-cid="${esc(c.id)}" data-view-title="${esc(String(p.text || (p.poll && p.poll.question) || (p.media && p.media.length ? 'Photo / video post' : 'Post')).slice(0, 60))}" class="bg-black/30 border border-white/10 rounded-xl p-3 space-y-2.5">
        <div class="flex items-center gap-2.5">
            ${avatarImg({ uid: p.authorId, name: p.authorName, avatar: p.authorAvatar }, 'w-8 h-8 rounded-full object-cover')}
            <div class="flex-1 min-w-0"><div class="text-xs font-black text-white truncate">${esc(p.authorName || 'Player')}</div><div class="text-[10px] text-white/40">${fmtAgo(tsMs(p.createdAt))}</div></div>
            ${canDelete ? `<button onclick="deleteCommunityPost('${jsArg(p.id)}')" class="text-white/40 hover:text-red-400 text-xs" aria-label="Delete post"><i class="fa-solid fa-trash"></i></button>` : ''}
        </div>
        ${p.text ? `<p class="text-xs text-white/90 whitespace-pre-line break-words">${mentionText(p.text)}</p>` : ''}
        ${poll?.question ? `<div class="space-y-1.5"><div class="text-xs font-bold text-white">${esc(poll.question)}</div>
            ${(poll.options || []).map((o, i) => {
                const n = Object.values(votes).filter(x => x === i).length;
                const pct = totalVotes ? Math.round(n * 100 / totalVotes) : 0;
                return `<button onclick="voteCommunityPoll('${jsArg(p.id)}', ${i})" class="relative w-full text-left rounded-lg overflow-hidden border ${myVote === i ? 'border-[#00F296]' : 'border-white/15'} bg-black/40 px-3 py-2 text-xs text-white">
                    <span class="absolute inset-y-0 left-0 bg-[#00F296]/20" style="width:${pct}%"></span>
                    <span class="relative flex justify-between"><span>${esc(o)}</span><span class="text-white/60">${n} • ${pct}%</span></span></button>`;
            }).join('')}
            ${totalVotes ? `<button onclick="showPollVoters('${jsArg(p.id)}')" class="text-[11px] font-bold text-white/60 hover:text-white underline underline-offset-2">${totalVotes} vote${totalVotes === 1 ? '' : 's'} · See who voted</button>` : ''}</div>` : ''}
        ${feedMediaHtml(p)}
        <div class="flex items-center gap-4 text-xs">
            <span class="flex items-center gap-1.5">
                <button onclick="likeCommunityPost('${jsArg(p.id)}')" class="${liked ? 'text-[#00F296]' : 'text-white/60'} font-bold" aria-label="Like"><i class="fa-${liked ? 'solid' : 'regular'} fa-heart"></i></button>
                ${(p.likedBy || []).length ? `<button onclick="showPostLikes('${jsArg(p.id)}')" class="${liked ? 'text-[#00F296]' : 'text-white/60'} font-bold underline-offset-2 hover:underline">${(p.likedBy || []).length} like${(p.likedBy || []).length === 1 ? '' : 's'}</button>` : `<span class="text-white/60 font-bold">0</span>`}
            </span>
            <span class="text-white/60"><i class="fa-regular fa-comment mr-1"></i>${(p.comments || []).length}</span>
        </div>
        ${(p.comments || []).map(cm => `<div class="text-[11px] bg-black/30 rounded-lg px-2.5 py-1.5"><span class="font-black text-white">${esc(cm.authorName || 'Player')}</span> <span class="text-white/80">${mentionText(cm.text)}</span></div>`).join('')}
        ${!suspFrom('feed') ? `<div class="flex gap-2"><input id="cmt-${esc(p.id)}" class="${INPUT}" placeholder="Write a comment..." onkeydown="if(event.key==='Enter')addCommunityComment('${jsArg(p.id)}')"><button onclick="addCommunityComment('${jsArg(p.id)}')" class="${BTN_PRIMARY}">Send</button></div>` : ''}
    </div>`;
}

// Feed poll: who voted for each option (tap a person for their player card).
window.showPollVoters = (postId) => {
    const p = (S.feed || []).find(x => x.id === postId); if (!p || !p.poll) return;
    const cid = S.activeId;
    const votes = p.poll.votes || {};
    const person = (u) => {
        const m = (S.members || []).find(x => String(x.uid) === u);
        return { uid: u, name: (m && m.name) || dirName(u) || 'Player', avatar: m && m.avatar };
    };
    const total = Object.keys(votes).length;
    const groups = (p.poll.options || []).map((o, i) => {
        const who = Object.keys(votes).filter(u => votes[u] === i).map(person);
        return `<div class="py-2">
            <div class="flex items-center justify-between mb-1.5"><span class="text-xs font-black text-white">${esc(o)}</span><span class="text-[11px] font-bold text-[#00F296]">${who.length} vote${who.length === 1 ? '' : 's'}</span></div>
            ${who.length ? who.map(x => `
                <button onclick="closeCommunityModal('poll-voters-modal'); openPlayerStatsSheet('${jsArg(x.uid)}', '${jsArg(x.name)}', '', '${jsArg(cid)}')" class="w-full flex items-center gap-2.5 py-1.5 text-left">
                    ${avatarImg(x, 'w-8 h-8 rounded-full object-cover shrink-0')}
                    <span class="text-xs font-bold text-white truncate">${esc(x.name)}${me() && x.uid === me().uid ? ' <span class="text-white/50 font-semibold">(you)</span>' : ''}</span>
                </button>`).join('') : '<p class="text-[11px] text-white/40">No votes</p>'}
        </div>`;
    }).join('');
    modalShell('poll-voters-modal', 'Who voted', `${esc(p.poll.question || '')} · ${total} vote${total === 1 ? '' : 's'}`, `<div class="divide-y divide-white/10">${groups}</div>`);
};

// Tap "3 likes" on a post: who liked it (photo + name; tap a person for their player card).
window.showPostLikes = (postId) => {
    const p = (S.feed || []).find(x => x.id === postId); if (!p) return;
    const cid = S.activeId;
    const uids = (p.likedBy || []).map(String);
    const person = (u) => {
        const m = (S.members || []).find(x => String(x.uid) === u);
        return { uid: u, name: (m && m.name) || dirName(u) || 'Player', avatar: m && m.avatar };
    };
    const rows = uids.map(person).map(x => `
        <button onclick="closeCommunityModal('post-likes-modal'); openPlayerStatsSheet('${jsArg(x.uid)}', '${jsArg(x.name)}', '', '${jsArg(cid)}')" class="w-full flex items-center gap-3 py-2 text-left">
            ${avatarImg(x, 'w-10 h-10 rounded-full object-cover shrink-0')}
            <span class="flex-1 min-w-0 text-sm font-bold text-white truncate">${esc(x.name)}${me() && x.uid === me().uid ? ' <span class="text-white/50 font-semibold">(you)</span>' : ''}</span>
            <i class="fa-solid fa-heart text-[#00F296] text-xs"></i>
        </button>`).join('');
    modalShell('post-likes-modal', 'Liked by', `${uids.length} ${uids.length === 1 ? 'person' : 'people'}`,
        `<div class="divide-y divide-white/10">${rows || '<p class="text-xs text-white/50 py-4 text-center">No likes yet.</p>'}</div>`);
};

// Photo or video on a post. New posts keep it in Storage (`media`); older posts saved the photo itself (`mediaUrl`).
function feedMediaHtml(p) {
    // Several photos: 1 big, 2 side by side, 3+ in a grid with "+N" on the last one.
    const list = (Array.isArray(p.mediaList) ? p.mediaList : []).filter(x => x && x.url && x.type !== 'video');
    if (list.length > 1) {
        const shown = list.slice(0, 4);
        const extra = list.length - shown.length;
        const urls = JSON.stringify(list.map(x => x.url)).replace(/"/g, '&quot;');
        return `<div class="grid ${shown.length === 2 ? 'grid-cols-2' : 'grid-cols-2'} gap-1 rounded-xl overflow-hidden">
            ${shown.map((x, i) => `<div class="relative ${shown.length === 3 && i === 0 ? 'col-span-2' : ''}">
                <img src="${esc(x.url)}" loading="lazy" onclick="openFeedGallery(${urls}, ${i})" class="w-full ${shown.length === 3 && i === 0 ? 'h-56' : 'h-40'} object-cover cursor-pointer">
                ${i === shown.length - 1 && extra > 0 ? `<div onclick="openFeedGallery(${urls}, ${i})" class="absolute inset-0 bg-black/60 flex items-center justify-center text-2xl font-black text-white cursor-pointer">+${extra}</div>` : ''}
            </div>`).join('')}
        </div>`;
    }
    const m = p.media && p.media.url ? p.media : null;
    if (m && m.type === 'video') {
        return `<video src="${esc(m.url)}" ${m.thumbUrl ? `poster="${esc(m.thumbUrl)}"` : ''} controls playsinline preload="metadata"
            class="w-full rounded-xl max-h-[28rem] bg-black"></video>`;
    }
    const url = m ? m.url : p.mediaUrl;
    if (!url || !/^(https?:|data:image\/)/i.test(url)) return '';
    return `<img src="${esc(url)}" loading="lazy" onclick="waOpenMedia('image', '${jsArg(url)}')" class="w-full rounded-xl max-h-[28rem] object-cover cursor-pointer">`;
}

// Swipe-through viewer for a post's photos.
window.openFeedGallery = function(urls, start) {
    let i = start || 0;
    document.getElementById('feed-gallery')?.remove();
    const el = document.createElement('div');
    el.id = 'feed-gallery';
    el.className = 'fixed inset-0 z-[10000] bg-black/95 flex items-center justify-center';
    const draw = () => {
        el.innerHTML = `
            <img src="${esc(urls[i])}" class="max-w-[96vw] max-h-[86vh] object-contain">
            <button data-x class="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/15 text-white" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
            ${urls.length > 1 ? `<div class="absolute bottom-5 text-white/80 text-xs font-bold">${i + 1} / ${urls.length}</div>
            <button data-p class="absolute left-3 w-11 h-11 rounded-full bg-white/15 text-white" aria-label="Previous"><i class="fa-solid fa-chevron-left"></i></button>
            <button data-n class="absolute right-3 w-11 h-11 rounded-full bg-white/15 text-white" aria-label="Next"><i class="fa-solid fa-chevron-right"></i></button>` : ''}`;
    };
    el.addEventListener('click', (e) => {
        if (e.target.closest('[data-p]')) { i = (i - 1 + urls.length) % urls.length; draw(); return; }
        if (e.target.closest('[data-n]')) { i = (i + 1) % urls.length; draw(); return; }
        if (e.target === el || e.target.closest('[data-x]')) el.remove();
    });
    let sx = null;
    el.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; }, { passive: true });
    el.addEventListener('touchend', (e) => {
        if (sx == null || urls.length < 2) return;
        const dx = e.changedTouches[0].clientX - sx; sx = null;
        if (Math.abs(dx) > 40) { i = (i + (dx < 0 ? 1 : -1) + urls.length) % urls.length; draw(); }
    });
    draw();
    document.body.appendChild(el);
};

// @ suggestions under a text box: type "@" and pick a member; "@Full Name " goes into the text.
function attachMentions(input) {
    if (!input || input.dataset.mentions) return;
    input.dataset.mentions = '1';
    let box = null;
    const close = () => { box?.remove(); box = null; };
    input.addEventListener('input', () => {
        const pos = input.selectionStart || 0;
        const before = input.value.slice(0, pos);
        const m = before.match(/(^|\s)@([^@\n]{0,30})$/);
        if (!m) { close(); return; }
        const q = foldText(m[2]);
        const list = S.members.filter(x => x.uid !== me().uid && memberName(x) !== 'Player' && foldText(memberName(x)).includes(q)).slice(0, 6);
        if (!list.length) { close(); return; }
        if (!box) {
            box = document.createElement('div');
            box.className = 'absolute z-[400] left-0 right-0 bg-[#0B1A20] border border-[#00F296]/40 rounded-xl shadow-2xl overflow-hidden';
            input.parentElement.style.position = 'relative';
            input.insertAdjacentElement('afterend', box);
        }
        box.innerHTML = list.map(x => `<button type="button" data-uid="${esc(x.uid)}" class="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/10">
            ${avatarImg(x, 'w-7 h-7 rounded-full object-cover')}<span class="text-xs font-bold text-white">${esc(memberName(x))}</span></button>`).join('');
        box.querySelectorAll('[data-uid]').forEach(b => b.addEventListener('mousedown', (e) => {
            e.preventDefault();
            const who = memberByUid(b.dataset.uid); if (!who) return;
            const start = before.length - m[2].length - 1;
            input.value = input.value.slice(0, start) + '@' + memberName(who) + ' ' + input.value.slice(pos);
            const caret = start + memberName(who).length + 2;
            input.focus(); input.setSelectionRange(caret, caret);
            close();
        }));
    });
    input.addEventListener('blur', () => setTimeout(close, 150));
}
window.attachFeedMentions = () => document.querySelectorAll('#post-text, [id^="cmt-"]').forEach(attachMentions);

window._postPhoto = null;
window._postFile = null;
window._postFiles = [];

// Full-screen "New post" composer (Facebook style): text, Gallery and Poll only.
window.openPostComposer = function() {
    const id = S.activeId; const c = window.communitiesCache[id]; if (!id || !c || !me()) return;
    window.closePostComposer();
    window._postPhoto = null;
    const o = document.createElement('div');
    o.id = 'post-composer';
    o.className = 'fixed inset-0 z-[300] bg-[#040E13] flex flex-col';
    o.innerHTML = `
        <div class="flex items-center justify-between px-4 py-3 border-b border-white/10 shrink-0">
            <button onclick="closePostComposer()" class="text-white text-xl w-8 h-8 flex items-center justify-center" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
            <h2 class="text-sm font-black text-white">New post</h2>
            <span class="w-8"></span>
        </div>
        <div class="flex-1 overflow-y-auto px-4 py-4 space-y-4 max-w-2xl w-full mx-auto">
            <div class="flex items-center gap-3">
                ${avatarImg({ uid: me().uid, name: myName(), avatar: myAvatar() }, 'w-12 h-12 rounded-full object-cover')}
                <div class="text-base font-black text-white">${esc(myName())}</div>
            </div>
            <textarea id="post-text" rows="6" class="w-full bg-transparent text-white text-lg placeholder-white/40 focus:outline-none resize-none" placeholder="What's on your mind?"></textarea>
            <div id="post-photo-preview" class="hidden relative">
                <img id="post-photo-img" class="w-full rounded-xl max-h-80 object-cover">
                <video id="post-video-el" class="hidden w-full rounded-xl max-h-80 bg-black" controls playsinline muted></video>
                <button onclick="removePostPhoto()" class="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/70 text-white" aria-label="Remove photo"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div id="post-photos-grid" class="hidden grid grid-cols-3 gap-2"></div>
            <div id="post-poll-box" class="hidden space-y-2 bg-black/30 border border-white/10 rounded-xl p-3">
                <div class="flex items-center justify-between"><span class="text-xs font-black text-white">Poll</span><button onclick="togglePostPoll()" class="text-white/50 text-xs">Remove</button></div>
                <input id="poll-q" class="${INPUT}" placeholder="Ask a question...">
                ${[1, 2, 3, 4].map(i => `<input id="poll-o${i}" class="${INPUT}" placeholder="Option ${i}${i > 2 ? ' (optional)' : ''}">`).join('')}
            </div>
        </div>
        <div class="shrink-0 border-t border-white/10 px-4 pt-3 pb-4 space-y-3">
            <div class="flex gap-3 max-w-2xl mx-auto w-full">
                <label class="flex-1 cursor-pointer bg-black/40 border border-white/15 rounded-2xl py-3 flex flex-col items-center gap-1 text-white text-xs font-bold hover:bg-black/60">
                    <i class="fa-regular fa-image text-xl"></i>Photos / Video
                    <input type="file" accept="image/*,video/*" multiple class="hidden" onchange="pickPostPhoto(this)">
                </label>
                <button onclick="togglePostPoll()" class="flex-1 bg-black/40 border border-white/15 rounded-2xl py-3 flex flex-col items-center gap-1 text-white text-xs font-bold hover:bg-black/60">
                    <i class="fa-solid fa-chart-simple text-xl"></i>Poll
                </button>
            </div>
            <div class="flex items-center justify-between max-w-2xl mx-auto w-full">
                <span class="inline-flex items-center gap-2 bg-black/40 border border-white/15 rounded-full px-4 py-2 text-xs font-bold text-white"><i class="fa-solid fa-user-group"></i>${esc(c.name || 'Community')}</span>
                <button id="post-submit-btn" onclick="publishCommunityPost()" class="${BTN_PRIMARY} px-8 py-3">Post</button>
            </div>
        </div>`;
    document.body.appendChild(o);
    attachMentions(document.getElementById('post-text'));
    setTimeout(() => document.getElementById('post-text')?.focus(), 50);
};

window.closePostComposer = function() {
    document.getElementById('post-composer')?.remove();
    if (window._postPreviewUrl) { URL.revokeObjectURL(window._postPreviewUrl); window._postPreviewUrl = null; }
    window._postPhoto = null; window._postFile = null;
    (window._postFiles || []).forEach(x => URL.revokeObjectURL(x.url)); window._postFiles = [];
};

window.togglePostPoll = function() { document.getElementById('post-poll-box')?.classList.toggle('hidden'); };

window.removePostPhoto = function() {
    window._postPhoto = null; window._postFile = null;
    if (window._postPreviewUrl) { URL.revokeObjectURL(window._postPreviewUrl); window._postPreviewUrl = null; }
    const v = document.getElementById('post-video-el'); if (v) { v.pause(); v.removeAttribute('src'); }
    document.getElementById('post-photo-preview')?.classList.add('hidden');
};

// Several photos (up to 10) for one post, shown as small tiles you can remove.
function drawPostPhotos() {
    const grid = document.getElementById('post-photos-grid'); if (!grid) return;
    const list = window._postFiles || [];
    grid.classList.toggle('hidden', list.length === 0);
    grid.innerHTML = list.map((x, i) => `<div class="relative"><img src="${x.url}" class="w-full h-24 object-cover rounded-lg">
        <button onclick="removePostPhotoAt(${i})" class="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/70 text-white text-[10px]" aria-label="Remove"><i class="fa-solid fa-xmark"></i></button></div>`).join('');
}
window.removePostPhotoAt = (i) => {
    const x = window._postFiles.splice(i, 1)[0]; if (x) URL.revokeObjectURL(x.url);
    drawPostPhotos();
};

// Photos or a video for a new post: kept as files and uploaded when you tap Post.
window.pickPostPhoto = async (input) => {
    const picked = Array.from(input.files || []); input.value = '';
    if (!picked.length) return;
    const photos = picked.filter(f => String(f.type).startsWith('image/'));
    if (picked.length > 1 || (window._postFiles || []).length) {
        // Several photos (videos go one per post)
        if (photos.length < picked.length) toast('Videos go one per post. Only the photos were added.', 'error');
        window.removePostPhoto();
        const room = 10 - (window._postFiles || []).length;
        if (photos.length > room) toast('Up to 10 photos per post.', 'error');
        photos.slice(0, Math.max(0, room)).forEach(f => window._postFiles.push({ file: f, url: URL.createObjectURL(f) }));
        drawPostPhotos();
        return;
    }
    const f = picked[0];
    const isVideo = String(f.type).startsWith('video/');
    if (!isVideo && !String(f.type).startsWith('image/')) { toast('Only photos and videos can be posted', 'error'); return; }
    if (isVideo && f.size > 60 * 1024 * 1024) { toast('That video is too big (max 60 MB). Try a shorter clip.', 'error'); return; }
    window.removePostPhoto();
    window._postFile = f;
    window._postPreviewUrl = URL.createObjectURL(f);
    const img = document.getElementById('post-photo-img');
    const vid = document.getElementById('post-video-el');
    if (img) { img.classList.toggle('hidden', isVideo); if (!isVideo) img.src = window._postPreviewUrl; }
    if (vid) { vid.classList.toggle('hidden', !isVideo); if (isVideo) vid.src = window._postPreviewUrl; }
    document.getElementById('post-photo-preview')?.classList.remove('hidden');
};

window.publishCommunityPost = async function() {
    const id = S.activeId; if (!id || !me() || S.busy) return;
    const text = document.getElementById('post-text').value.trim();
    const pollOpen = !document.getElementById('post-poll-box').classList.contains('hidden');
    const question = pollOpen ? document.getElementById('poll-q').value.trim() : '';
    const options = pollOpen ? [1, 2, 3, 4].map(i => document.getElementById(`poll-o${i}`).value.trim()).filter(Boolean) : [];
    if (pollOpen && (!question || options.length < 2)) { toast('A poll needs a question and at least 2 options', 'error'); return; }
    const files = (window._postFiles || []).map(x => x.file);
    if (!text && !question && !window._postPhoto && !window._postFile && !files.length) return;
    const postId = 'post_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    const post = {
        id: postId, authorId: me().uid, authorName: myName(), authorAvatar: myAvatar(),
        text, likes: 0, likedBy: [], comments: [], createdAt: serverTimestamp()
    };
    const mentions = mentionsIn(text);
    if (mentions.length) post.mentions = mentions;
    if (question) post.poll = { question, options, votes: {} };
    if (window._postPhoto) post.mediaUrl = window._postPhoto;
    S.busy = true;
    const btn = document.getElementById('post-submit-btn'); if (btn) btn.disabled = true;
    try {
        if (window._postFile) {
            const kind = String(window._postFile.type).startsWith('video/') ? 'video' : 'photo';
            const label = `Uploading ${kind}…`;
            showUploadProgress(label, 0);
            const media = await uploadMedia(window._postFile, `feed/${id}`, (pr) => showUploadProgress(label, pr));
            post.media = media;
            if (media.type === 'image') post.mediaUrl = media.url;   // older app versions show photos from here
        }
        if (files.length) {
            const list = [];
            for (let k = 0; k < files.length; k++) {
                const label = files.length > 1 ? `Uploading photo ${k + 1} of ${files.length}…` : 'Uploading photo…';
                showUploadProgress(label, 0);
                list.push(await uploadMedia(files[k], `feed/${id}`, (pr) => showUploadProgress(label, pr)));
            }
            post.mediaList = list;
            post.media = list[0];             // older app versions show the first photo
            post.mediaUrl = list[0].url;
        }
        await setDoc(doc(db, 'artifacts', appId, 'communities', id, 'feed', postId), post);
        window.closePostComposer();
    }
    catch (e) {
        console.error(e);
        const m = String((e && (e.message || e.code)) || '');
        toast(/TOO_BIG|NOT_MEDIA|unauthorized/.test(m) ? mediaErrorText(e) : 'Could not publish post', 'error');
        if (btn) btn.disabled = false;
    }
    finally { S.busy = false; hideUploadProgress(); }
};

// Celebration cards (results images) posted straight to the community feed, as one post with all the photos.
window.postToCommunityFeed = async function(communityId, text, files) {
    if (!me() || !communityId || !files || !files.length) return false;
    const postId = 'post_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    try {
        const list = [];
        for (let k = 0; k < files.length; k++) {
            const label = `Posting image ${k + 1} of ${files.length}…`;
            showUploadProgress(label, 0);
            list.push(await uploadMedia(files[k], `feed/${communityId}`, (pr) => showUploadProgress(label, pr)));
        }
        await setDoc(doc(db, 'artifacts', appId, 'communities', communityId, 'feed', postId), {
            id: postId, authorId: me().uid, authorName: myName(), authorAvatar: myAvatar(),
            text: text || '', likes: 0, likedBy: [], comments: [], createdAt: serverTimestamp(),
            mediaList: list, media: list[0], mediaUrl: list[0].url, kind: 'celebration'
        });
        toast('Posted to the community feed 🎉');
        return true;
    } catch (e) { console.error(e); toast('Could not post to the feed', 'error'); return false; }
    finally { hideUploadProgress(); }
};

window.likeCommunityPost = async function(postId) {
    const id = S.activeId; if (!id) return;
    const ref = doc(db, 'artifacts', appId, 'communities', id, 'feed', postId);
    const uid = me().uid;
    try {
        await runTransaction(db, async (tx) => {
            const s = await tx.get(ref); if (!s.exists()) return;
            let likedBy = s.data().likedBy || [];
            likedBy = likedBy.includes(uid) ? likedBy.filter(u => u !== uid) : [...likedBy, uid];
            tx.update(ref, { likedBy, likes: likedBy.length });
        });
    } catch (e) { console.error(e); }
};

window.addCommunityComment = async function(postId) {
    const id = S.activeId; if (!id) return;
    const inp = document.getElementById('cmt-' + postId);
    const text = inp?.value.trim(); if (!text) return;
    try {
        await updateDoc(doc(db, 'artifacts', appId, 'communities', id, 'feed', postId), {
            comments: arrayUnion({ authorId: me().uid, authorName: myName(), text, createdAt: Date.now(), ...(mentionsIn(text).length ? { mentions: mentionsIn(text) } : {}) })
        });
        inp.value = '';
    } catch (e) { console.error(e); toast('Could not add comment', 'error'); }
};

window.voteCommunityPoll = async function(postId, idx) {
    const id = S.activeId; if (!id) return;
    try {
        await updateDoc(doc(db, 'artifacts', appId, 'communities', id, 'feed', postId), { [`poll.votes.${me().uid}`]: idx });
    } catch (e) { console.error(e); toast('Could not record vote', 'error'); }
};

window.deleteCommunityPost = async function(postId) {
    const id = S.activeId; if (!id || !confirm('Delete this post?')) return;
    try { await deleteDoc(doc(db, 'artifacts', appId, 'communities', id, 'feed', postId)); }
    catch (e) { console.error(e); toast('Could not delete post', 'error'); }
};

// ------------------------------------------------------------------ ADMIN TAB
function adminTab(c) {
    const id = c.id;
    const others = S.members.filter(m => m.uid !== c.adminId);
    return `<div class="space-y-5">
        ${S.requests.length ? `<div><div class="text-[10px] font-black uppercase tracking-wider text-[#00F296] mb-2">Join requests (${S.requests.length})</div>
            <div class="space-y-2">${S.requests.map(r => `
                <div class="flex items-center gap-3 bg-black/40 border border-white/10 rounded-xl p-2.5">
                    ${avatarImg(r, 'w-8 h-8 rounded-full object-cover')}<span class="flex-1 text-xs font-bold text-white truncate">${esc(r.name || 'Player')}</span>
                    <button onclick="approveCommunityRequest('${jsArg(r.uid)}')" class="${BTN_PRIMARY}">Approve</button>
                    <button onclick="declineCommunityRequest('${jsArg(r.uid)}')" class="${BTN_DARK}">Decline</button>
                </div>`).join('')}</div></div>` : ''}
        <div><div class="text-[10px] font-black uppercase tracking-wider text-[#00F296] mb-2">Settings</div>
            <div class="space-y-2">
                ${settingToggle(id, 'requireApproval', 'Require approval to join', c.requireApproval !== false)}
                ${settingToggle(id, 'adminOnlyFeed', 'Only admins can post in the feed', c.adminOnlyFeed === true)}
                ${settingToggle(id, 'adminOnlyGames', 'Only admins can create games', c.adminOnlyGames !== false)}
                ${settingToggle(id, 'matchesVisibleToNonMembers', 'Games visible to non-members', c.matchesVisibleToNonMembers !== false)}
                ${settingToggle(id, 'creditEnabled', 'Credit system', creditOn(c))}
            </div>
            <button onclick="editCommunityInfo('${jsArg(id)}')" class="${BTN_DARK} w-full mt-3"><i class="fa-solid fa-pen mr-1"></i> Edit name, info & thumbnail</button></div>
        <button onclick="openMoneyTracker('${jsArg(id)}')" class="w-full flex items-center gap-3 bg-gradient-to-r from-emerald-950 to-teal-950 border border-[#00F296]/50 rounded-2xl p-3 text-left">
            <span class="text-2xl">💰</span><span class="flex-1"><span class="block text-sm font-black text-white">Money tracker</span>
            <span class="block text-[10px] text-white/60">Income from games, expenses (field, water…), profit</span></span><i class="fa-solid fa-chevron-right text-white/40 text-xs"></i></button>
        <button onclick="openAnalytics('${jsArg(id)}')" class="w-full flex items-center gap-3 bg-gradient-to-r from-sky-950 to-indigo-950 border border-sky-400/50 rounded-2xl p-3 text-left">
            <span class="text-2xl">📈</span><span class="flex-1"><span class="block text-sm font-black text-white">Analytics</span>
            <span class="block text-[10px] text-white/60">Who comes the most, who keeps missing, who viewed games and posts</span></span><i class="fa-solid fa-chevron-right text-white/40 text-xs"></i></button>
        ${creditOn(c) ? `<div><div class="text-[10px] font-black uppercase tracking-wider text-[#00F296] mb-1">Accepted payments</div>
            <p class="text-[10px] text-white/50 mb-2">Members see these when they need to add credit. Leave blank the ones you don't use.</p>
            ${paymentMethodsFormHtml(c)}
            <button onclick="savePaymentMethods('${jsArg(id)}')" class="${BTN_PRIMARY} w-full mt-2">Save payment details</button></div>` : ''}
        <div><div class="text-[10px] font-black uppercase tracking-wider text-[#00F296] mb-2">Members (${S.members.length})</div>
            <div class="space-y-2">${others.map(m => {
                const adm = isAdminRole(m, c); const sc = suspendedScopes(m);
                return `<button onclick="openMemberBox('${jsArg(m.uid)}')" class="w-full text-left flex items-center gap-3 bg-black/40 border border-white/10 hover:border-[#00F296]/50 rounded-xl p-2.5 transition">
                    ${avatarImg(m, 'w-10 h-10 rounded-full object-cover border border-emerald-500/40')}
                    <div class="flex-1 min-w-0"><div class="text-sm font-bold text-white truncate">${esc(m.name || 'Player')}</div>
                    <div class="text-[10px] ${sc ? 'text-red-300' : 'text-white/50'}">${sc ? `Suspended: ${esc(scopeLabels(sc))}` : (adm ? 'Admin' : 'Member')}</div></div>
                    <i class="fa-solid fa-chevron-right text-white/40 text-xs"></i>
                </button>`;
            }).join('') || '<p class="text-xs text-white/50 italic">No other members yet.</p>'}</div></div>
        ${c.adminId === me().uid ? `<button onclick="deleteCommunity('${jsArg(id)}')" class="${BTN_DANGER} w-full">Delete Community</button>` : ''}
    </div>`;
}

const settingToggle = (id, key, label, on) => `
    <label class="flex items-center justify-between gap-3 bg-black/40 border border-white/10 rounded-xl p-3 cursor-pointer">
        <span class="text-xs font-bold text-white">${label}</span>
        <input type="checkbox" ${on ? 'checked' : ''} onchange="setCommunitySetting('${jsArg(id)}', '${key}', this.checked)" class="w-5 h-5 accent-[#00F296]">
    </label>`;

window.savePaymentMethods = async (id) => {
    try {
        const pm = readPaymentMethods();
        await updateDoc(commRef(id), { paymentMethods: pm });
        if (window.communitiesCache?.[id]) window.communitiesCache[id].paymentMethods = pm;
        toast('Payment details saved');
    } catch (e) { console.error(e); toast('Could not save payment details', 'error'); }
};

window.setCommunitySetting = async (id, key, val) => {
    try { await updateDoc(commRef(id), { [key]: val }); if (key === 'creditEnabled' && val) toast('Credit system is on. Members now see a Credit tab.'); } catch (e) { console.error(e); toast('Could not update setting', 'error'); }
};

window.approveCommunityRequest = async function(uid) {
    const id = S.activeId; const req = S.requests.find(r => r.uid === uid); if (!id || !req) return;
    try {
        await setDoc(doc(db, 'artifacts', appId, 'communities', id, 'members', uid),
            { uid, name: req.name || 'Player', avatar: req.avatar || '', role: 'member', joinedAt: serverTimestamp(),
              approvedBy: me().uid, approvedAt: serverTimestamp() });   // approvedBy tells the server to send "You're in!"
        await deleteDoc(doc(db, 'artifacts', appId, 'communities', id, 'requests', uid));
        await updateDoc(commRef(id), { membersCount: increment(1) });
        toast(`${req.name || 'Player'} approved`);
    } catch (e) { console.error(e); toast('Could not approve request', 'error'); }
};
window.declineCommunityRequest = async (uid) => {
    try { await deleteDoc(doc(db, 'artifacts', appId, 'communities', S.activeId, 'requests', uid)); }
    catch (e) { console.error(e); toast('Could not decline request', 'error'); }
};
// ------------------------------------------------------------------ MEMBER BOX + MANAGE (admin tab)
// "Are you sure?" box used before every member action.
function confirmBox(title, message, confirmLabel, danger, onYes) {
    window._confirmBoxYes = async () => { document.getElementById('confirm-box-modal')?.remove(); try { await onYes(); } catch (e) { console.error(e); toast('Something went wrong', 'error'); } };
    let m = document.getElementById('confirm-box-modal');
    if (!m) { m = document.createElement('div'); m.id = 'confirm-box-modal'; document.body.appendChild(m); }
    m.className = 'fixed inset-0 z-[170] flex items-center justify-center bg-black/80 p-4 backdrop-blur-md';
    m.innerHTML = `
        <div class="bg-[#040E13] border ${danger ? 'border-red-500/50' : 'border-emerald-500/40'} rounded-3xl max-w-sm w-full p-6 space-y-4 shadow-2xl text-white text-center">
            <div class="text-base font-black">${esc(title)}</div>
            <p class="text-xs text-white/75 leading-relaxed whitespace-pre-line">${message}</p>
            <div class="flex gap-2">
                <button onclick="document.getElementById('confirm-box-modal').remove()" class="${BTN_DARK} flex-1 py-3">Cancel</button>
                <button onclick="_confirmBoxYes()" class="${danger ? BTN_DANGER : BTN_PRIMARY} flex-1 py-3">${esc(confirmLabel)}</button>
            </div>
        </div>`;
}

const memberByUid = (uid) => S.members.find(x => String(x.uid) === String(uid));
const memberName = (m) => (m && m.name && m.name !== 'Player') ? m.name : (m?.name || 'Player');
function canManageMember(c, m) {
    if (!m || !me()) return false;
    if (String(m.uid) === String(me().uid) || String(m.uid) === String(c.adminId)) return false;
    return !isAdminRole(m, c) || String(me().uid) === String(c.adminId);   // only the creator manages other admins
}
function overlay(id, inner, z = 150) {
    let m = document.getElementById(id);
    if (!m) { m = document.createElement('div'); m.id = id; document.body.appendChild(m); }
    m.className = `fixed inset-0 z-[${z}] flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-md sm:p-4`;
    m.innerHTML = `<div class="bg-[#040E13] border border-emerald-500/40 rounded-t-3xl sm:rounded-3xl w-full max-w-sm max-h-[92vh] overflow-y-auto shadow-2xl text-white p-5 space-y-4">${inner}</div>`;
}
const closeBtn = (id) => `<button onclick="closeCommunityModal('${id}')" aria-label="Close" class="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/60 border border-white/15 flex items-center justify-center"><i class="fa-solid fa-xmark text-xs"></i></button>`;

window.openMemberBox = (uid) => {
    const c = window.communitiesCache[S.activeId]; const m = memberByUid(uid); if (!c || !m) return;
    const d = (window.directoryList || []).find(u => String(u.uid) === String(uid)) || {};
    const adm = isAdminRole(m, c); const sc = suspendedScopes(m);
    const joined = fmtDate(tsMs(m.joinedAt));
    const bal = creditOn(c) && S.credits[uid] ? S.credits[uid].balanceCents : null;
    const row = (k, v) => v ? `<div class="flex justify-between gap-3 text-xs"><span class="text-white/50">${k}</span><span class="font-bold text-white text-right">${v}</span></div>` : '';
    overlay('member-box-modal', `
        <div class="relative text-center space-y-2 pt-1">
            ${avatarImg(m, 'w-24 h-24 rounded-full object-cover border-2 border-[#00F296] mx-auto')}
            <div class="text-lg font-black">${esc(memberName(m))}${window.statusEmoji ? window.statusEmoji(m.uid) : ''}</div>
            <div class="flex justify-center gap-2 flex-wrap">
                <span class="text-[9px] font-black uppercase tracking-wider rounded-full px-2 py-0.5 ${adm ? 'bg-[#00F296] text-slate-950' : 'bg-white/10 text-white/80'}">${String(uid) === String(c.adminId) ? 'Creator' : (adm ? 'Admin' : 'Member')}</span>
                ${sc ? '<span class="text-[9px] font-black uppercase tracking-wider rounded-full px-2 py-0.5 bg-red-500/30 text-red-200">Suspended</span>' : ''}
            </div>
        </div>
        <div class="space-y-2 bg-black/40 border border-white/10 rounded-xl p-3">
            ${row('Nickname', esc(d.nickname || ''))}
            ${row('Position', esc(d.position || ''))}
            ${row('Joined', esc(joined))}
            ${window.ratingStars ? row('Attendance', window.ratingStars(uid, 'attendance')) : ''}
            ${window.ratingStars ? row('Skill', window.ratingStars(uid, 'skill')) : ''}
            ${bal !== null ? row('Credit balance', esc(((bal || 0) / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' }))) : ''}
        </div>
        ${sc ? `<div class="bg-red-500/10 border border-red-500/40 rounded-xl p-3 text-xs leading-relaxed text-white/90">
            <b class="text-red-300">Suspended until ${esc(fmtDate(tsMs(m.suspendedUntil)))}</b><br>
            Blocked from: <b>${esc(scopeLabels(sc))}</b>
            ${m.suspendReason ? `<br>Reason: ${esc(m.suspendReason)}` : ''}
            ${m.suspendedByName ? `<br><span class="text-white/50">By ${esc(m.suspendedByName)}</span>` : ''}
        </div>` : ''}
        ${String(uid) !== String(me().uid) ? (() => {
            const idOf = (f) => String(typeof f === 'string' ? f : (f && f.uid) || '');
            const isFriend = (window.friendsList || []).some(f => idOf(f) === String(uid));
            const sent = (window.sentRequestsList || []).some(f => idOf(f) === String(uid));
            const theyAsked = (window.receivedRequestsList || []).some(f => idOf(f) === String(uid));
            const friendBtn = isFriend
                ? `<div class="${BTN_DARK} flex-1 py-3 text-center opacity-80"><i class="fa-solid fa-user-check mr-1 text-[#00F296]"></i> Friends</div>`
                : sent ? `<div class="${BTN_DARK} flex-1 py-3 text-center opacity-70"><i class="fa-solid fa-clock mr-1"></i> Request sent</div>`
                : `<button onclick="memberAddFriend('${jsArg(uid)}', ${theyAsked})" class="${BTN_DARK} flex-1 py-3"><i class="fa-solid fa-user-plus mr-1"></i> ${theyAsked ? 'Accept friend' : 'Add friend'}</button>`;
            return `<div class="flex gap-2">
                ${friendBtn}
                <button onclick="memberMessage('${jsArg(uid)}')" class="${BTN_PRIMARY} flex-1 py-3"><i class="fa-solid fa-comments mr-1"></i> Message</button>
            </div>`;
        })() : ''}
        <button onclick="closeCommunityModal('member-box-modal'); openPlayerStatsSheet('${jsArg(uid)}', '${jsArg(memberName(m))}', '', '${jsArg(S.activeId)}')" class="${BTN_DARK} w-full py-3"><i class="fa-solid fa-id-card mr-1 text-[#00F296]"></i> View profile</button>
        <div class="flex gap-2">
            <button onclick="closeCommunityModal('member-box-modal')" class="${BTN_DARK} flex-1 py-3">Close</button>
            ${canManageMember(c, m) ? `<button onclick="openMemberManage('${jsArg(uid)}')" class="${BTN_PRIMARY} flex-1 py-3"><i class="fa-solid fa-sliders mr-1"></i> Manage</button>` : ''}
        </div>`);
    document.getElementById('member-box-modal').firstElementChild.insertAdjacentHTML('afterbegin', closeBtn('member-box-modal'));
};

// Member box: Message (opens the private chat) and Add friend.
window.memberMessage = (uid) => {
    const m = memberByUid(uid) || {};
    window.closeCommunityModal('member-box-modal');
    if (window.openDirectChat) window.openDirectChat(uid, memberName(m), m.avatar || '');
};
window.memberAddFriend = async (uid, accept) => {
    if (accept && window.acceptFriendRequest) await window.acceptFriendRequest(uid);
    else if (window.sendFriendRequest) await window.sendFriendRequest(uid);
    setTimeout(() => { if (document.getElementById('member-box-modal')) window.openMemberBox(uid); }, 600);
};

window.openMemberManage = (uid) => {
    const c = window.communitiesCache[S.activeId]; const m = memberByUid(uid); if (!c || !m || !canManageMember(c, m)) return;
    const adm = isAdminRole(m, c); const sc = suspendedScopes(m); const name = esc(memberName(m));
    overlay('member-manage-modal', `
        <div class="text-center">
            <div class="text-sm font-black">Manage ${name}</div>
            <div class="text-[10px] text-white/50">Every action asks you to confirm.</div>
        </div>
        <div class="space-y-2">
            <button onclick="askMemberRole('${jsArg(uid)}', ${adm ? 'false' : 'true'})" class="${BTN_DARK} w-full py-3 text-left"><i class="fa-solid fa-user-shield w-5 text-[#00F296]"></i> ${adm ? 'Remove admin' : 'Make admin'}</button>
            ${sc
                ? `<button onclick="askUnsuspend('${jsArg(uid)}')" class="${BTN_DARK} w-full py-3 text-left"><i class="fa-solid fa-lock-open w-5 text-[#00F296]"></i> End suspension</button>`
                : `<button onclick="openSuspendForm('${jsArg(uid)}')" class="${BTN_DARK} w-full py-3 text-left"><i class="fa-solid fa-ban w-5 text-amber-300"></i> Suspend</button>`}
            <button onclick="askRemoveMember('${jsArg(uid)}')" class="${BTN_DANGER} w-full py-3 text-left"><i class="fa-solid fa-user-xmark w-5"></i> Remove from community</button>
        </div>
        <button onclick="closeCommunityModal('member-manage-modal')" class="${BTN_DARK} w-full py-3">Back</button>`, 155);
};

const closeMemberModals = () => ['member-manage-modal', 'member-suspend-modal', 'member-box-modal'].forEach(id => document.getElementById(id)?.remove());
const memberDoc = (uid) => doc(db, 'artifacts', appId, 'communities', S.activeId, 'members', uid);

window.askMemberRole = (uid, makeAdmin) => {
    const m = memberByUid(uid); const name = esc(memberName(m));
    confirmBox(makeAdmin ? 'Make admin?' : 'Remove admin?',
        makeAdmin ? `${name} will be able to approve members, manage games and suspend or remove members.` : `${name} will go back to being a regular member.`,
        makeAdmin ? 'Yes, make admin' : 'Yes, remove admin', false,
        async () => { await window.setCommunityRole(uid, makeAdmin); closeMemberModals(); toast(makeAdmin ? `${esc(memberName(m))} is now an admin` : `${esc(memberName(m))} is no longer an admin`); });
};

window.askRemoveMember = (uid) => {
    const m = memberByUid(uid); const name = esc(memberName(m));
    confirmBox('Remove from community?', `${name} will lose access to this community, its games, chat and feed. They can ask to join again.`, 'Yes, remove', true,
        async () => { await doRemoveMember(uid); closeMemberModals(); toast(`${esc(memberName(m))} was removed`); });
};
async function doRemoveMember(uid) {
    const id = S.activeId;
    await deleteDoc(doc(db, 'artifacts', appId, 'communities', id, 'members', uid));
    await updateDoc(commRef(id), { membersCount: increment(-1) });
}

window.askUnsuspend = (uid) => {
    const m = memberByUid(uid); const name = esc(memberName(m));
    confirmBox('End suspension?', `${name} will be able to join games, chat and post again right away.`, 'Yes, end suspension', false,
        async () => {
            await updateDoc(memberDoc(uid), { suspendedUntil: deleteField(), suspendReason: deleteField(), suspendScope: deleteField(), suspendedBy: deleteField(), suspendedByName: deleteField(), suspendedAt: deleteField() });
            closeMemberModals(); toast(`${esc(memberName(m))} is no longer suspended`);
        });
};

window._suspendWeeks = 1;
window.openSuspendForm = (uid) => {
    const m = memberByUid(uid); if (!m) return;
    window._suspendWeeks = 1;
    overlay('member-suspend-modal', `
        <div class="text-center">
            <div class="text-sm font-black">Suspend ${esc(memberName(m))}</div>
        </div>
        <div>${lbl('How long')}
            <div id="susp-weeks" class="grid grid-cols-4 gap-2">${[1, 2, 3, 4].map(w => `<button type="button" data-w="${w}" onclick="pickSuspendWeeks(${w})" class="py-2.5 rounded-xl text-xs font-black border ${w === 1 ? 'bg-[#00F296] text-slate-950 border-[#00F296]' : 'bg-black/50 text-white border-white/15'}">${w} week${w > 1 ? 's' : ''}</button>`).join('')}</div></div>
        <div>${lbl('Suspended from (pick at least one)')}
            <div class="space-y-2">${SUSPEND_SCOPES.map(([k, l]) => `
                <label class="flex items-center justify-between gap-3 bg-black/40 border border-white/10 rounded-xl p-3 cursor-pointer">
                    <span class="text-xs font-bold text-white">${l}</span>
                    <input type="checkbox" id="susp-${k}" checked class="w-5 h-5 accent-[#00F296]">
                </label>`).join('')}</div></div>
        <div>${lbl('Reason (required)')}<textarea id="susp-reason" rows="3" maxlength="300" class="${INPUT}" placeholder="Tell them why. They will see this."></textarea></div>
        <div id="susp-error" class="hidden text-xs text-red-400 font-bold bg-red-950/50 border border-red-500/50 p-2 rounded-xl text-center"></div>
        <div class="flex gap-2">
            <button onclick="closeCommunityModal('member-suspend-modal')" class="${BTN_DARK} flex-1 py-3">Back</button>
            <button onclick="askSuspend('${jsArg(uid)}')" class="${BTN_PRIMARY} flex-1 py-3">Continue</button>
        </div>`, 160);
};
window.pickSuspendWeeks = (w) => {
    window._suspendWeeks = w;
    document.querySelectorAll('#susp-weeks button').forEach(b => {
        const on = Number(b.dataset.w) === w;
        b.className = `py-2.5 rounded-xl text-xs font-black border ${on ? 'bg-[#00F296] text-slate-950 border-[#00F296]' : 'bg-black/50 text-white border-white/15'}`;
    });
};
window.askSuspend = (uid) => {
    const m = memberByUid(uid); if (!m) return;
    const err = (t) => { const b = document.getElementById('susp-error'); if (b) { b.textContent = t; b.classList.remove('hidden'); } };
    const scope = { games: !!document.getElementById('susp-games')?.checked, chat: !!document.getElementById('susp-chat')?.checked, feed: !!document.getElementById('susp-feed')?.checked };
    const reason = (document.getElementById('susp-reason')?.value || '').trim();
    const weeks = window._suspendWeeks || 1;
    if (!scope.games && !scope.chat && !scope.feed) return err('Pick at least one: joining games, chat or feed.');
    if (!reason) return err('Please write a reason.');
    const untilMs = Date.now() + weeks * 7 * 86400000;
    confirmBox('Suspend this member?',
        `${esc(memberName(m))} will be suspended for ${weeks} week${weeks > 1 ? 's' : ''} (until ${esc(fmtDate(untilMs))}).\nBlocked from: ${esc(scopeLabels(scope))}\nReason: ${esc(reason)}`,
        'Yes, suspend', true,
        async () => {
            await updateDoc(memberDoc(uid), {
                suspendedUntil: new Date(untilMs), suspendReason: reason, suspendScope: scope,
                suspendedBy: me().uid, suspendedByName: myName(), suspendedAt: serverTimestamp()
            });
            closeMemberModals(); toast(`${esc(memberName(m))} was suspended`);
        });
};

window.setCommunityRole = async (uid, makeAdmin) => {
    try {
        await updateDoc(doc(db, 'artifacts', appId, 'communities', S.activeId, 'members', uid),
            makeAdmin ? { role: 'admin' } : { role: 'member', adminUntil: deleteField() });
    } catch (e) { console.error(e); toast('Could not change role', 'error'); }
};
window.suspendCommunityMember = async (uid, days) => {
    try {
        await updateDoc(doc(db, 'artifacts', appId, 'communities', S.activeId, 'members', uid),
            days ? { suspendedUntil: new Date(Date.now() + days * 86400000) } : { suspendedUntil: deleteField() });
    } catch (e) { console.error(e); toast('Could not update member', 'error'); }
};
window.removeCommunityMember = async (uid) => {
    if (!confirm('Remove this member?')) return;
    const id = S.activeId;
    try {
        await deleteDoc(doc(db, 'artifacts', appId, 'communities', id, 'members', uid));
        await updateDoc(commRef(id), { membersCount: increment(-1) });
    } catch (e) { console.error(e); toast('Could not remove member', 'error'); }
};
window.deleteCommunity = async (id) => {
    if (!confirm('Delete this community permanently? Its games stay but lose the community link in the app.')) return;
    try {
        await deleteDoc(commRef(id));
        delete window.communitiesCache[id]; delete window.myCommunityRoles[id]; rebuildChatThreads();
        window.closeCommunity();
    } catch (e) { console.error(e); toast('Could not delete community', 'error'); }
};

// ------------------------------------------------------------------ COMMUNITY CHAT (shown inside the Chat tab)
const threadId = (id) => 'community:' + id;
function rebuildChatThreads() {
    window.communityChatThreads = Object.keys(window.myCommunityRoles).map(id => {
        const c = window.communitiesCache[id]; if (!c) return null;
        return { id: threadId(id), communityId: id, name: c.name, avatar: safeImg(c.thumbnail, DEFAULT_THUMB), isCommunity: true };
    }).filter(Boolean);
    if (window.renderChatsList) window.renderChatsList();
}

window.openCommunityChat = function(communityId) {
    window.switchTab('chat');
    if (window.setChatsTab) window.setChatsTab('community');
    window.openCommunityChatThread(threadId(communityId));
};

window.openCommunityChatThread = function(tid) {
    const communityId = tid.replace(/^community:/, '');
    const c = window.communitiesCache[communityId]; if (!c) return;
    if (S.chatUnsub) { S.chatUnsub(); S.chatUnsub = null; }
    if (S.chatTypingUnsub) { S.chatTypingUnsub(); S.chatTypingUnsub = null; }
    window.activeChatThreadId = tid;
    S.activeChatCommunity = communityId; S.chatMessages = []; S.chatTyping = [];
    window._forceChatBottom = true;
    const si = document.getElementById('chats-search-input'); if (si) si.value = '';
    document.getElementById('no-chat-selected')?.classList.add('hidden');
    const box = document.getElementById('active-chat-box');
    if (box) { box.classList.remove('hidden'); box.classList.add('flex', 'flex-col', 'h-full', 'overflow-hidden'); }
    if (window.showChatPaneMobile) window.showChatPaneMobile();   // phones: open full screen like WhatsApp
    const n = document.getElementById('active-chat-name'); if (n) n.innerText = c.name;
    const a = document.getElementById('active-chat-avatar'); if (a) a.src = safeImg(c.thumbnail, DEFAULT_THUMB);
    const sub = document.getElementById('active-chat-subtitle');
    const subDefault = `${S.members && S.activeId === communityId && S.members.length ? S.members.length + ' members' : 'Community chat'}`;
    if (sub) { sub.innerText = subDefault; sub.classList.remove('hidden'); }
    // "Diego is typing…" / "Multiple people are typing…"
    S.chatTypingUnsub = watchTyping(tid, (names) => {
        if (window.activeChatThreadId !== tid) return;
        S.chatTyping = names;
        const s2 = document.getElementById('active-chat-subtitle');
        if (s2) s2.innerText = names.length ? typingText(names) : subDefault;
        const box = document.getElementById('community-typing-bubble');
        if (box) {
            const atBottom = window.isChatNearBottom ? window.isChatNearBottom() : true;
            box.innerHTML = typingBubbleHtml(names);
            if (atBottom && window.scrollChatToBottom) window.scrollChatToBottom();
        }
    });
    // Messages live in `messages`. Older app versions saved them in `chat`, so both are shown together.
    let fromSite = [], fromOldApp = [];
    const merge = () => {
        S.chatMessages = [...fromSite, ...fromOldApp].sort((x, y) => msOf(x) - msOf(y)).slice(-150);
        if (window.activeChatThreadId === tid) renderCommunityChatMessages();
    };
    const u1 = onSnapshot(
        query(collection(db, 'artifacts', appId, 'communities', communityId, 'messages'), orderBy('createdAt', 'desc'), limit(100)),
        (snap) => { fromSite = snap.docs.map(d => ({ ...d.data(), id: d.id })); merge(); },
        (err) => { console.error('community chat', err); toast('Could not load community chat', 'error'); });
    const u2 = onSnapshot(
        query(collection(db, 'artifacts', appId, 'communities', communityId, 'chat'), orderBy('createdAt', 'desc'), limit(50)),
        (snap) => { fromOldApp = snap.docs.map(d => ({ ...d.data(), id: 'app_' + d.id })); merge(); }, () => {});
    S.chatUnsub = () => { u1(); u2(); };
    window.renderChatsList();
};

function renderCommunityChatMessages() {
    const container = document.getElementById('active-chat-messages'); if (!container) return;
    container.classList.add('flex-1', 'overflow-y-auto', 'wa-wall', 'py-2');
    container.classList.remove('space-y-3', 'p-4');
    if (!S.chatMessages.length) {
        container.innerHTML = `<div class="flex flex-col items-center justify-center h-full text-slate-400 space-y-2"><i class="fa-solid fa-people-group text-3xl opacity-40"></i><p class="text-xs font-semibold">No messages yet. Say hello to the community! 👋</p></div>
            <div id="community-typing-bubble">${typingBubbleHtml(S.chatTyping || [])}</div>`;
        return;
    }
    const uid = me().uid;
    const list = S.chatMessages.map(m => ({
        id: m.id, uid: m.senderUid || m.senderId || '', name: m.sender || m.senderName || 'Player',
        avatar: m.avatar, text: m.text, ms: msOf(m), media: m.media, poll: m.poll, replyTo: m.replyTo,
        deleted: m.deleted === true, edited: m.edited === true, reactions: m.reactions
    }));
    if (window.refreshChatPollButton) window.refreshChatPollButton();
    const atBottom = window.isChatNearBottom ? window.isChatNearBottom() : true;
    const cid = S.activeChatCommunity;
    container.innerHTML = renderWhatsApp(list, { myUid: uid, group: true, ticks: false, avatarOf: (u, n, a) => avatarOf({ uid: u, name: n, avatar: a }),
        scope: { kind: 'community', id: cid, canModerate: myRole(cid) === 'admin' } })
        + `<div id="community-typing-bubble">${typingBubbleHtml(S.chatTyping || [])}</div>`;
    if (atBottom || window._forceChatBottom) container.scrollTop = container.scrollHeight;
    window._forceChatBottom = false;
}

window.stopCommunityChat = function() {
    if (S.chatUnsub) { S.chatUnsub(); S.chatUnsub = null; }
    if (S.chatTypingUnsub) { S.chatTypingUnsub(); S.chatTypingUnsub = null; }
    S.activeChatCommunity = null;
};

window.sendCommunityChatMessage = async function(text, media, poll) {
    const cid = S.activeChatCommunity; if (!cid || !me() || !text) return;
    const msgId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const replyTo = window.waChat && window.waChat.takeReply ? window.waChat.takeReply('community', cid) : null;
    try {
        // blocked while suspended
        const ms = await getDoc(doc(db, 'artifacts', appId, 'communities', cid, 'members', me().uid));
        const _sc = ms.exists() ? suspendedScopes(ms.data()) : null;
        if (_sc && _sc.chat) { toast(`You are suspended from chat until ${fmtDate(tsMs(ms.data().suspendedUntil))}.${ms.data().suspendReason ? ' Reason: ' + esc(ms.data().suspendReason) : ''}`, 'error'); return; }
        await setDoc(doc(db, 'artifacts', appId, 'communities', cid, 'messages', msgId), {
            id: msgId, senderUid: me().uid, sender: myName(), avatar: /^https?:\/\//i.test(myAvatar()) && myAvatar().length < 400 ? myAvatar() : '',
            text, ...(media ? { media } : {}), ...(poll ? { poll } : {}), ...(replyTo ? { replyTo } : {}), createdAt: serverTimestamp()
        });
    } catch (e) { console.error(e); toast('Message failed to send', 'error'); }
};

// ------------------------------------------------------------------ startup + deep links
const initialHash = location.hash;   // captured before login/tab routing rewrites it
let initialHashUsed = false;
async function handleCommunityHash() {
    const h = (!initialHashUsed && /^#community=/.test(initialHash)) ? initialHash : location.hash;
    initialHashUsed = true;
    const m = h.match(/^#community=([^&]+)(?:&invite=(.+))?$/);
    if (m && me()) {
        const id = decodeURIComponent(m[1]);
        if (m[2]) {
            const ok = await redeemInvite(id, decodeURIComponent(m[2]));
            try { history.replaceState(null, '', location.pathname + '#community=' + encodeURIComponent(id)); } catch (e) { /* ignore */ }
            if (!ok) return true;
            // They just joined with an invite: land on Info and ask them to read it.
            await window.openCommunity(id, 'info');
            const cc = window.communitiesCache[id] || {};
            modalShell('invite-welcome-modal', `Welcome to ${esc(cc.name || 'the community')}!`, '', `
                <p class="text-sm text-white/90 leading-relaxed">Please read the rules and description before you play.</p>
                <button onclick="closeCommunityModal('invite-welcome-modal')" class="${BTN_PRIMARY} w-full py-3 text-sm">OK, I will read them</button>`);
            return true;
        }
        window.openCommunity(id);
        return true;
    }
    return false;
}
window.addEventListener('hashchange', handleCommunityHash);
const boot = setInterval(async () => {
    if (!me()) return;
    clearInterval(boot);
    await loadCommunities();
    ensureDirectory();
    handleCommunityHash();
}, 400);