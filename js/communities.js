// js/communities.js: Communities (hubs) - list, create, community page (Info / Games / Feed / Admin),
// join + approval flow, community group chat (shown in the Chat tab) and community-owned games.
// Firestore layout matches the iOS app:
//   artifacts/{appId}/communities/{id}                    -> community doc
//   artifacts/{appId}/communities/{id}/members/{uid}      -> { uid, name, avatar, role: 'admin'|'member', joinedAt, adminUntil?, suspendedUntil? }
//   artifacts/{appId}/communities/{id}/requests/{uid}     -> { uid, name, avatar, requestedAt }
//   artifacts/{appId}/communities/{id}/feed/{postId}      -> status / photo / poll posts
//   artifacts/{appId}/communities/{id}/messages/{msgId}   -> group chat messages (new)
//   artifacts/{appId}/eventsList/{gameId}                 -> community games carry communityId (+ communityName)
import { db, appId } from './firebase-config.js';
import {
    doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, query, orderBy, limit,
    onSnapshot, serverTimestamp, increment, arrayUnion, deleteField, runTransaction, where
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { escapeHtml as esc, jsArg } from './game-profile/event-store.js';
import { memberCreditHtml, adminCreditHtml, payOptionsHtml, plusExtraHtml, readPayOptions } from './credits.js';
import { attachParkPicker, saveParkIfNew } from './parks.js';
import { computePlayerStats } from './leaderboard.js';

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
async function ensureDirectory() {
    if (Array.isArray(window.directoryList) && window.directoryList.length) return;
    if (!_dirLoading) {
        _dirLoading = getDocs(collection(db, 'artifacts', appId, 'directory'))
            .then(snap => {
                if (!(Array.isArray(window.directoryList) && window.directoryList.length)) {
                    window.directoryList = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
                }
            })
            .catch(() => {})
            .finally(() => { _dirLoading = null; });
    }
    await _dirLoading;
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
async function loadCommunities() {
    try {
        const snap = await getDocs(collection(db, 'artifacts', appId, 'communities'));
        const map = {};
        snap.docs.forEach(d => { map[d.id] = { ...d.data(), id: d.id }; });
        window.communitiesCache = map;
    } catch (e) { console.error('communities load', e); }
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
    el.innerHTML = `
        <div class="${CARD} p-5 flex items-center justify-between gap-3">
            <div>
                <h2 class="text-xl font-black text-white">Hubs & Communities</h2>
                <p class="text-white/70 text-xs">Your local football hubs, group chats and leagues.</p>
            </div>
            <button onclick="showCommunityCreation()" class="${BTN_PRIMARY} shrink-0"><i class="fa-solid fa-plus mr-1"></i> New Hub</button>
        </div>
        <input id="hub-search" oninput="renderCommunitiesHub()" value="${esc(q)}" class="${INPUT}" placeholder="Search communities by name or city...">
        ${list.length === 0 ? `
            <div class="${CARD} p-10 text-center space-y-2">
                <i class="fa-solid fa-people-group text-4xl text-teal-400/60"></i>
                <div class="text-sm font-black text-white">No Communities Found</div>
                <p class="text-xs text-white/50">Create a community or join one via an invite link to get started.</p>
            </div>` : `
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            ${list.map(communityCard).join('')}
        </div>`}`;
    if (focus) { const i = document.getElementById('hub-search'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
};

function communityCard(c) {
    const role = myRole(c.id);
    return `
    <div onclick="openCommunity('${jsArg(c.id)}')" class="${CARD} overflow-hidden cursor-pointer hover:border-emerald-400 transition">
        <div class="h-32 bg-black/40 relative">
            <img src="${esc(safeImg(c.thumbnail, DEFAULT_THUMB))}" class="w-full h-full object-cover">
            ${role ? `<span class="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-black/70 border border-[#00F296]/60 text-[#00F296] text-[9px] font-black uppercase">${role === 'admin' ? 'Admin' : 'Member'}</span>` : ''}
        </div>
        <div class="p-4 space-y-1.5">
            <div class="flex items-center justify-between gap-2">
                <h3 class="text-sm font-black text-white truncate">${esc(c.name || 'Community')}</h3>
                <i class="fa-solid fa-chevron-right text-white/40 text-xs"></i>
            </div>
            <div class="flex items-center gap-2 text-[11px] text-white/60">
                ${c.city ? `<span><i class="fa-solid fa-location-dot text-[#00F296] mr-1"></i>${esc(c.city)}${c.state ? ', ' + esc(c.state) : ''}</span><span>•</span>` : ''}
                <span class="font-bold text-teal-300">${Number(c.membersCount) || 1} Member(s)</span>
            </div>
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
        <div class="bg-[#040E13] border border-emerald-500/40 rounded-t-3xl sm:rounded-3xl w-full max-w-md max-h-[92vh] overflow-y-auto shadow-2xl text-white">
            <div class="flex items-center justify-between p-5 pb-2 sticky top-0 bg-[#040E13] z-10">
                <div><div class="text-sm font-black">${title}</div><div class="text-[10px] text-white/60">${subtitle || ''}</div></div>
                <button onclick="closeCommunityModal('${id}')" class="w-8 h-8 rounded-full bg-black/60 border border-white/15 flex items-center justify-center"><i class="fa-solid fa-xmark text-xs"></i></button>
            </div>
            <div class="p-5 pt-2 space-y-4">${bodyHtml}</div>
        </div>`;
    return m;
}
window.closeCommunityModal = (id) => document.getElementById(id)?.remove();

const lbl = (t) => `<label class="block text-[10px] font-black uppercase tracking-wider text-[#00F296] mb-1">${t}</label>`;
const toggleRow = (id, title, sub, checked) => `
    <label class="flex items-center justify-between gap-3 bg-black/40 border border-white/10 rounded-xl p-3 cursor-pointer">
        <span><span class="block text-xs font-bold text-white">${title}</span><span class="block text-[10px] text-white/50">${sub}</span></span>
        <input id="${id}" type="checkbox" ${checked ? 'checked' : ''} class="w-5 h-5 accent-[#00F296] shrink-0">
    </label>`;

function communityFormBody(c, isEdit) {
    c = c || {};
    return `
        <div>${lbl('Community thumbnail (16:9, optional)')}
            <label class="block h-32 rounded-2xl overflow-hidden border border-teal-500/40 bg-black/50 cursor-pointer relative">
                <img id="cf-thumb-preview" src="${esc(safeImg(c.thumbnail, ''))}" class="w-full h-full object-cover ${c.thumbnail ? '' : 'hidden'}">
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
        ${isEdit ? '' : toggleRow('cf-approval', 'Require approval to join', 'Admins approve every join request', c.requireApproval !== false)}
        <button id="cf-submit" onclick="${isEdit ? `submitEditCommunity('${jsArg(c.id)}')` : 'submitCreateCommunity()'}" class="${BTN_PRIMARY} w-full py-3 text-sm">${isEdit ? 'Save Changes' : 'Create Community'}</button>`;
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
    const id = 'comm_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const uid = me().uid;
    const data = {
        id, name, city,
        state: document.getElementById('cf-state').value.trim() || 'FL',
        description: document.getElementById('cf-desc').value.trim(),
        requirements: document.getElementById('cf-req').value.trim(),
        rules: document.getElementById('cf-rules').value.trim(),
        requireApproval: document.getElementById('cf-approval').checked, creditEnabled: true,
        adminOnlyFeed: false, matchesVisibleToNonMembers: true,
        thumbnail: window._cfThumb || DEFAULT_THUMB,
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
        rules: document.getElementById('cf-rules').value.trim()
    };
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
const communityLink = (id) => `${location.origin}${location.pathname}#community=${encodeURIComponent(id)}`;
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
            S.credits = {}; s.docs.forEach(d => { S.credits[d.id] = d.data(); });
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
    if (!mine.name && myName()) patch.name = myName();
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
    let role = null, pending = false, suspended = false;
    if (c.adminId === uid) role = 'admin';
    try {
        const ms = await getDoc(doc(db, 'artifacts', appId, 'communities', id, 'members', uid));
        if (ms.exists()) { role = (ms.data().role === 'admin' || c.adminId === uid) ? 'admin' : 'member'; suspended = isSuspended(ms.data()); }
        else if (!role) pending = (await getDoc(doc(db, 'artifacts', appId, 'communities', id, 'requests', uid))).exists();
    } catch (e) { /* ignore */ }
    if (role) window.myCommunityRoles[id] = role; else delete window.myCommunityRoles[id];
    S.pending = pending; S.suspended = suspended;

    const base = ['artifacts', appId, 'communities', id];
    ensureDirectory();
    S.unsubs.push(onSnapshot(collection(db, ...base, 'members'), s => {
        S.members = s.docs.map(d => d.data()); renderCommunityPage();
        healMyMemberRecord(id);
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

function communityGames(id) {
    const all = (window.eventsList || []).filter(e => e.communityId === id);
    const today = new Date().toISOString().slice(0, 10);
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

    el.innerHTML = `
        <div class="${CARD} overflow-hidden">
            <div class="h-36 relative bg-black/40">
                <img src="${esc(safeImg(c.thumbnail, DEFAULT_THUMB))}" class="w-full h-full object-cover">
                <div class="absolute inset-0 bg-gradient-to-t from-[#040E13] via-transparent to-black/30"></div>
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
                    <button onclick="shareCommunity('${jsArg(id)}')" class="${HDR_BTN} ${isMember ? '' : 'col-span-4'}"><i class="fa-solid fa-share-nodes text-[#00F296]"></i><span>Share</span></button>
                </div>
            </div>
        </div>
        ${`
        <div class="bg-black/40 border-2 border-emerald-500/30 p-1.5 rounded-2xl flex items-center gap-1 overflow-x-auto">
            ${tabs.map(([k, l]) => `<button onclick="setCommunityTab('${k}')" class="flex-1 py-2 px-3 rounded-xl text-xs font-bold whitespace-nowrap transition ${S.tab === k ? 'bg-[#00F296] text-slate-950 shadow' : 'text-white/70 hover:text-white'}">${l}</button>`).join('')}
        </div>`}
        <div class="${CARD} p-4 sm:p-5">${body}</div>`;

    if (focusId) {
        const n = document.getElementById(focusId);
        if (n && n.tagName !== 'BUTTON') { n.focus(); if (focusVal != null && n.value !== undefined) { n.value = focusVal; try { n.setSelectionRange(n.value.length, n.value.length); } catch (e) {} } }
    }
}

function joinButton(c) {
    if (S.pending) return `<button disabled class="${BTN_DARK} shrink-0 opacity-70">Pending Approval...</button>`;
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
function infoTab(c, isAdmin) {
    const section = (t, v) => v ? `<div><div class="text-[10px] font-black uppercase tracking-wider text-[#00F296] mb-1">${t}</div><p class="text-xs text-white/80 whitespace-pre-line leading-relaxed">${esc(v)}</p></div>` : '';
    const admins = S.members.filter(m => isAdminRole(m, c));
    const people = S.members.filter(m => !isSuspended(m));
    const isMember = !!myRole(c.id);
    return `
        <div class="space-y-4">
            ${section('About', c.description || (isMember ? '' : 'Join this community to view matches, announcements, and chat.'))}
            ${section('Member requirements', c.requirements)}
            <div class="bg-amber-500/10 border border-amber-400/30 rounded-xl p-3">
                <div class="text-[10px] font-black uppercase tracking-wider text-amber-300 mb-1"><i class="fa-solid fa-scroll mr-1"></i> Community rules</div>
                <p class="text-xs text-white/85 whitespace-pre-line leading-relaxed">${c.rules ? esc(c.rules) : `<span class="italic text-white/50">${isAdmin ? 'No rules yet. Add them with "Edit name, info & thumbnail" in the Admin tab.' : 'The admin has not added rules yet.'}</span>`}</p>
            </div>
            <div><div class="text-[10px] font-black uppercase tracking-wider text-[#00F296] mb-2">Admins</div>
                <div class="flex flex-wrap gap-2">${(admins.length ? admins : [{ uid: c.adminId, name: 'Organizer' }]).map(a => `
                    <div class="flex items-center gap-2 bg-black/40 border border-white/10 rounded-full pl-1 pr-3 py-1">
                        ${avatarImg(a, 'w-6 h-6 rounded-full object-cover')}<span class="text-[11px] font-bold text-white">${esc(a.name || 'Admin')}</span>
                    </div>`).join('')}</div></div>
            ${isMember ? `${isAdmin || c.adminId === me().uid ? '' : `<button onclick="leaveCommunity('${jsArg(c.id)}')" class="${BTN_DANGER} w-full">Leave Community</button>`}` : ''}
        </div>`;
}

window.showCommunityMembers = (id) => {
    const c = window.communitiesCache[id]; if (!c) return;
    const people = S.members.filter(m => !isSuspended(m)).sort((a, b) => (isAdminRole(b, c) ? 1 : 0) - (isAdminRole(a, c) ? 1 : 0) || String(a.name).localeCompare(String(b.name)));
    modalShell('community-members-modal', `Members (${people.length})`, esc(c.name), `
        <div class="space-y-2">${people.map(m => `
            <div class="flex items-center gap-3 bg-black/40 border border-white/10 rounded-xl p-2.5">
                ${avatarImg(m, 'w-9 h-9 rounded-full object-cover border border-emerald-500/40')}
                <span class="flex-1 text-xs font-bold text-white truncate">${esc(m.name || 'Player')}</span>
                ${isAdminRole(m, c) ? '<span class="text-[9px] font-black uppercase tracking-wider text-slate-950 bg-[#00F296] rounded-full px-2 py-0.5">Admin</span>' : ''}
            </div>`).join('') || '<p class="text-xs text-white/50 italic">No members yet.</p>'}</div>`);
};
const LB_TABS = [['wins', 'Most Won Matches', 'matchesWon', 'won'], ['sessions', 'Most Won Sessions', 'sessionsWon', 'won'], ['goals', 'Most Goals', 'goals', 'goals']];
function leaderboardHtml(c, tab) {
    const events = (window.eventsList || []).filter(e => e.communityId === c.id);
    const cur = LB_TABS.find(t => t[0] === tab) || LB_TABS[0];
    const rows = computePlayerStats(events).filter(p => p[cur[2]] > 0)
        .sort((a, b) => b[cur[2]] - a[cur[2]] || b.played - a.played || String(a.name).localeCompare(String(b.name))).slice(0, 25);
    return `
        <div class="grid grid-cols-3 gap-1 bg-black/50 border border-white/10 rounded-xl p-1">
            ${LB_TABS.map(t => `<button onclick="setCommunityLeaderboardTab('${jsArg(c.id)}','${t[0]}')" class="py-2 px-1 rounded-lg text-[10px] font-black leading-tight transition ${t[0] === cur[0] ? 'bg-[#00F296] text-slate-950' : 'text-white/70 hover:text-white'}">${t[1]}</button>`).join('')}
        </div>
        ${rows.length ? `<div class="divide-y divide-white/10 bg-black/30 rounded-xl border border-white/10">${rows.map((r, i) => `
            <div class="flex items-center gap-3 p-2.5 text-xs">
                <span class="w-6 text-center font-black text-white/60">${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</span>
                ${avatarImg({ uid: r.uid, name: r.name, avatar: r.avatar }, 'w-8 h-8 rounded-full object-cover')}
                <span class="flex-1 truncate font-bold text-white">${esc(r.name)}</span>
                <span class="text-white/50 text-[10px]">${r.played} played</span>
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
        ${isMember && !S.suspended ? `<button onclick="showCommunityGameCreation('${jsArg(c.id)}')" class="${BTN_PRIMARY} w-full py-3"><i class="fa-solid fa-plus mr-1"></i> Create Game in ${esc(c.name)}</button>` : ''}
        <div><div class="text-[10px] font-black uppercase tracking-wider text-[#00F296] mb-2">Upcoming (${up.length})</div>
            <div class="grid grid-cols-1 gap-4">${up.map(card).join('') || '<p class="text-xs text-white/50 italic">No upcoming games yet.</p>'}</div></div>
        ${prev.length ? `<div><div class="text-[10px] font-black uppercase tracking-wider text-white/50 mb-2">Previous (${prev.length})</div>
            <div class="grid grid-cols-1 gap-4 opacity-90">${prev.slice(0, 20).map(card).join('')}</div></div>` : ''}
    </div>`;
}

window.showCommunityGameCreation = function(communityId) {
    const c = window.communitiesCache[communityId];
    if (!c) return;
    const today = new Date().toISOString().slice(0, 10);
    const sel = (id, opts, cur, extra = '') => `<select id="${id}" ${extra} class="${INPUT}">${opts.map(o => `<option ${o === cur ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
    modalShell('community-game-modal', `Create Game in ${esc(c.name)}`, 'Community game', `
        <div>${lbl('Game / event title (optional)')}<input id="cg-title" class="${INPUT}" placeholder="Soccer pick-up (default)"></div>
        ${toggleRow('cg-open', 'Open to non-members', 'Non-members can ask to join. The organizer or an admin approves them.', true)}
        <div class="flex gap-3">
            <div class="flex-1">${lbl('Date')}<input id="cg-date" type="date" min="${today}" value="${today}" class="${INPUT}"></div>
            <div class="flex-1">${lbl('Time')}<input id="cg-time" type="time" value="19:00" class="${INPUT}"></div>
        </div>
        <div class="relative">${lbl('Park & location *')}<input id="cg-park" class="${INPUT}" placeholder="Start typing a park name (required)"></div>
        <div class="flex gap-3">
            <div class="flex-1">${lbl('City *')}<input id="cg-city" class="${INPUT}" value="${esc(c.city || '')}"></div>
            <div class="w-20">${lbl('State')}<input id="cg-state" maxlength="3" class="${INPUT}" value="${esc(c.state || 'FL')}"></div>
        </div>
        <div class="flex gap-3">
            <div class="flex-1">${lbl('Teams')}${sel('cg-teams', ['2', '3', '4'], '3')}</div>
            <div class="flex-1">${lbl('Format')}${sel('cg-format', ['5v5', '6v6', '7v7', '8v8', '9v9', '11v11'], '7v7')}</div>
            <div class="flex-1">${lbl('Fee')}${sel('cg-fee', ['Free', '$5', '$6', '$7', '$8', '$10', '$12', '$15'], 'Free', 'onchange="refreshCgOptions()"')}</div>
        </div>
        <div id="cg-pay-wrap" class="hidden">${creditOn(c) ? payOptionsHtml('cg', { payWithCredit: true, refundPolicy: 'hours:1' }) : ''}</div>
        <div>${lbl('Description')}<textarea id="cg-desc" rows="2" class="${INPUT}"></textarea></div>
        <div>${lbl('Rules')}<textarea id="cg-rules" rows="2" class="${INPUT}"></textarea></div>
        <div class="flex gap-3 items-end">
            <div class="flex-1">${lbl('Allow plus ones?')}${sel('cg-plus', ['No', 'Yes'], 'No', 'onchange="refreshCgOptions()"')}</div>
            <div class="flex-1">${lbl('Max plus ones')}${sel('cg-plus-limit', ['1', '2', '3', '4', '5', '6'], '1')}</div>
        </div>
        <div id="cg-p1-wrap" class="hidden">${creditOn(c) ? plusExtraHtml('cg', { plusOneExtra: 1 }) : ''}</div>
        <button id="cg-submit" onclick="submitCommunityGame('${jsArg(communityId)}')" class="${BTN_PRIMARY} w-full py-3 text-sm">Create Game</button>`);
    attachParkPicker({ input: 'cg-park', city: 'cg-city', state: 'cg-state' });
};

// Shows the payment options only when the game has a fee (and the +1 extra only when plus ones are allowed).
window.refreshCgOptions = () => {
    const paid = (document.getElementById('cg-fee')?.value || 'Free') !== 'Free';
    const plus = document.getElementById('cg-plus')?.value === 'Yes';
    document.getElementById('cg-pay-wrap')?.classList.toggle('hidden', !paid);
    document.getElementById('cg-p1-wrap')?.classList.toggle('hidden', !(paid && plus));
};

window.submitCommunityGame = async function(communityId) {
    if (!me() || S.busy) return;
    const c = window.communitiesCache[communityId];
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
    const id = 'evt_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const name = myName(), avatar = myAvatar() || DEFAULT_AVATAR;
    const ev = {
        id, title: v('cg-title') || 'Soccer pick-up (default)',
        communityId, communityName: c.name, openToNonMembers,
        visibility: openToNonMembers ? 'Public' : 'Private',
        date, time, location: `${park} (${city}, ${state})`,
        description: v('cg-desc'), rules: v('cg-rules'),
        teamsCount: parseInt(v('cg-teams'), 10) || 3, format: v('cg-format'),
        fee, price: parseFloat(fee.replace('$', '')) || 0,
        ...(() => {
            if (!creditOn(c) || fee === 'Free') return { payWithCredit: false, refundPolicy: 'always', plusOneExtra: 0 };
            const o = readPayOptions('cg');
            return { payWithCredit: o.payWithCredit, refundPolicy: o.refundPolicy, plusOneExtra: allowPlusOnes ? o.plusOneExtra : 0 };
        })(),
        joinRequests: [],
        allowPlusOnes, plusOneLimit: allowPlusOnes ? (parseInt(v('cg-plus-limit'), 10) || 1) : 0,
        organizerId: me().uid, organizer: name, organizerAvatar: avatar, hostName: name, hostAvatar: avatar,
        attendees: [{ uid: me().uid, name, avatar, role: 'Organizer', status: 'confirmed', paid: 'Free', guests: [] }],
        waitingList: [], declinedList: [], comments: [], matches: [], isSessionEnded: false,
        createdAt: new Date().toISOString()
    };
    S.busy = true;
    const btn = document.getElementById('cg-submit'); if (btn) btn.disabled = true;
    try {
        await setDoc(doc(db, 'artifacts', appId, 'eventsList', id), ev);
        saveParkIfNew(park, city, state);
        window.closeCommunityModal('community-game-modal');
        toast('⚽ Community game published!');
        renderCommunityPage();
    } catch (e) { console.error(e); toast('Failed to save game', 'error'); }
    finally { S.busy = false; }
};

// Gate used by the join flow: members-only community games.
window.checkCommunityGameAccess = async function(ev) {
    if (!ev || !ev.communityId || ev.openToNonMembers === true) return true;
    if (ev.organizerId && me() && ev.organizerId === me().uid) return true;
    return window.isCommunityMember(ev.communityId);
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
    const canPost = isMember && !S.suspended && (!c.adminOnlyFeed || isAdmin);
    return `<div class="space-y-4">
        ${canPost ? `
        <div class="bg-black/30 border border-white/10 rounded-xl p-3 space-y-2">
            <textarea id="post-text" rows="2" class="${INPUT}" placeholder="Share an update with the community..."></textarea>
            <div id="post-poll-box" class="hidden space-y-2">
                <input id="poll-q" class="${INPUT}" placeholder="Ask a question...">
                ${[1, 2, 3, 4].map(i => `<input id="poll-o${i}" class="${INPUT}" placeholder="Option ${i}${i > 2 ? ' (optional)' : ''}">`).join('')}
            </div>
            <div class="flex items-center gap-2">
                <label class="${BTN_DARK} cursor-pointer"><i class="fa-solid fa-image mr-1"></i> Photo<input type="file" accept="image/*" class="hidden" onchange="pickPostPhoto(this)"></label>
                <button onclick="document.getElementById('post-poll-box').classList.toggle('hidden')" class="${BTN_DARK}"><i class="fa-solid fa-chart-simple mr-1"></i> Poll</button>
                <span id="post-photo-name" class="text-[10px] text-white/50 truncate flex-1"></span>
                <button onclick="publishCommunityPost()" class="${BTN_PRIMARY}">Post</button>
            </div>
        </div>` : (isMember ? `<p class="text-[11px] text-white/50 text-center">${S.suspended ? 'You are suspended from posting.' : 'Only admins can post in this community.'}</p>` : '')}
        ${S.feed.length === 0 ? '<p class="text-xs text-white/50 italic text-center py-4">No posts yet.</p>' : S.feed.map(p => postCard(p, c, isAdmin)).join('')}
    </div>`;
}

function postCard(p, c, isAdmin) {
    const uid = me().uid;
    const liked = (p.likedBy || []).includes(uid);
    const canDelete = p.authorId === uid || isAdmin;
    const poll = p.poll;
    const votes = poll?.votes || {};
    const totalVotes = Object.keys(votes).length;
    const myVote = votes[uid];
    return `<div class="bg-black/30 border border-white/10 rounded-xl p-3 space-y-2.5">
        <div class="flex items-center gap-2.5">
            ${avatarImg({ uid: p.authorId, name: p.authorName, avatar: p.authorAvatar }, 'w-8 h-8 rounded-full object-cover')}
            <div class="flex-1 min-w-0"><div class="text-xs font-black text-white truncate">${esc(p.authorName || 'Player')}</div><div class="text-[10px] text-white/40">${fmtAgo(tsMs(p.createdAt))}</div></div>
            ${canDelete ? `<button onclick="deleteCommunityPost('${jsArg(p.id)}')" class="text-white/40 hover:text-red-400 text-xs" aria-label="Delete post"><i class="fa-solid fa-trash"></i></button>` : ''}
        </div>
        ${p.text ? `<p class="text-xs text-white/90 whitespace-pre-line break-words">${esc(p.text)}</p>` : ''}
        ${poll?.question ? `<div class="space-y-1.5"><div class="text-xs font-bold text-white">${esc(poll.question)}</div>
            ${(poll.options || []).map((o, i) => {
                const n = Object.values(votes).filter(x => x === i).length;
                const pct = totalVotes ? Math.round(n * 100 / totalVotes) : 0;
                return `<button onclick="voteCommunityPoll('${jsArg(p.id)}', ${i})" class="relative w-full text-left rounded-lg overflow-hidden border ${myVote === i ? 'border-[#00F296]' : 'border-white/15'} bg-black/40 px-3 py-2 text-xs text-white">
                    <span class="absolute inset-y-0 left-0 bg-[#00F296]/20" style="width:${pct}%"></span>
                    <span class="relative flex justify-between"><span>${esc(o)}</span><span class="text-white/60">${n} • ${pct}%</span></span></button>`;
            }).join('')}</div>` : ''}
        ${p.mediaUrl && /^(https?:|data:image\/)/i.test(p.mediaUrl) ? `<img src="${esc(p.mediaUrl)}" class="w-full rounded-xl max-h-80 object-cover">` : ''}
        <div class="flex items-center gap-4 text-xs">
            <button onclick="likeCommunityPost('${jsArg(p.id)}')" class="${liked ? 'text-[#00F296]' : 'text-white/60'} font-bold"><i class="fa-${liked ? 'solid' : 'regular'} fa-heart mr-1"></i>${p.likes || 0}</button>
            <span class="text-white/60"><i class="fa-regular fa-comment mr-1"></i>${(p.comments || []).length}</span>
        </div>
        ${(p.comments || []).map(cm => `<div class="text-[11px] bg-black/30 rounded-lg px-2.5 py-1.5"><span class="font-black text-white">${esc(cm.authorName || 'Player')}</span> <span class="text-white/80">${esc(cm.text)}</span></div>`).join('')}
        ${!S.suspended ? `<div class="flex gap-2"><input id="cmt-${esc(p.id)}" class="${INPUT}" placeholder="Write a comment..." onkeydown="if(event.key==='Enter')addCommunityComment('${jsArg(p.id)}')"><button onclick="addCommunityComment('${jsArg(p.id)}')" class="${BTN_PRIMARY}">Send</button></div>` : ''}
    </div>`;
}

window._postPhoto = null;
window.pickPostPhoto = async (input) => {
    const f = input.files && input.files[0]; if (!f) return;
    try { window._postPhoto = await resizeImageToJpeg(f, 900, 0.65); document.getElementById('post-photo-name').textContent = f.name; }
    catch (e) { toast('Could not read that image', 'error'); }
};

window.publishCommunityPost = async function() {
    const id = S.activeId; if (!id || !me() || S.busy) return;
    const text = document.getElementById('post-text').value.trim();
    const pollOpen = !document.getElementById('post-poll-box').classList.contains('hidden');
    const question = pollOpen ? document.getElementById('poll-q').value.trim() : '';
    const options = pollOpen ? [1, 2, 3, 4].map(i => document.getElementById(`poll-o${i}`).value.trim()).filter(Boolean) : [];
    if (pollOpen && (!question || options.length < 2)) { toast('A poll needs a question and at least 2 options', 'error'); return; }
    if (!text && !question && !window._postPhoto) return;
    const postId = 'post_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    const post = {
        id: postId, authorId: me().uid, authorName: myName(), authorAvatar: myAvatar(),
        text, likes: 0, likedBy: [], comments: [], createdAt: serverTimestamp()
    };
    if (question) post.poll = { question, options, votes: {} };
    else if (window._postPhoto) post.mediaUrl = window._postPhoto;
    S.busy = true;
    try { await setDoc(doc(db, 'artifacts', appId, 'communities', id, 'feed', postId), post); window._postPhoto = null; }
    catch (e) { console.error(e); toast('Could not publish post', 'error'); }
    finally { S.busy = false; }
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
            comments: arrayUnion({ authorId: me().uid, authorName: myName(), text, createdAt: Date.now() })
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
                ${settingToggle(id, 'matchesVisibleToNonMembers', 'Games visible to non-members', c.matchesVisibleToNonMembers !== false)}
                ${settingToggle(id, 'creditEnabled', 'Credit system', creditOn(c))}
            </div>
            <button onclick="editCommunityInfo('${jsArg(id)}')" class="${BTN_DARK} w-full mt-3"><i class="fa-solid fa-pen mr-1"></i> Edit name, info & thumbnail</button></div>
        <div><div class="text-[10px] font-black uppercase tracking-wider text-[#00F296] mb-2">Members (${S.members.length})</div>
            <div class="space-y-2">${others.map(m => {
                const adm = isAdminRole(m, c); const sus = isSuspended(m);
                return `<div class="flex items-center gap-2 bg-black/40 border border-white/10 rounded-xl p-2.5">
                    ${avatarImg(m, 'w-8 h-8 rounded-full object-cover')}
                    <div class="flex-1 min-w-0"><div class="text-xs font-bold text-white truncate">${esc(m.name || 'Player')}</div>
                    <div class="text-[10px] ${sus ? 'text-red-300' : 'text-white/50'}">${sus ? 'Suspended' : (adm ? 'Admin' : 'Member')}</div></div>
                    ${adm ? `<button onclick="setCommunityRole('${jsArg(m.uid)}', false)" class="${BTN_DARK}">Demote</button>` : `<button onclick="setCommunityRole('${jsArg(m.uid)}', true)" class="${BTN_DARK}">Make Admin</button>`}
                    ${sus ? `<button onclick="suspendCommunityMember('${jsArg(m.uid)}', 0)" class="${BTN_DARK}">Unsuspend</button>` : `<button onclick="suspendCommunityMember('${jsArg(m.uid)}', 7)" class="${BTN_DARK}">Suspend 7d</button>`}
                    <button onclick="removeCommunityMember('${jsArg(m.uid)}')" class="${BTN_DANGER}" aria-label="Remove member"><i class="fa-solid fa-user-xmark"></i></button>
                </div>`;
            }).join('') || '<p class="text-xs text-white/50 italic">No other members yet.</p>'}</div></div>
        ${c.adminId === me().uid ? `<button onclick="deleteCommunity('${jsArg(id)}')" class="${BTN_DANGER} w-full">Delete Community</button>` : ''}
    </div>`;
}

const settingToggle = (id, key, label, on) => `
    <label class="flex items-center justify-between gap-3 bg-black/40 border border-white/10 rounded-xl p-3 cursor-pointer">
        <span class="text-xs font-bold text-white">${label}</span>
        <input type="checkbox" ${on ? 'checked' : ''} onchange="setCommunitySetting('${jsArg(id)}', '${key}', this.checked)" class="w-5 h-5 accent-[#00F296]">
    </label>`;

window.setCommunitySetting = async (id, key, val) => {
    try { await updateDoc(commRef(id), { [key]: val }); if (key === 'creditEnabled' && val) toast('Credit system is on. Members now see a Credit tab.'); } catch (e) { console.error(e); toast('Could not update setting', 'error'); }
};

window.approveCommunityRequest = async function(uid) {
    const id = S.activeId; const req = S.requests.find(r => r.uid === uid); if (!id || !req) return;
    try {
        await setDoc(doc(db, 'artifacts', appId, 'communities', id, 'members', uid),
            { uid, name: req.name || 'Player', avatar: req.avatar || '', role: 'member', joinedAt: serverTimestamp() });
        await deleteDoc(doc(db, 'artifacts', appId, 'communities', id, 'requests', uid));
        await updateDoc(commRef(id), { membersCount: increment(1) });
        toast(`${req.name || 'Player'} approved`);
    } catch (e) { console.error(e); toast('Could not approve request', 'error'); }
};
window.declineCommunityRequest = async (uid) => {
    try { await deleteDoc(doc(db, 'artifacts', appId, 'communities', S.activeId, 'requests', uid)); }
    catch (e) { console.error(e); toast('Could not decline request', 'error'); }
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
    window.openCommunityChatThread(threadId(communityId));
};

window.openCommunityChatThread = function(tid) {
    const communityId = tid.replace(/^community:/, '');
    const c = window.communitiesCache[communityId]; if (!c) return;
    if (S.chatUnsub) { S.chatUnsub(); S.chatUnsub = null; }
    window.activeChatThreadId = tid;
    S.activeChatCommunity = communityId; S.chatMessages = [];
    const si = document.getElementById('chats-search-input'); if (si) si.value = '';
    document.getElementById('no-chat-selected')?.classList.add('hidden');
    const box = document.getElementById('active-chat-box');
    if (box) { box.classList.remove('hidden'); box.classList.add('flex', 'flex-col', 'h-full', 'overflow-hidden'); }
    const n = document.getElementById('active-chat-name'); if (n) n.innerText = c.name;
    const a = document.getElementById('active-chat-avatar'); if (a) a.src = safeImg(c.thumbnail, DEFAULT_THUMB);
    const sub = document.getElementById('active-chat-subtitle');
    if (sub) { sub.innerText = 'Community chat'; sub.classList.remove('hidden'); }
    S.chatUnsub = onSnapshot(
        query(collection(db, 'artifacts', appId, 'communities', communityId, 'messages'), orderBy('createdAt', 'desc'), limit(100)),
        (snap) => {
            S.chatMessages = snap.docs.map(d => ({ ...d.data(), id: d.id })).reverse();
            if (window.activeChatThreadId === tid) renderCommunityChatMessages();
        }, (err) => { console.error('community chat', err); toast('Could not load community chat', 'error'); });
    window.renderChatsList();
};

function renderCommunityChatMessages() {
    const container = document.getElementById('active-chat-messages'); if (!container) return;
    container.classList.add('flex-1', 'overflow-y-auto', 'p-4');
    if (!S.chatMessages.length) {
        container.innerHTML = `<div class="flex flex-col items-center justify-center h-full text-slate-500 space-y-2"><i class="fa-solid fa-people-group text-3xl opacity-40"></i><p class="text-xs font-semibold">No messages yet. Say hello to the community!</p></div>`;
        return;
    }
    const uid = me().uid;
    container.innerHTML = S.chatMessages.map(m => {
        const mine = m.senderUid === uid;
        const t = tsMs(m.createdAt) ? new Date(tsMs(m.createdAt)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
        return mine ? `
            <div class="flex items-end justify-end gap-2 my-2"><div class="bg-[#14cc80] text-slate-900 px-4 py-2.5 rounded-2xl rounded-tr-sm max-w-md shadow-sm text-xs relative">
                <p class="pr-10 pb-3 break-words">${esc(m.text)}</p><span class="absolute bottom-1 right-2.5 text-[9px] text-slate-700">${esc(t)}</span></div></div>` : `
            <div class="flex items-end gap-2 my-2">${avatarImg({ uid: m.senderUid, name: m.sender, avatar: m.avatar }, 'w-7 h-7 rounded-full object-cover shrink-0 mb-1 border border-slate-200')}
                <div class="bg-white border border-slate-200 text-slate-900 px-4 py-2.5 rounded-2xl rounded-tl-sm max-w-md shadow-sm text-xs relative">
                <p class="text-[10px] font-bold text-emerald-600 mb-0.5">${esc(m.sender || 'Player')}</p>
                <p class="pr-10 pb-3 break-words">${esc(m.text)}</p><span class="absolute bottom-1 right-2.5 text-[9px] text-slate-400">${esc(t)}</span></div></div>`;
    }).join('');
    container.scrollTop = container.scrollHeight;
}

window.stopCommunityChat = function() {
    if (S.chatUnsub) { S.chatUnsub(); S.chatUnsub = null; }
    S.activeChatCommunity = null;
};

window.sendCommunityChatMessage = async function(text) {
    const cid = S.activeChatCommunity; if (!cid || !me() || !text) return;
    const msgId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    try {
        // blocked while suspended
        const ms = await getDoc(doc(db, 'artifacts', appId, 'communities', cid, 'members', me().uid));
        if (ms.exists() && isSuspended(ms.data())) { toast('You are suspended from this community', 'error'); return; }
        await setDoc(doc(db, 'artifacts', appId, 'communities', cid, 'messages', msgId), {
            id: msgId, senderUid: me().uid, sender: myName(), avatar: myAvatar(), text, createdAt: serverTimestamp()
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