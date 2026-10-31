// js/teams.js: the Teams tab (it replaces Friends). Same data as the iPhone and Android apps.
//
//   artifacts/{app}/teams/{teamId}:
//     name, nameKey, short, colors: { primary, secondary }, level: casual|intermediate|competitive,
//     joinMode: open|ask|invite, city, ownerId,
//     logo: { type: 'photo', url } | { type: 'crest', shape, pattern, icon }   (crest uses the team colors + short name)
//     members: [{ id, uid?, name, number, position, role: captain|co|player }], memberUids: [uid...],
//     lineups: [{ id, name, format, formation, spots: { "0": memberId, ... } }]   (spot 0 = goalkeeper)
//     communityIds: [], createdAt, updatedAt
//   teamNames/{nameKey}: { teamId }            one of a kind: "Real Madrid" == "real madrid" == "Real  Madrid."
//   teams/{teamId}/requests/{uid}: { uid, name, avatar, at }     "Ask to join"
//   teamInvites/{teamId}_{uid}: { teamId, teamName, uid, byUid, byName, at }   captain invited a player
//   freeAgents/{uid}: { uid, name, avatar, on, positions: [GK, DEF, MID, FWD], note, city, level, updatedAt }
// The server sends the notifications (requests, invites, "you were added").
import { db, appId } from './firebase-config.js';
import { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, onSnapshot, query, where, runTransaction, serverTimestamp, arrayUnion, arrayRemove }
    from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { uploadMedia } from './wa-chat.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const jsq = (v) => esc(String(v ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
const toast = (m, t) => window.showToast && window.showToast(m, t);
const me = () => window.currentUser || null;
const myUid = () => (me() && me().uid) || '';
const C = (name) => collection(db, 'artifacts', appId, name);
const D = (...p) => doc(db, 'artifacts', appId, ...p);
const myName = () => {
    const p = window.userProfile || {};
    return (p.name || `${p.firstName || ''} ${p.lastName || ''}`.trim() || (me() && me().displayName) || 'Player').trim();
};
const myAvatar = () => { const a = (window.userProfile || {}).avatar || ''; return /^https?:/.test(a) && a.length < 400 ? a : ''; };
const avatarOf = (uid, name) => window.resolvePlayerAvatar ? window.resolvePlayerAvatar({ uid, name }) : '';
const DEFAULT_AV = 'https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg';

// ---------------------------------------------------------------- shared rules (same on the phones)
export const LEVELS = [['casual', 'Casual'], ['intermediate', 'Intermediate'], ['competitive', 'Competitive']];
export const JOIN_MODES = [['ask', 'Ask to join', 'Players ask, a captain approves'], ['open', 'Open', 'Anyone can join right away'], ['invite', 'Invite only', 'Only captains add players']];
export const COLORS = ['#00F296', '#0EA5E9', '#2563EB', '#7C3AED', '#DB2777', '#DC2626', '#EA580C', '#FACC15', '#16A34A', '#FFFFFF', '#9CA3AF', '#111827'];
export const SHAPES = ['shield', 'circle', 'diamond', 'hexagon'];
export const PATTERNS = ['plain', 'stripes', 'half', 'band', 'hoops'];
export const ICONS = ['⚽', '⭐', '⚡', '🔥', '🦁', '🦅', '🐺', '👑', '🐉', '🌊', '🐍', '🛡️'];
export const POSITIONS = ['GK', 'DEF', 'MID', 'FWD'];
export const FORMATS = {
    '4v4': ['2-1', '1-2', '1-1-1'],
    '5v5': ['2-2', '1-2-1', '3-1'],
    '6v6': ['2-2-1', '3-1-1', '2-1-2'],
    '7v7': ['2-3-1', '3-2-1', '2-1-2-1'],
    '8v8': ['3-3-1', '3-2-2', '2-3-2'],
    '9v9': ['3-3-2', '3-2-3', '4-3-1'],
    '10v10': ['4-3-2', '3-4-2', '4-4-1'],
    '11v11': ['4-4-2', '4-3-3', '3-5-2', '4-2-3-1'],
};
const SUFFIXES = ['FC', 'United', 'Athletic', 'City', 'Stars', 'Squad'];

/** "Real Madrid" -> "realmadrid" (capitals, spaces, dots and accents don't make a name different). */
export function nameKey(name) {
    return String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
/** "Real Madrid" -> "RMA", "Coconut Creek United" -> "CCU". */
export function shortName(name) {
    const words = String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
    if (!words.length) return 'FC';
    if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
    if (words.length === 2) return (words[0][0] + words[1].slice(0, 2)).toUpperCase();
    return words.slice(0, 3).map(w => w[0]).join('').toUpperCase();
}
/** Other names to try when one is taken: with the city, FC/United/…, the year. */
export function nameIdeas(name, city) {
    const n = String(name || '').trim().replace(/\s+/g, ' ').replace(/[^\p{L}\p{N}]+$/u, '');
    if (!n) return [];
    const yy = String(new Date().getFullYear()).slice(2);
    const out = [];
    if (city) out.push(`${n} ${String(city).trim()}`);
    SUFFIXES.forEach(s => { if (!new RegExp(`\\b${s}\\b`, 'i').test(n)) out.push(`${n} ${s}`); });
    out.push(`${n} '${yy}`);
    return [...new Set(out)].filter(x => x.length <= 40);
}
export function canManage(t, uid = myUid()) {
    if (!t || !uid) return false;
    if (t.ownerId === uid) return true;
    return (t.members || []).some(m => m.uid === uid && (m.role === 'captain' || m.role === 'co'));
}
export function isMember(t, uid = myUid()) { return !!t && !!uid && (t.memberUids || []).includes(uid); }

/** Spots on the field for a formation: [{ x, y }] in %, spot 0 = goalkeeper (bottom). */
export function formationSpots(formation) {
    const lines = String(formation || '2-2').split('-').map(n => parseInt(n, 10)).filter(n => n > 0);
    const spots = [{ x: 50, y: 90 }];
    const top = 16, bottom = 70;
    lines.forEach((count, li) => {
        const y = lines.length === 1 ? (top + bottom) / 2 : bottom - (bottom - top) * li / (lines.length - 1);
        for (let i = 0; i < count; i++) spots.push({ x: Math.round((100 * (i + 1)) / (count + 1)), y: Math.round(y) });
    });
    return spots;
}

// ---------------------------------------------------------------- crest (logo maker), an SVG
const SHAPE_PATH = {
    shield: 'M50 4 L92 16 V48 C92 74 72 90 50 98 C28 90 8 74 8 48 V16 Z',
    circle: 'M50 4 A46 46 0 1 1 49.9 4 Z',
    diamond: 'M50 3 L97 50 L50 97 L3 50 Z',
    hexagon: 'M50 3 L91 26 V74 L50 97 L9 74 V26 Z',
};
function textOn(hex) {
    const h = String(hex || '#000').replace('#', '');
    const r = parseInt(h.slice(0, 2), 16) || 0, g = parseInt(h.slice(2, 4), 16) || 0, b = parseInt(h.slice(4, 6), 16) || 0;
    return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#0B141A' : '#FFFFFF';
}
export function crestSvg(team, size = 64) {
    const lg = (team && team.logo) || {};
    const p = (team.colors && team.colors.primary) || '#00F296', s = (team.colors && team.colors.secondary) || '#0B141A';
    const shape = SHAPE_PATH[lg.shape] ? lg.shape : 'shield';
    const id = 'c' + Math.random().toString(36).slice(2, 8);
    let pattern = '';
    if (lg.pattern === 'stripes') pattern = [20, 44, 68].map(x => `<rect x="${x}" y="0" width="12" height="100" fill="${s}"/>`).join('');
    else if (lg.pattern === 'half') pattern = `<rect x="50" y="0" width="50" height="100" fill="${s}"/>`;
    else if (lg.pattern === 'band') pattern = `<polygon points="0,70 70,0 100,0 100,10 10,100 0,100" fill="${s}"/>`;
    else if (lg.pattern === 'hoops') pattern = [22, 50, 78].map(y => `<rect x="0" y="${y - 6}" width="100" height="12" fill="${s}"/>`).join('');
    const short = esc(String(team.short || shortName(team.name)).slice(0, 4));
    const icon = lg.icon ? `<text x="50" y="44" text-anchor="middle" font-size="26">${esc(lg.icon)}</text>` : '';
    const ty = lg.icon ? 72 : 60;
    const fs = short.length > 3 ? 19 : 23;
    return `<svg width="${size}" height="${size}" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <defs><clipPath id="${id}"><path d="${SHAPE_PATH[shape]}"/></clipPath></defs>
        <g clip-path="url(#${id})"><rect width="100" height="100" fill="${p}"/>${pattern}</g>
        <path d="${SHAPE_PATH[shape]}" fill="none" stroke="${s}" stroke-width="4"/>
        ${icon}
        <text x="50" y="${ty}" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="${fs}"
            fill="${textOn(lg.pattern === 'half' ? s : p)}" stroke="${lg.pattern && lg.pattern !== 'plain' ? (textOn(p) === '#FFFFFF' ? '#0B141A' : '#FFFFFF') : 'none'}" stroke-width="${lg.pattern && lg.pattern !== 'plain' ? 1.2 : 0}" paint-order="stroke">${short}</text>
    </svg>`;
}
/** The team's logo: its photo, else the crest. */
export function teamLogoHtml(team, size = 48) {
    const lg = (team && team.logo) || {};
    if (lg.type === 'photo' && lg.url) return `<img src="${esc(lg.url)}" style="width:${size}px;height:${size}px" class="rounded-2xl object-cover shrink-0 bg-black/40">`;
    return `<span class="shrink-0 inline-block" style="width:${size}px;height:${size}px">${crestSvg(team || {}, size)}</span>`;
}
window.teamLogoHtml = teamLogoHtml;
function randomCrest() {
    const pick = (a) => a[Math.floor(Math.random() * a.length)];
    return { type: 'crest', shape: pick(SHAPES), pattern: pick(PATTERNS), icon: Math.random() < 0.6 ? pick(ICONS) : '' };
}

// ---------------------------------------------------------------- live data
const T = { mine: [], all: [], invites: [], agents: [], myAgent: null, unsubs: [], section: 'mine', search: '', open: null, openUnsub: null, openTab: 'roster', requests: [] };
window.__teamsState = T;
function stopAll() { T.unsubs.forEach(u => { try { u(); } catch (e) { /* ignore */ } }); T.unsubs = []; }
const docsOf = (s) => s.docs.map(d => ({ ...d.data(), id: d.id }));

export function startTeams() {
    stopAll();
    const uid = myUid(); if (!uid) return;
    T.unsubs.push(onSnapshot(query(C('teams'), where('memberUids', 'array-contains', uid)), s => { T.mine = docsOf(s); refreshTeamsUi(); }, () => {}));
    T.unsubs.push(onSnapshot(query(C('teamInvites'), where('uid', '==', uid)), s => { T.invites = docsOf(s); refreshTeamsUi(); updateBadge(); }, () => {}));
    T.unsubs.push(onSnapshot(D('freeAgents', uid), s => { T.myAgent = (s.exists && s.exists()) ? s.data() : null; refreshTeamsUi(); }, () => {}));
}
window.startTeams = startTeams;
async function loadAll() {
    try { T.all = docsOf(await getDocs(C('teams'))); } catch (e) { T.all = []; }
    refreshTeamsUi();
}
async function loadAgents() {
    try { T.agents = docsOf(await getDocs(query(C('freeAgents'), where('on', '==', true)))); } catch (e) { T.agents = []; }
    refreshTeamsUi();
}
let pendingReq = 0;
async function countRequests() {
    let n = 0;
    for (const t of T.mine.filter(x => canManage(x))) {
        try { n += (await getDocs(collection(db, 'artifacts', appId, 'teams', t.id, 'requests'))).size; } catch (e) { /* ignore */ }
    }
    pendingReq = n; updateBadge();
}
function updateBadge() {
    const n = T.invites.length + pendingReq;
    ['friends-badge', 'mob-friends-dot'].forEach(id => {
        const b = document.getElementById(id); if (!b) return;
        b.textContent = n > 99 ? '99+' : String(n);
        b.classList.toggle('hidden', !n); b.classList.toggle('flex', !!n);
    });
}

// ---------------------------------------------------------------- the tab
const BTN = 'bg-gradient-to-r from-[#00F296] to-[#00B4AE] text-slate-950 font-black rounded-xl text-xs px-4 py-2.5 transition';
const DARK = 'bg-black/60 hover:bg-black text-white font-bold rounded-xl text-xs px-4 py-2.5 border border-white/15 transition';
const CARD = 'bg-[#040E13]/90 border border-emerald-500/30 rounded-2xl p-4 shadow-xl backdrop-blur-md';
const INPUT = 'w-full bg-black/50 border border-teal-500/60 rounded-xl px-3 py-2.5 text-white text-base sm:text-sm focus:outline-none focus:border-[#00F296]';
const levelLabel = (k) => (LEVELS.find(l => l[0] === k) || LEVELS[0])[1];

function root() { return document.getElementById('teams-root'); }
function refreshTeamsUi() {
    if (T.open) { renderTeamPage(); return; }
    renderTeamsTab();
}
window.renderTeamsTab = renderTeamsTab;

function teamCard(t, right = '') {
    const role = t.ownerId === myUid() ? 'Captain' : ((t.members || []).find(m => m.uid === myUid()) || {}).role === 'co' ? 'Co-captain'
        : ((t.members || []).find(m => m.uid === myUid()) || {}).role === 'captain' ? 'Captain' : (isMember(t) ? 'Player' : '');
    return `<div onclick="openTeam('${jsq(t.id)}')" class="flex items-center gap-3 bg-black/40 border border-white/10 hover:border-emerald-400/60 rounded-2xl p-3 cursor-pointer transition">
        ${teamLogoHtml(t, 48)}
        <div class="flex-1 min-w-0">
            <div class="text-sm font-black text-white truncate">${esc(t.name)}</div>
            <div class="text-[11px] text-white/55 truncate">${esc(levelLabel(t.level))} · ${(t.members || []).length} player${(t.members || []).length === 1 ? '' : 's'}${t.city ? ' · ' + esc(t.city) : ''}</div>
        </div>
        ${right || (role ? `<span class="text-[9px] font-black uppercase rounded-full px-2 py-1 ${role === 'Player' ? 'bg-white/10 text-white/70' : 'bg-[#00F296] text-slate-950'}">${role}</span>` : '')}
    </div>`;
}

export function renderTeamsTab() {
    const el = root(); if (!el) return;
    if (!me()) { el.innerHTML = '<p class="text-xs text-white/50 text-center py-10">Sign in to see teams.</p>'; return; }
    const sec = T.section;
    const chip = (k, l) => `<button onclick="teamsSection('${k}')" class="px-3.5 py-2 rounded-xl text-xs font-black transition ${sec === k ? 'bg-[#00F296] text-slate-950' : 'bg-black/50 text-white/75 border border-white/10'}">${l}</button>`;
    let body = '';
    if (sec === 'find') {
        const q = T.search.trim().toLowerCase();
        const list = T.all.filter(t => !q || `${t.name} ${t.city || ''}`.toLowerCase().includes(q)).sort((a, b) => String(a.name).localeCompare(String(b.name)));
        body = `<input id="teams-search" class="${INPUT}" placeholder="Search teams by name or city" value="${esc(T.search)}" oninput="teamsSearch(this.value)">
            <div class="space-y-2">${list.length ? list.map(t => teamCard(t)).join('') : '<p class="text-xs text-white/45 text-center py-6">No teams found.</p>'}</div>`;
    } else if (sec === 'agents') {
        const a = T.myAgent;
        const mineToInvite = T.mine.filter(t => canManage(t));
        body = `<div class="${CARD} space-y-2">
                <div class="flex items-center justify-between gap-3">
                    <div><div class="text-sm font-black text-white">I'm a free agent</div><div class="text-[11px] text-white/55">Captains looking for players can find you and invite you.</div></div>
                    <label class="relative inline-flex items-center cursor-pointer shrink-0"><input type="checkbox" ${a && a.on ? 'checked' : ''} onchange="toggleFreeAgent(this.checked)" class="sr-only peer">
                        <span class="w-11 h-6 bg-white/15 rounded-full peer-checked:bg-[#00F296] transition"></span><span class="absolute left-0.5 top-0.5 w-5 h-5 bg-white rounded-full transition peer-checked:translate-x-5"></span></label>
                </div>
                ${a && a.on ? `<div class="text-[11px] text-white/70">${esc((a.positions || []).join(' · ') || 'Any position')}${a.note ? ' — ' + esc(a.note) : ''}</div>
                    <button onclick="editFreeAgent()" class="text-[11px] font-bold text-[#00F296] underline">Edit positions & note</button>` : ''}
            </div>
            <div class="text-[10px] font-black text-[#00F296] uppercase tracking-wider pt-1">Free agents (${T.agents.filter(x => x.uid !== myUid()).length})</div>
            ${mineToInvite.length ? '' : '<p class="text-[11px] text-white/45">Create a team to invite free agents.</p>'}
            <div class="space-y-2">${T.agents.filter(x => x.uid !== myUid() && !(window.isBlocked && window.isBlocked(x.uid))).map(x => `
                <div class="flex items-center gap-3 bg-black/40 border border-white/10 rounded-2xl p-3">
                    <img src="${esc(x.avatar || avatarOf(x.uid, x.name) || DEFAULT_AV)}" onerror="this.src='${DEFAULT_AV}'" onclick="openPlayerStatsSheet && openPlayerStatsSheet('${jsq(x.uid)}','${jsq(x.name)}','')" class="w-11 h-11 rounded-full object-cover border border-emerald-500/40 cursor-pointer">
                    <div class="flex-1 min-w-0">
                        <div class="text-sm font-black text-white truncate">${esc(x.name || 'Player')}</div>
                        <div class="text-[11px] text-[#00F296] font-bold">${esc((x.positions || []).join(' · ') || 'Any position')}${x.level ? ' · ' + esc(levelLabel(x.level)) : ''}</div>
                        ${x.note ? `<div class="text-[11px] text-white/65 line-clamp-2">${esc(x.note)}</div>` : ''}
                    </div>
                    ${mineToInvite.length ? `<button onclick="inviteFreeAgent('${jsq(x.uid)}','${jsq(x.name)}')" class="${BTN} shrink-0">Invite</button>` : ''}
                </div>`).join('') || '<p class="text-xs text-white/45 text-center py-6">No free agents right now.</p>'}</div>`;
    } else {
        body = `${T.invites.length ? `<div class="text-[10px] font-black text-amber-300 uppercase tracking-wider">Invites (${T.invites.length})</div>
            <div class="space-y-2">${T.invites.map(iv => `<div class="flex items-center gap-3 bg-amber-400/10 border border-amber-400/40 rounded-2xl p-3">
                <div class="flex-1 min-w-0"><div class="text-sm font-black text-white truncate">${esc(iv.teamName || 'A team')}</div>
                <div class="text-[11px] text-white/60">${esc(iv.byName || 'A captain')} invited you to join</div></div>
                <button onclick="answerInvite('${jsq(iv.id)}', false)" class="${DARK}">Decline</button>
                <button onclick="answerInvite('${jsq(iv.id)}', true)" class="${BTN}">Join</button></div>`).join('')}</div>` : ''}
            <div class="space-y-2">${T.mine.length ? T.mine.sort((a, b) => String(a.name).localeCompare(String(b.name))).map(t => teamCard(t)).join('')
                : `<div class="${CARD} text-center space-y-3 py-8"><div class="text-4xl">🛡️</div><div class="text-sm font-black text-white">No team yet</div>
                    <p class="text-[11px] text-white/55">Create your team, add your players, set your lineup, then play VS Mode games against other teams.</p>
                    <button onclick="openCreateTeam()" class="${BTN}">+ Create a team</button></div>`}</div>`;
    }
    el.innerHTML = `<div class="space-y-4">
        <div class="${CARD} flex items-center justify-between gap-3">
            <div><h2 class="text-xl font-black text-white">Teams</h2><p class="text-white/65 text-xs">Your teams, players and lineups. VS Mode is coming next.</p></div>
            <button onclick="openCreateTeam()" class="${BTN} shrink-0">+ Create team</button>
        </div>
        <div class="flex gap-2 overflow-x-auto">${chip('mine', 'My teams')}${chip('find', 'Find teams')}${chip('agents', 'Free agents')}</div>
        ${body}
    </div>`;
    if (sec === 'find') { const i = document.getElementById('teams-search'); if (i && document.activeElement !== i && T._typing) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
}
window.teamsSection = (k) => { T.section = k; if (k === 'find') loadAll(); if (k === 'agents') loadAgents(); renderTeamsTab(); };
window.teamsSearch = (v) => { T.search = v; T._typing = true; renderTeamsTab(); T._typing = false; const i = document.getElementById('teams-search'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } };

// ---------------------------------------------------------------- create / edit team
function sheet(id, title, body) {
    document.getElementById(id)?.remove();
    const m = document.createElement('div');
    m.id = id;
    m.className = 'fixed inset-0 z-[150] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-md sm:p-4';
    m.innerHTML = `<div class="bg-[#040E13] border border-emerald-500/40 rounded-t-3xl sm:rounded-3xl w-full max-w-md overflow-y-auto shadow-2xl text-white" style="max-height:90dvh">
        <div class="flex items-center justify-between px-5 pt-5 pb-2 sticky top-0 bg-[#040E13] z-10">
            <div class="text-base font-black">${title}</div>
            <button onclick="document.getElementById('${id}').remove()" class="w-8 h-8 rounded-full bg-black/60 border border-white/15 flex items-center justify-center"><i class="fa-solid fa-xmark text-xs"></i></button>
        </div>
        <div class="p-5 pt-2 space-y-4">${body}</div></div>`;
    document.body.appendChild(m);
    return m;
}
const F = { editing: null, name: '', short: '', shortTouched: false, primary: '#00F296', secondary: '#0B141A', level: 'casual', joinMode: 'ask', city: '', logo: null, photoFile: null, nameOk: null, ideas: [] };
window.__teamForm = F;

window.openCreateTeam = function (teamId) {
    const t = teamId ? (T.mine.find(x => x.id === teamId) || T.open) : null;
    Object.assign(F, t ? {
        editing: t.id, name: t.name || '', short: t.short || shortName(t.name), shortTouched: true,
        primary: (t.colors && t.colors.primary) || '#00F296', secondary: (t.colors && t.colors.secondary) || '#0B141A',
        level: t.level || 'casual', joinMode: t.joinMode || 'ask', city: t.city || '', logo: t.logo || randomCrest(), photoFile: null, nameOk: true, ideas: [],
    } : {
        editing: null, name: '', short: '', shortTouched: false, primary: '#00F296', secondary: '#0B141A', level: 'casual', joinMode: 'ask',
        city: (window.userProfile && window.userProfile.city) || '', logo: randomCrest(), photoFile: null, nameOk: null, ideas: [],
    });
    sheet('team-form', t ? 'Edit team' : 'Create a team', formBody());
    drawFormPreview();
};
function formBody() {
    const lbl = (t) => `<div class="text-[10px] font-black uppercase tracking-wider text-white/55 mb-1.5">${t}</div>`;
    const sw = (key) => `<div class="flex flex-wrap gap-1.5">${COLORS.map(c => `<button type="button" onclick="teamFormColor('${key}','${c}')" data-color="${key}${c}"
        class="w-8 h-8 rounded-full border-2 ${F[key] === c ? 'border-[#00F296] scale-110' : 'border-white/20'}" style="background:${c}"></button>`).join('')}</div>`;
    return `
        <div class="flex items-center gap-4">
            <div id="tf-preview" class="shrink-0"></div>
            <div class="flex-1 space-y-2">
                <button type="button" onclick="teamFormShuffle()" class="${DARK} w-full"><i class="fa-solid fa-shuffle mr-1"></i> Make one for me</button>
                <button type="button" onclick="document.getElementById('tf-photo').click()" class="${DARK} w-full"><i class="fa-regular fa-image mr-1"></i> Upload a logo</button>
                <input id="tf-photo" type="file" accept="image/*" class="hidden" onchange="teamFormPhoto(this)">
            </div>
        </div>
        <div id="tf-crest-opts" class="space-y-2 ${F.logo && F.logo.type === 'photo' ? 'hidden' : ''}">
            <div class="flex flex-wrap gap-1.5">${SHAPES.map(s => `<button type="button" onclick="teamFormCrest('shape','${s}')" class="px-2.5 py-1.5 rounded-lg text-[11px] font-bold ${F.logo && F.logo.shape === s ? 'bg-[#00F296] text-slate-950' : 'bg-white/10 text-white/80'}">${s}</button>`).join('')}</div>
            <div class="flex flex-wrap gap-1.5">${PATTERNS.map(s => `<button type="button" onclick="teamFormCrest('pattern','${s}')" class="px-2.5 py-1.5 rounded-lg text-[11px] font-bold ${F.logo && F.logo.pattern === s ? 'bg-[#00F296] text-slate-950' : 'bg-white/10 text-white/80'}">${s}</button>`).join('')}</div>
            <div class="flex flex-wrap gap-1">${['', ...ICONS].map(s => `<button type="button" onclick="teamFormCrest('icon','${s}')" class="w-9 h-9 rounded-lg text-lg ${F.logo && (F.logo.icon || '') === s ? 'bg-[#00F296]/30 border border-[#00F296]' : 'bg-white/5'}">${s || '<span class="text-[10px] text-white/60">none</span>'}</button>`).join('')}</div>
        </div>
        <div>${lbl('Team name *')}<input id="tf-name" class="${INPUT}" maxlength="40" value="${esc(F.name)}" placeholder="e.g. Coconut Creek United" oninput="teamFormName(this.value)">
            <div id="tf-name-msg" class="text-[11px] mt-1.5"></div></div>
        <div class="flex gap-3">
            <div class="w-28">${lbl('Short name')}<input id="tf-short" class="${INPUT} uppercase" maxlength="4" value="${esc(F.short)}" oninput="teamFormShort(this.value)"></div>
            <div class="flex-1">${lbl('City')}<input id="tf-city" class="${INPUT}" maxlength="40" value="${esc(F.city)}" placeholder="City" oninput="window.__teamForm.city=this.value"></div>
        </div>
        <div>${lbl('Main color')}${sw('primary')}</div>
        <div>${lbl('Second color')}${sw('secondary')}</div>
        <div>${lbl('Level')}<div class="grid grid-cols-3 gap-1.5">${LEVELS.map(([k, l]) => `<button type="button" onclick="teamFormSet('level','${k}')" class="py-2.5 rounded-xl text-[11px] font-black ${F.level === k ? 'bg-[#00F296] text-slate-950' : 'bg-white/5 text-white/80 border border-white/10'}">${l}</button>`).join('')}</div></div>
        <div>${lbl('Who can join?')}<div class="space-y-1.5">${JOIN_MODES.map(([k, l, d]) => `<button type="button" onclick="teamFormSet('joinMode','${k}')" class="w-full text-left rounded-xl px-3 py-2.5 border ${F.joinMode === k ? 'border-[#00F296] bg-[#00F296]/10' : 'border-white/10 bg-white/5'}">
            <div class="text-xs font-black">${l}</div><div class="text-[10px] text-white/55">${d}</div></button>`).join('')}</div></div>
        <button id="tf-save" onclick="saveTeam()" class="${BTN} w-full py-3 text-sm">${F.editing ? 'Save changes' : 'Create team'}</button>
        ${F.editing && T.open && T.open.ownerId === myUid() ? `<button onclick="deleteTeam('${jsq(F.editing)}')" class="w-full text-xs font-bold text-red-400 py-2">Delete team</button>` : ''}`;
}
function redrawForm() {
    const m = document.getElementById('team-form'); if (!m) return;
    const body = m.querySelector('.p-5'); if (!body) return;
    const focus = document.activeElement && document.activeElement.id;
    body.innerHTML = formBody();
    drawFormPreview(); showNameMsg();
    if (focus) { const n = document.getElementById(focus); if (n && n.focus) { n.focus(); try { n.setSelectionRange(n.value.length, n.value.length); } catch (e) { /* ignore */ } } }
}
function previewTeam() { return { name: F.name || 'Team', short: F.short || shortName(F.name || 'Team'), colors: { primary: F.primary, secondary: F.secondary }, logo: F.logo }; }
function drawFormPreview() { const p = document.getElementById('tf-preview'); if (p) p.innerHTML = teamLogoHtml(previewTeam(), 88); }
window.teamFormColor = (k, c) => { F[k] = c; redrawForm(); };
window.teamFormSet = (k, v) => { F[k] = v; redrawForm(); };
window.teamFormShuffle = () => { F.logo = randomCrest(); F.photoFile = null; redrawForm(); };
window.teamFormCrest = (k, v) => { if (!F.logo || F.logo.type !== 'crest') F.logo = randomCrest(); F.logo[k] = v; redrawForm(); };
window.teamFormPhoto = (input) => {
    const f = input.files && input.files[0]; if (!f) return;
    F.photoFile = f; F.logo = { type: 'photo', url: URL.createObjectURL(f) };
    redrawForm();
};
window.teamFormShort = (v) => { F.short = String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4); F.shortTouched = true; drawFormPreview(); };
let nameTimer = null;
window.teamFormName = (v) => {
    F.name = v; if (!F.shortTouched) { F.short = shortName(v); const s = document.getElementById('tf-short'); if (s) s.value = F.short; }
    drawFormPreview();
    F.nameOk = null; F.ideas = []; showNameMsg();
    clearTimeout(nameTimer);
    nameTimer = setTimeout(() => checkName(v), 450);
};
async function isNameFree(name) {
    const k = nameKey(name); if (k.length < 2) return false;
    try {
        const s = await getDoc(D('teamNames', k));
        if (!s.exists()) return true;
        return !!F.editing && s.data().teamId === F.editing;   // your own team's name
    } catch (e) { return true; }   // can't check right now: the save checks again
}
async function checkName(v) {
    if (nameKey(v).length < 2) { F.nameOk = null; showNameMsg(); return; }
    const free = await isNameFree(v);
    if (F.name !== v) return;
    F.nameOk = free;
    F.ideas = [];
    if (!free) {
        const ideas = nameIdeas(v, F.city);
        for (const n of ideas) { if (await isNameFree(n)) F.ideas.push(n); if (F.ideas.length >= 4) break; }
        if (F.name !== v) return;
    }
    showNameMsg();
}
function showNameMsg() {
    const el = document.getElementById('tf-name-msg'); if (!el) return;
    if (F.nameOk === true) el.innerHTML = '<span class="text-[#00F296] font-bold"><i class="fa-solid fa-check mr-1"></i>That name is free</span>';
    else if (F.nameOk === false) el.innerHTML = `<span class="text-amber-300 font-bold">That name is taken. Try one of these:</span>
        <div class="flex flex-wrap gap-1.5 mt-1.5">${F.ideas.map(n => `<button type="button" onclick="teamFormUseName('${jsq(n)}')" class="px-2.5 py-1.5 rounded-lg bg-white/10 text-[11px] font-bold text-white">${esc(n)}</button>`).join('') || '<span class="text-white/50">Try a different name.</span>'}</div>`;
    else el.innerHTML = '';
}
window.teamFormUseName = (n) => { const i = document.getElementById('tf-name'); if (i) i.value = n; window.teamFormName(n); };

window.saveTeam = async function () {
    const uid = myUid(); if (!uid) return;
    const name = String(F.name || '').trim().replace(/\s+/g, ' ');
    const key = nameKey(name);
    if (key.length < 2) { toast('Give your team a name.', 'error'); return; }
    const btn = document.getElementById('tf-save'); if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    try {
        let logo = F.logo || randomCrest();
        if (logo.type === 'photo' && F.photoFile) {
            const up = await uploadMedia(F.photoFile, 'teams/logo');
            logo = { type: 'photo', url: up.url };
        }
        const data = {
            name, nameKey: key, short: (F.short || shortName(name)).slice(0, 4), city: String(F.city || '').trim().slice(0, 40),
            colors: { primary: F.primary, secondary: F.secondary }, level: F.level, joinMode: F.joinMode, logo, updatedAt: serverTimestamp(),
        };
        const ref = F.editing ? D('teams', F.editing) : doc(C('teams'));
        await runTransaction(db, async (tx) => {
            const nameRef = D('teamNames', key);
            const taken = await tx.get(nameRef);
            const cur = F.editing ? await tx.get(ref) : null;
            if (taken.exists() && taken.data().teamId !== ref.id) throw new Error('TAKEN');
            if (cur && cur.exists() && cur.data().nameKey && cur.data().nameKey !== key) tx.delete(D('teamNames', cur.data().nameKey));
            tx.set(nameRef, { teamId: ref.id, name });
            if (F.editing) tx.update(ref, data);
            else tx.set(ref, {
                ...data, ownerId: uid, createdAt: serverTimestamp(), communityIds: [], lineups: [],
                members: [{ id: uid, uid, name: myName(), number: '', position: '', role: 'captain' }], memberUids: [uid],
            });
        });
        document.getElementById('team-form')?.remove();
        toast(F.editing ? 'Team saved.' : `${name} is ready! Now add your players.`);
        if (!F.editing) window.openTeam(ref.id);
    } catch (e) {
        if (btn) { btn.disabled = false; btn.textContent = F.editing ? 'Save changes' : 'Create team'; }
        if (String(e && e.message) === 'TAKEN') { F.nameOk = false; checkName(name); toast('That name was just taken. Pick another.', 'error'); }
        else { console.error(e); toast("Couldn't save the team. Check your connection.", 'error'); }
    }
};

window.deleteTeam = async function (teamId) {
    const t = T.open; if (!t || t.ownerId !== myUid()) return;
    if (!confirm(`Delete ${t.name}? This can't be undone.`)) return;
    try {
        await runTransaction(db, async (tx) => {
            tx.delete(D('teams', teamId));
            if (t.nameKey) tx.delete(D('teamNames', t.nameKey));
        });
        document.getElementById('team-form')?.remove();
        window.closeTeam();
        toast('Team deleted.');
    } catch (e) { console.error(e); toast("Couldn't delete the team.", 'error'); }
};

// ---------------------------------------------------------------- team page
window.openTeam = function (teamId) {
    if (T.openUnsub) { T.openUnsub(); T.openUnsub = null; }
    T.open = (T.mine.find(x => x.id === teamId) || T.all.find(x => x.id === teamId) || { id: teamId, name: 'Team', members: [] });
    T.openTab = 'roster'; T.requests = []; T.myRequest = false;
    let reqUnsub = null;
    T.openUnsub = onSnapshot(D('teams', teamId), s => {
        if (!s.exists()) { if (T.open && T.open.id === teamId) { window.closeTeam(); toast('This team was deleted.'); } return; }
        T.open = { ...s.data(), id: teamId };
        if (canManage(T.open) && !reqUnsub) {
            reqUnsub = onSnapshot(collection(db, 'artifacts', appId, 'teams', teamId, 'requests'), r => { T.requests = docsOf(r); renderTeamPage(); countRequests(); }, () => {});
        }
        renderTeamPage();
    }, () => {});
    const u0 = T.openUnsub; T.openUnsub = () => { u0(); if (reqUnsub) reqUnsub(); };
    getDoc(doc(db, 'artifacts', appId, 'teams', teamId, 'requests', myUid())).then(s => { T.myRequest = s.exists(); renderTeamPage(); }).catch(() => {});
    renderTeamPage();
};
window.closeTeam = function () {
    if (T.openUnsub) { T.openUnsub(); T.openUnsub = null; }
    T.open = null;
    document.getElementById('team-page')?.remove();
    renderTeamsTab();
};
function renderTeamPage() {
    const t = T.open; if (!t) return;
    let m = document.getElementById('team-page');
    if (!m) { m = document.createElement('div'); m.id = 'team-page'; m.className = 'fixed inset-0 z-[130] bg-[#01060A]/95 backdrop-blur-sm overflow-y-auto text-white'; document.body.appendChild(m); }
    const boss = canManage(t), member = isMember(t);
    const tab = T.openTab;
    const tabs = [['roster', `Roster (${(t.members || []).length})`], ['lineup', 'Lineup']];
    if (boss) tabs.push(['requests', `Requests${T.requests.length ? ' (' + T.requests.length + ')' : ''}`]);
    let action = '';
    if (!member) {
        if (t.joinMode === 'open') action = `<button onclick="joinTeam()" class="${BTN} w-full py-3 text-sm">Join ${esc(t.name)}</button>`;
        else if (t.joinMode === 'invite') action = '<p class="text-[11px] text-white/55 text-center">Invite only: a captain has to add you.</p>';
        else action = T.myRequest ? `<button onclick="cancelTeamRequest()" class="${DARK} w-full py-3">Request sent · Cancel</button>`
            : `<button onclick="askToJoinTeam()" class="${BTN} w-full py-3 text-sm">Ask to join</button>`;
    }
    m.innerHTML = `<div class="max-w-md mx-auto p-4 pb-20 space-y-4">
        <div class="flex items-center justify-between">
            <button onclick="closeTeam()" class="w-9 h-9 rounded-full bg-black/60 border border-white/15 flex items-center justify-center"><i class="fa-solid fa-arrow-left"></i></button>
            ${boss ? `<button onclick="openCreateTeam('${jsq(t.id)}')" class="${DARK}"><i class="fa-solid fa-pen mr-1"></i> Edit team</button>` : ''}
        </div>
        <div class="flex flex-col items-center text-center gap-2">
            ${teamLogoHtml(t, 96)}
            <div class="text-xl font-black">${esc(t.name)} <span class="text-white/45 text-sm">${esc(t.short || '')}</span></div>
            <div class="flex flex-wrap justify-center gap-1.5 text-[10px] font-black uppercase">
                <span class="rounded-full px-2 py-1 bg-white/10">${esc(levelLabel(t.level))}</span>
                <span class="rounded-full px-2 py-1 bg-white/10">${esc((JOIN_MODES.find(j => j[0] === t.joinMode) || JOIN_MODES[0])[1])}</span>
                ${t.city ? `<span class="rounded-full px-2 py-1 bg-white/10">${esc(t.city)}</span>` : ''}
                <span class="rounded-full px-2 py-1 flex items-center gap-1 bg-white/10"><span class="w-3 h-3 rounded-full inline-block" style="background:${esc((t.colors || {}).primary || '#00F296')}"></span><span class="w-3 h-3 rounded-full inline-block border border-white/30" style="background:${esc((t.colors || {}).secondary || '#0B141A')}"></span></span>
            </div>
        </div>
        ${action}
        <div class="flex gap-2">${tabs.map(([k, l]) => `<button onclick="teamTab('${k}')" class="flex-1 py-2.5 rounded-xl text-xs font-black ${tab === k ? 'bg-[#00F296] text-slate-950' : 'bg-black/50 text-white/75 border border-white/10'}">${l}</button>`).join('')}</div>
        ${tab === 'lineup' ? lineupHtml(t, boss) : tab === 'requests' && boss ? requestsHtml(t) : rosterHtml(t, boss)}
        ${member && t.ownerId !== myUid() ? `<button onclick="leaveTeam()" class="w-full text-xs font-bold text-red-400 py-2">Leave team</button>` : ''}
    </div>`;
}
window.teamTab = (k) => { T.openTab = k; renderTeamPage(); };

const roleLabel = (r) => r === 'captain' ? 'Captain' : r === 'co' ? 'Co-captain' : '';
function rosterHtml(t, boss) {
    const list = (t.members || []).slice().sort((a, b) => (a.role === 'captain' ? -1 : b.role === 'captain' ? 1 : 0) || (a.role === 'co' ? -1 : b.role === 'co' ? 1 : 0)
        || (parseInt(a.number, 10) || 999) - (parseInt(b.number, 10) || 999) || String(a.name).localeCompare(String(b.name)));
    return `<div class="space-y-2">
        ${boss ? `<button onclick="openAddTeamPlayer()" class="${BTN} w-full py-3"><i class="fa-solid fa-user-plus mr-1"></i> Add player</button>` : ''}
        ${list.map(p => `<div class="flex items-center gap-3 bg-black/40 border border-white/10 rounded-2xl p-2.5">
            <div class="w-9 text-center text-lg font-black text-[#00F296]">${esc(p.number || '')}</div>
            ${p.uid ? `<img src="${esc(avatarOf(p.uid, p.name) || DEFAULT_AV)}" onerror="this.src='${DEFAULT_AV}'" class="w-10 h-10 rounded-full object-cover cursor-pointer" onclick="openPlayerStatsSheet && openPlayerStatsSheet('${jsq(p.uid)}','${jsq(p.name)}','')">`
                : '<div class="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white/50"><i class="fa-solid fa-user"></i></div>'}
            <div class="flex-1 min-w-0">
                <div class="text-sm font-black truncate">${esc(p.name || 'Player')}${p.uid === myUid() ? ' <span class="text-white/45 font-semibold text-xs">(you)</span>' : ''}</div>
                <div class="text-[11px] text-white/55">${esc([p.position, roleLabel(p.role), p.uid ? '' : 'Not on FutNet'].filter(Boolean).join(' · '))}</div>
            </div>
            ${boss ? `<button onclick="editTeamPlayer('${jsq(p.id)}')" class="w-8 h-8 rounded-full bg-white/10 text-white/70"><i class="fa-solid fa-pen text-xs"></i></button>` : ''}
        </div>`).join('')}
    </div>`;
}
function requestsHtml(t) {
    if (!T.requests.length) return '<p class="text-xs text-white/45 text-center py-6">No requests right now.</p>';
    return `<div class="space-y-2">${T.requests.map(r => `<div class="flex items-center gap-3 bg-black/40 border border-white/10 rounded-2xl p-2.5">
        <img src="${esc(r.avatar || avatarOf(r.uid, r.name) || DEFAULT_AV)}" onerror="this.src='${DEFAULT_AV}'" class="w-10 h-10 rounded-full object-cover">
        <div class="flex-1 min-w-0 text-sm font-black truncate">${esc(r.name || 'Player')}</div>
        <button onclick="answerTeamRequest('${jsq(r.uid)}', false)" class="${DARK}">Decline</button>
        <button onclick="answerTeamRequest('${jsq(r.uid)}', true)" class="${BTN}">Add</button></div>`).join('')}</div>`;
}

// ---------------------------------------------------------------- roster changes (one transaction each)
async function changeTeam(teamId, fn) {
    await runTransaction(db, async (tx) => {
        const ref = D('teams', teamId);
        const s = await tx.get(ref);
        if (!s.exists()) throw new Error('GONE');
        const t = s.data();
        const members = (t.members || []).map(x => ({ ...x }));
        const out = fn(members, t);
        if (out === false) return;
        tx.update(ref, { members, memberUids: [...new Set(members.filter(x => x.uid).map(x => x.uid))], updatedBy: myUid(), updatedAt: serverTimestamp() });
    });
}
function personMember(uid, name) { return { id: uid, uid, name: name || 'Player', number: '', position: '', role: 'player' }; }

window.openAddTeamPlayer = function () {
    sheet('team-add', 'Add player', `
        <input id="ta-search" class="${INPUT}" placeholder="Search players on FutNet" oninput="teamAddSearch(this.value)" autocomplete="off">
        <div id="ta-results" class="space-y-1.5 max-h-72 overflow-y-auto"></div>
        <div class="border-t border-white/10 pt-3 space-y-2">
            <div class="text-[10px] font-black uppercase tracking-wider text-white/55">Not on FutNet? Type their name</div>
            <div class="flex gap-2"><input id="ta-manual" class="${INPUT}" maxlength="40" placeholder="Player name"><button onclick="addManualPlayer()" class="${BTN} shrink-0">Add</button></div>
        </div>`);
    window.teamAddSearch('');
    setTimeout(() => document.getElementById('ta-search')?.focus(), 50);
};
window.teamAddSearch = function (q) {
    const box = document.getElementById('ta-results'); if (!box || !T.open) return;
    const have = new Set(T.open.memberUids || []);
    const ql = String(q || '').trim().toLowerCase();
    const people = (window.cachedDirectoryList || window.directoryList || []).filter(u => u.uid && !have.has(u.uid) && !(window.isBlocked && window.isBlocked(u.uid)));
    const nm = (u) => (u.name || `${u.firstName || ''} ${u.lastName || ''}`).trim() || 'Player';
    const list = (ql ? people.filter(u => `${nm(u)} ${u.nickname || ''}`.toLowerCase().includes(ql)) : people.slice(0, 0)).slice(0, 30);
    box.innerHTML = ql ? (list.map(u => `<button onclick="addAppPlayer('${jsq(u.uid)}','${jsq(nm(u))}')" class="w-full flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-white/5 text-left">
        <img src="${esc(u.avatar || avatarOf(u.uid, nm(u)) || DEFAULT_AV)}" onerror="this.src='${DEFAULT_AV}'" class="w-9 h-9 rounded-full object-cover">
        <span class="flex-1 min-w-0"><span class="block text-sm font-bold truncate">${esc(nm(u))}</span><span class="block text-[11px] text-white/50">${esc(u.position || 'Player')}</span></span>
        <i class="fa-solid fa-plus text-[#00F296]"></i></button>`).join('') || '<p class="text-xs text-white/45 py-3 text-center">Nobody found.</p>')
        : '<p class="text-[11px] text-white/45 py-2">Type a name to search.</p>';
};
window.addAppPlayer = async function (uid, name) {
    const t = T.open; if (!t) return;
    try {
        await changeTeam(t.id, (members) => { if (members.some(x => x.uid === uid)) return false; members.push(personMember(uid, name)); });
        toast(`${name} added. They'll get a notification.`);
        document.getElementById('team-add')?.remove();
    } catch (e) { console.error(e); toast("Couldn't add the player.", 'error'); }
};
window.addManualPlayer = async function () {
    const t = T.open; if (!t) return;
    const name = String(document.getElementById('ta-manual')?.value || '').trim();
    if (!name) { toast('Type their name.', 'error'); return; }
    try {
        await changeTeam(t.id, (members) => { members.push({ id: 'm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name, number: '', position: '', role: 'player' }); });
        toast(`${name} added.`);
        document.getElementById('team-add')?.remove();
    } catch (e) { console.error(e); toast("Couldn't add the player.", 'error'); }
};
window.editTeamPlayer = function (memberId) {
    const t = T.open; if (!t) return;
    const p = (t.members || []).find(x => x.id === memberId); if (!p) return;
    const isOwner = p.uid && p.uid === t.ownerId;
    sheet('team-edit-player', esc(p.name || 'Player'), `
        <div class="flex gap-3">
            <div class="w-24"><div class="text-[10px] font-black uppercase text-white/55 mb-1.5">Number</div><input id="tep-num" class="${INPUT}" inputmode="numeric" maxlength="3" value="${esc(p.number || '')}"></div>
            <div class="flex-1"><div class="text-[10px] font-black uppercase text-white/55 mb-1.5">Position</div>
                <div class="grid grid-cols-4 gap-1">${POSITIONS.map(x => `<button type="button" onclick="document.querySelectorAll('[data-tep-pos]').forEach(b=>b.dataset.on='');this.dataset.on='1';this.parentNode.querySelectorAll('button').forEach(b=>b.className=b.dataset.on?'py-2.5 rounded-lg text-xs font-black bg-[#00F296] text-slate-950':'py-2.5 rounded-lg text-xs font-black bg-white/10')" data-tep-pos="${x}" data-on="${p.position === x ? '1' : ''}" class="py-2.5 rounded-lg text-xs font-black ${p.position === x ? 'bg-[#00F296] text-slate-950' : 'bg-white/10'}">${x}</button>`).join('')}</div></div>
        </div>
        ${!isOwner ? `<div><div class="text-[10px] font-black uppercase text-white/55 mb-1.5">Role</div>
            <select id="tep-role" class="${INPUT}">${[['player', 'Player'], ['co', 'Co-captain'], ['captain', 'Captain']].map(([k, l]) => `<option value="${k}" ${(p.role || 'player') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>` : '<p class="text-[11px] text-white/50">Team creator: always a captain.</p>'}
        <button onclick="saveTeamPlayer('${jsq(memberId)}')" class="${BTN} w-full py-3">Save</button>
        ${!isOwner ? `<button onclick="removeTeamPlayer('${jsq(memberId)}')" class="w-full text-xs font-bold text-red-400 py-2">Remove from team</button>` : ''}`);
};
window.saveTeamPlayer = async function (memberId) {
    const t = T.open; if (!t) return;
    const number = String(document.getElementById('tep-num')?.value || '').replace(/[^0-9]/g, '').slice(0, 3);
    const posBtn = document.querySelector('[data-tep-pos][data-on="1"]');
    const position = posBtn ? posBtn.dataset.tepPos : '';
    const role = document.getElementById('tep-role')?.value;
    try {
        await changeTeam(t.id, (members) => { const p = members.find(x => x.id === memberId); if (!p) return false; p.number = number; p.position = position; if (role) p.role = role; });
        document.getElementById('team-edit-player')?.remove();
    } catch (e) { console.error(e); toast("Couldn't save.", 'error'); }
};
window.removeTeamPlayer = async function (memberId) {
    const t = T.open; if (!t) return;
    const p = (t.members || []).find(x => x.id === memberId);
    if (!confirm(`Remove ${p ? p.name : 'this player'} from ${t.name}?`)) return;
    try {
        await changeTeam(t.id, (members) => { const i = members.findIndex(x => x.id === memberId); if (i < 0) return false; members.splice(i, 1); });
        document.getElementById('team-edit-player')?.remove();
    } catch (e) { console.error(e); toast("Couldn't remove.", 'error'); }
};
window.leaveTeam = async function () {
    const t = T.open; if (!t) return;
    if (!confirm(`Leave ${t.name}?`)) return;
    try {
        await changeTeam(t.id, (members) => { const i = members.findIndex(x => x.uid === myUid()); if (i < 0) return false; members.splice(i, 1); });
        window.closeTeam();
        toast(`You left ${t.name}.`);
    } catch (e) { console.error(e); toast("Couldn't leave.", 'error'); }
};

// ---------------------------------------------------------------- joining
window.joinTeam = async function () {
    const t = T.open; if (!t || t.joinMode !== 'open') return;
    const go = async () => {
        try { await changeTeam(t.id, (members) => { if (members.some(x => x.uid === myUid())) return false; members.push(personMember(myUid(), myName())); }); toast(`Welcome to ${t.name}!`); }
        catch (e) { console.error(e); toast("Couldn't join.", 'error'); }
    };
    const names = (t.memberUids || []).filter(u => window.isBlocked && window.isBlocked(u)).map(u => ((window.futnetSafety || {}).blocked || {})[u]?.name || 'Someone');
    if (names.length && !confirm(`Heads up: ${names.join(', ')}, who you blocked, ${names.length === 1 ? 'is' : 'are'} on this team.\n\nJoin anyway?`)) return;
    go();
};
window.askToJoinTeam = async function () {
    const t = T.open; if (!t) return;
    try {
        await setDoc(doc(db, 'artifacts', appId, 'teams', t.id, 'requests', myUid()), { uid: myUid(), name: myName(), avatar: myAvatar(), at: serverTimestamp() });
        T.myRequest = true; renderTeamPage();
        toast('Request sent! A captain will review it.');
    } catch (e) { console.error(e); toast("Couldn't send the request.", 'error'); }
};
window.cancelTeamRequest = async function () {
    const t = T.open; if (!t) return;
    try { await deleteDoc(doc(db, 'artifacts', appId, 'teams', t.id, 'requests', myUid())); T.myRequest = false; renderTeamPage(); } catch (e) { toast("Couldn't cancel.", 'error'); }
};
window.answerTeamRequest = async function (uid, yes) {
    const t = T.open; if (!t) return;
    const r = T.requests.find(x => x.uid === uid) || {};
    try {
        if (yes) await changeTeam(t.id, (members) => { if (members.some(x => x.uid === uid)) return false; members.push(personMember(uid, r.name)); });
        await deleteDoc(doc(db, 'artifacts', appId, 'teams', t.id, 'requests', uid));
        toast(yes ? `${r.name || 'Player'} added.` : 'Request declined.');
    } catch (e) { console.error(e); toast("Couldn't save.", 'error'); }
};
window.inviteFreeAgent = function (uid, name) {
    const mine = T.mine.filter(t => canManage(t) && !(t.memberUids || []).includes(uid));
    if (!mine.length) { toast(`${name} is already on your teams.`); return; }
    const send = async (t) => {
        try {
            await setDoc(D('teamInvites', `${t.id}_${uid}`), { teamId: t.id, teamName: t.name, uid, byUid: myUid(), byName: myName(), at: serverTimestamp() });
            document.getElementById('team-invite-pick')?.remove();
            toast(`Invite sent to ${name}.`);
        } catch (e) { console.error(e); toast("Couldn't send the invite.", 'error'); }
    };
    if (mine.length === 1) { send(mine[0]); return; }
    window._inviteSend = (id) => send(mine.find(t => t.id === id));
    sheet('team-invite-pick', `Invite ${esc(name)} to…`, mine.map(t => `<div onclick="_inviteSend('${jsq(t.id)}')">${teamCard(t, '<i class="fa-solid fa-paper-plane text-[#00F296]"></i>')}</div>`).join(''));
};
window.answerInvite = async function (inviteId, yes) {
    const iv = T.invites.find(x => x.id === inviteId); if (!iv) return;
    try {
        if (yes) await changeTeam(iv.teamId, (members) => { if (members.some(x => x.uid === myUid())) return false; members.push(personMember(myUid(), myName())); });
        await deleteDoc(D('teamInvites', inviteId));
        toast(yes ? `Welcome to ${iv.teamName}!` : 'Invite declined.');
    } catch (e) { console.error(e); toast(String(e && e.message) === 'GONE' ? 'That team no longer exists.' : "Couldn't answer the invite.", 'error'); try { if (String(e && e.message) === 'GONE') await deleteDoc(D('teamInvites', inviteId)); } catch (er) { /* ignore */ } }
};

// ---------------------------------------------------------------- free agent
window.toggleFreeAgent = async function (on) {
    if (on && !(T.myAgent && (T.myAgent.positions || []).length)) { window.editFreeAgent(true); return; }
    try { await setDoc(D('freeAgents', myUid()), { uid: myUid(), name: myName(), avatar: myAvatar(), on: !!on, updatedAt: serverTimestamp() }, { merge: true }); loadAgents(); }
    catch (e) { toast("Couldn't save.", 'error'); }
};
window.editFreeAgent = function (turnOn) {
    const a = T.myAgent || {};
    const pos = new Set(a.positions || []);
    window._faPos = pos;
    sheet('free-agent', "I'm a free agent", `
        <div><div class="text-[10px] font-black uppercase text-white/55 mb-1.5">Positions you play</div>
            <div class="grid grid-cols-4 gap-1.5">${POSITIONS.map(x => `<button type="button" onclick="_faPos.has('${x}')?_faPos.delete('${x}'):_faPos.add('${x}'); this.className=_faPos.has('${x}')?'py-3 rounded-xl text-xs font-black bg-[#00F296] text-slate-950':'py-3 rounded-xl text-xs font-black bg-white/10'" class="py-3 rounded-xl text-xs font-black ${pos.has(x) ? 'bg-[#00F296] text-slate-950' : 'bg-white/10'}">${x}</button>`).join('')}</div></div>
        <div><div class="text-[10px] font-black uppercase text-white/55 mb-1.5">Level</div>
            <select id="fa-level" class="${INPUT}">${LEVELS.map(([k, l]) => `<option value="${k}" ${a.level === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div><div class="text-[10px] font-black uppercase text-white/55 mb-1.5">A few words for captains</div>
            <textarea id="fa-note" maxlength="160" rows="3" class="${INPUT}" placeholder="e.g. Fast winger, free Tuesdays and Thursdays">${esc(a.note || '')}</textarea></div>
        <button onclick="saveFreeAgent()" class="${BTN} w-full py-3">${turnOn || !a.on ? 'Show me to captains' : 'Save'}</button>`);
};
window.saveFreeAgent = async function () {
    const positions = POSITIONS.filter(x => window._faPos && window._faPos.has(x));
    try {
        await setDoc(D('freeAgents', myUid()), {
            uid: myUid(), name: myName(), avatar: myAvatar(), on: true, positions,
            level: document.getElementById('fa-level')?.value || 'casual',
            note: String(document.getElementById('fa-note')?.value || '').trim().slice(0, 160),
            city: (window.userProfile && window.userProfile.city) || '', updatedAt: serverTimestamp(),
        }, { merge: true });
        document.getElementById('free-agent')?.remove();
        toast('Captains can see you now.');
        loadAgents();
    } catch (e) { toast("Couldn't save.", 'error'); }
};

// ---------------------------------------------------------------- lineups
const L = { teamId: '', id: 'main', format: '', formation: '', spots: {}, pick: null };
function currentLineup(t) {
    const list = t.lineups || [];
    if (L.teamId !== t.id) {
        const first = list[0];
        const n = Math.min(11, Math.max(4, (t.members || []).length));   // a side as big as the roster (4 to 11)
        const fmt = (first && FORMATS[first.format] && first.format) || `${n}v${n}`;
        Object.assign(L, { teamId: t.id, id: (first && first.id) || 'main', format: fmt, formation: (first && first.formation) || FORMATS[fmt][0], spots: { ...((first && first.spots) || {}) }, pick: null });
    }
    return L;
}
function lineupHtml(t, boss) {
    const l = currentLineup(t);
    const spots = formationSpots(l.formation);
    const byId = new Map((t.members || []).map(m => [m.id, m]));
    const used = new Set(Object.values(l.spots));
    const bench = (t.members || []).filter(m => !used.has(m.id));
    const p = (t.colors && t.colors.primary) || '#00F296';
    const shirt = (m, i) => {
        const label = m ? (m.number || String(m.name || '?').slice(0, 2).toUpperCase()) : '+';
        const who = m ? String(m.name || '').split(' ')[0] : (i === 0 ? 'GK' : '');
        return `<button ${boss ? `onclick="lineupPick(${i})"` : ''} class="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-0.5" style="left:${spots[i].x}%;top:${spots[i].y}%">
            <span class="w-10 h-10 rounded-full flex items-center justify-center text-xs font-black border-2 ${L.pick === i ? 'border-amber-300 scale-110' : 'border-white/70'}"
                style="background:${m ? p : 'rgba(0,0,0,.45)'};color:${m ? textOn(p) : '#fff'}">${esc(label)}</span>
            <span class="text-[10px] font-bold text-white drop-shadow max-w-[64px] truncate">${esc(who)}</span></button>`;
    };
    return `<div class="space-y-3">
        ${boss ? `<div class="flex gap-2">
            <select onchange="lineupFormat(this.value)" class="${INPUT} !w-28">${Object.keys(FORMATS).map(f => `<option ${l.format === f ? 'selected' : ''}>${f}</option>`).join('')}</select>
            <select onchange="lineupFormation(this.value)" class="${INPUT}">${FORMATS[l.format].map(f => `<option ${l.formation === f ? 'selected' : ''}>${f}</option>`).join('')}</select>
        </div>` : `<div class="text-xs text-white/60 text-center">${esc(l.format)} · ${esc(l.formation)}</div>`}
        <div class="relative w-full rounded-2xl overflow-hidden border border-white/15" style="aspect-ratio:3/4;background:repeating-linear-gradient(0deg,#0f6b3a 0 10%,#11793f 10% 20%)">
            <div class="absolute inset-3 border-2 border-white/40 rounded-lg"></div>
            <div class="absolute left-3 right-3 top-1/2 border-t-2 border-white/40"></div>
            <div class="absolute left-1/2 top-1/2 w-20 h-20 -translate-x-1/2 -translate-y-1/2 border-2 border-white/40 rounded-full"></div>
            <div class="absolute left-1/2 bottom-3 w-32 h-14 -translate-x-1/2 border-2 border-b-0 border-white/40"></div>
            ${spots.map((_, i) => shirt(byId.get(l.spots[String(i)]), i)).join('')}
        </div>
        ${boss && L.pick != null ? `<div class="text-[11px] font-bold text-amber-300 text-center">Pick a player for ${L.pick === 0 ? 'goalkeeper' : 'this spot'}:</div>` : ''}
        <div class="text-[10px] font-black uppercase tracking-wider text-white/55">Subs / bench (${bench.length})</div>
        <div class="flex flex-wrap gap-1.5">${bench.map(m => `<button ${boss && L.pick != null ? `onclick="lineupSet('${jsq(m.id)}')"` : ''} class="rounded-full px-3 py-1.5 text-[11px] font-bold ${boss && L.pick != null ? 'bg-[#00F296]/20 border border-[#00F296] text-white' : 'bg-white/10 text-white/80'}">${m.number ? esc(m.number) + ' · ' : ''}${esc(m.name)}</button>`).join('') || '<span class="text-[11px] text-white/45">Everyone is on the field.</span>'}</div>
        ${boss && L.pick != null && l.spots[String(L.pick)] ? `<button onclick="lineupSet('')" class="${DARK} w-full">Move to bench</button>` : ''}
        ${boss ? `<button onclick="saveLineup()" class="${BTN} w-full py-3">Save lineup</button>` : ''}
    </div>`;
}
window.lineupFormat = (f) => { L.format = f; L.formation = FORMATS[f][0]; trimSpots(); renderTeamPage(); };
window.lineupFormation = (f) => { L.formation = f; trimSpots(); renderTeamPage(); };
function trimSpots() { const n = formationSpots(L.formation).length; Object.keys(L.spots).forEach(k => { if (+k >= n) delete L.spots[k]; }); L.pick = null; }
window.lineupPick = (i) => { L.pick = L.pick === i ? null : i; renderTeamPage(); };
window.lineupSet = (memberId) => {
    if (L.pick == null) return;
    Object.keys(L.spots).forEach(k => { if (L.spots[k] === memberId) delete L.spots[k]; });
    if (memberId) L.spots[String(L.pick)] = memberId; else delete L.spots[String(L.pick)];
    L.pick = null; renderTeamPage();
};
window.saveLineup = async function () {
    const t = T.open; if (!t) return;
    const line = { id: L.id || 'main', name: 'Main lineup', format: L.format, formation: L.formation, spots: { ...L.spots } };
    try {
        await updateDoc(D('teams', t.id), { lineups: [line, ...(t.lineups || []).filter(x => x.id !== line.id)].slice(0, 5), updatedAt: serverTimestamp() });
        toast('Lineup saved.');
    } catch (e) { console.error(e); toast("Couldn't save the lineup.", 'error'); }
};

// ---------------------------------------------------------------- start when signed in, and when the tab opens
function mountTab() {
    const tab = document.getElementById('tab-friends');
    if (tab && !document.getElementById('teams-root')) tab.innerHTML = '<div id="teams-root"></div>';
    // "Friends" becomes "Teams" in both menus.
    const relabel = (btn, isMobile) => {
        if (!btn || btn.dataset.teams) return;
        btn.dataset.teams = '1';
        const icon = btn.querySelector('i'); if (icon) icon.className = icon.className.replace('fa-user-group', 'fa-shield-halved');
        if (isMobile) { const s = btn.querySelector('span.text-\\[10px\\]') || [...btn.querySelectorAll('span')].pop(); if (s) s.textContent = 'Teams'; }
        else { [...btn.childNodes].forEach(n => { if (n.nodeType === 3 && /Friends/.test(n.textContent)) n.textContent = ' Teams '; }); }
    };
    relabel(document.getElementById('nav-btn-friends'), false);
    relabel(document.getElementById('mob-nav-friends'), true);
}
window.addEventListener('DOMContentLoaded', mountTab);
setTimeout(mountTab, 0);
let started = '';
setInterval(() => {
    const uid = myUid();
    if (uid && started !== uid) { started = uid; mountTab(); startTeams(); renderTeamsTab(); setTimeout(countRequests, 3000); }
    if (!uid && started) { started = ''; stopAll(); T.mine = []; T.invites = []; }
}, 1000);
// The old Friends list draws into the same tab: draw Teams instead.
window.renderFriends = function () { mountTab(); renderTeamsTab(); };
// Opening the tab draws it (switchTab is made by the page after this file loads).
function wrapSwitch() {
    const orig = window.switchTab;
    if (typeof orig !== 'function' || orig._teams) return;
    const w = function (name) { const r = orig.apply(this, arguments); if (name === 'friends') { mountTab(); renderTeamsTab(); } return r; };
    w._teams = true; window.switchTab = w;
}
window.addEventListener('DOMContentLoaded', () => setTimeout(wrapSwitch, 0));
setTimeout(wrapSwitch, 500); setTimeout(wrapSwitch, 2000);
