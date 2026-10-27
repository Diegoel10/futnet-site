// js/analytics.js: Community analytics for admins.
//   - Views: who opened each community game, the community page, and each feed post.
//     artifacts/{appId}/communities/{cid}/views/{kind}_{targetId}_{uid} =
//       { kind: 'game'|'community'|'post', targetId, title, uid, name, count (+1 per visit), days: ['YYYY-MM-DD'], lastAt }
//     One visit per person per 30 minutes. Admins' own views aren't counted (we want the members').
//   - Attendance: from the community's played games (attendees, late / no-show marks) and late cancels
//     (artifacts/{appId}/cancellations, written by the server when someone cancels < 2 hours before).
import { db, appId } from './firebase-config.js';
import {
    doc, collection, setDoc, getDocs, onSnapshot, query, where, increment, arrayUnion, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { escapeHtml as esc, jsArg } from './game-profile/event-store.js';
import { startMsOf } from './money-rules.js';

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const tsMs = (t) => (t && typeof t.toMillis === 'function') ? t.toMillis() : (Number(t) || 0);
const VISIT_MS = 30 * 60 * 1000;
const isAdminOf = (cid) => (window.myCommunityRoles || {})[cid] === 'admin';

// ------------------------------------------------------------------ recording a view
export function recordView(cid, kind, targetId, title) {
    const u = window.currentUser;
    if (!cid || !targetId || !u || !u.uid || isAdminOf(cid)) return;
    const key = `futnet_view_${kind}_${targetId}`;
    try {
        const last = Number(sessionStorage.getItem(key)) || 0;
        if (Date.now() - last < VISIT_MS) return;
        sessionStorage.setItem(key, String(Date.now()));
    } catch (e) { /* private mode: still count */ }
    const p = window.userProfile || {};
    const name = p.name || `${p.firstName || ''} ${p.lastName || ''}`.trim() || u.displayName || 'Player';
    setDoc(doc(db, 'artifacts', appId, 'communities', cid, 'views', `${kind}_${targetId}_${u.uid}`), {
        kind, targetId: String(targetId), title: String(title || '').slice(0, 80), uid: String(u.uid), name,
        count: increment(1), days: arrayUnion(ymd(new Date())), lastAt: serverTimestamp()
    }, { merge: true }).catch(e => console.warn('view', e));
}
window.recordCommunityView = recordView;

// Feed posts: counted when at least half of the post stays on screen for a moment.
let postObserver = null;
const postTimers = new Map();
function watchPosts() {
    if (!('IntersectionObserver' in window)) return;
    postObserver = new IntersectionObserver((entries) => {
        entries.forEach(en => {
            const el = en.target;
            const id = el.dataset.viewPost;
            if (en.isIntersecting && en.intersectionRatio >= 0.5) {
                if (!postTimers.has(el)) postTimers.set(el, setTimeout(() => {
                    postTimers.delete(el);
                    recordView(el.dataset.viewCid, 'post', id, el.dataset.viewTitle || '');
                }, 800));
            } else if (postTimers.has(el)) { clearTimeout(postTimers.get(el)); postTimers.delete(el); }
        });
    }, { threshold: [0, 0.5] });
    const scan = (root) => root.querySelectorAll?.('[data-view-post]').forEach(el => { if (!el._viewWatched) { el._viewWatched = true; postObserver.observe(el); } });
    scan(document);
    new MutationObserver(list => list.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType === 1) { if (n.dataset?.viewPost) scan(n.parentElement || n); else scan(n); } })))
        .observe(document.body, { childList: true, subtree: true });
}
if (document.body) watchPosts(); else document.addEventListener('DOMContentLoaded', watchPosts);

// ------------------------------------------------------------------ the math (pure, so it can be tested)
/**
 * Attendance per player from the community's played games and late cancels.
 * Returns [{ uid, name, signed, showed, late, noShow, lateCancels, missed, pct, lastDay }].
 */
export function attendanceStats(events, cancels, now, sinceDay = '') {
    const by = {};
    const get = (uid, name) => (by[uid] = by[uid] || { uid, name: name || 'Player', signed: 0, showed: 0, late: 0, noShow: 0, lateCancels: 0, lastDay: '' });
    (events || []).forEach(ev => {
        const start = startMsOf(ev);
        const played = ev.isSessionEnded || (start && start <= now);
        const day = String(ev.date || '').slice(0, 10);
        if (!played || !day || day < sinceDay) return;
        (ev.attendees || []).forEach(a => {
            const uid = String(a.uid || a.id || '');
            if (!uid || (a.status && a.status !== 'confirmed')) return;
            const r = get(uid, a.name);
            if (a.name) r.name = a.name;
            r.signed++;
            if (a.attendance === 'noshow') r.noShow++;
            else { r.showed++; if (a.attendance === 'late') r.late++; if (day > r.lastDay) r.lastDay = day; }
        });
    });
    const names = {};
    (events || []).forEach(ev => [...(ev.attendees || []), ...(ev.declinedList || [])].forEach(a => { if (a && a.uid && a.name) names[a.uid] = a.name; }));
    (cancels || []).forEach(c => {
        if (!c || !c.uid || String(c.date || '') < sinceDay) return;
        get(String(c.uid), names[c.uid]).lateCancels++;
    });
    return Object.values(by).map(r => ({ ...r, name: names[r.uid] || r.name, missed: r.noShow + r.lateCancels, pct: r.signed ? Math.round(r.showed / r.signed * 100) : 0 }));
}

/** Views grouped by what was viewed: { [targetId]: { title, people, visits, list: [view docs, newest first] } }. */
export function groupViews(views, kind) {
    const out = {};
    (views || []).filter(v => v && v.kind === kind).forEach(v => {
        const g = (out[v.targetId] = out[v.targetId] || { targetId: v.targetId, title: v.title || '', people: 0, visits: 0, list: [] });
        if (v.title) g.title = v.title;
        g.people++; g.visits += Number(v.count) || 0; g.list.push(v);
    });
    Object.values(out).forEach(g => g.list.sort((a, b) => tsMs(b.lastAt) - tsMs(a.lastAt)));
    return out;
}

// ------------------------------------------------------------------ the screen (admins)
const A = { cid: null, name: '', tab: 'attendance', range: '90', views: [], cancels: [], open: null, unsub: null, loading: true };

window.openAnalytics = async function (cid) {
    const c = (window.communitiesCache || {})[cid] || {};
    A.cid = cid; A.name = c.name || 'Community'; A.loading = true; A.open = null;
    let m = document.getElementById('analytics-modal');
    if (!m) { m = document.createElement('div'); m.id = 'analytics-modal'; m.className = 'fixed inset-0 z-[200] bg-[#03080F] overflow-y-auto'; document.body.appendChild(m); }
    draw();
    if (A.unsub) { try { A.unsub(); } catch (e) {} }
    A.unsub = onSnapshot(collection(db, 'artifacts', appId, 'communities', cid, 'views'), s => { A.views = s.docs.map(d => d.data()); A.loading = false; draw(); },
        (e) => { console.warn('views', e); A.loading = false; draw(); });
    try {
        const s = await getDocs(query(collection(db, 'artifacts', appId, 'cancellations'), where('communityId', '==', cid)));
        A.cancels = s.docs.map(d => d.data());
    } catch (e) { console.warn('cancellations', e); A.cancels = []; }
    draw();
};
window.closeAnalytics = function () { if (A.unsub) { try { A.unsub(); } catch (e) {} A.unsub = null; } document.getElementById('analytics-modal')?.remove(); };
window.setAnalyticsTab = function (t) { A.tab = t; A.open = null; draw(); document.getElementById('analytics-modal')?.scrollTo(0, 0); };
window.setAnalyticsRange = function (r) { A.range = r; draw(); };
window.toggleAnalyticsItem = function (id) { A.open = A.open === id ? null : id; draw(); };

const ago = (ms) => {
    if (!ms) return '';
    const m = Math.round((Date.now() - ms) / 60000);
    if (m < 1) return 'just now'; if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60); if (h < 24) return `${h} h ago`;
    const d = Math.round(h / 24); if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`;
    return new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' });
};
function avatar(uid, name) {
    const src = window.resolvePlayerAvatar ? window.resolvePlayerAvatar({ uid, name }) : '';
    return src ? `<img src="${esc(src)}" class="w-8 h-8 rounded-full object-cover shrink-0" onerror="this.style.display='none'">`
        : `<div class="w-8 h-8 rounded-full bg-emerald-500/30 text-white text-xs font-black flex items-center justify-center shrink-0">${esc(String(name || '?').trim().charAt(0).toUpperCase())}</div>`;
}
function viewerRows(list, extra = () => '') {
    return list.map(v => `<div class="flex items-center gap-2.5 bg-black/30 rounded-lg px-2.5 py-1.5">
        ${avatar(v.uid, v.name)}<div class="flex-1 min-w-0"><div class="text-xs font-bold truncate">${esc(v.name || 'Player')}${extra(v)}</div>
        <div class="text-[10px] text-white/50">${Number(v.count) || 1} visit${Number(v.count) === 1 ? '' : 's'} · last ${ago(tsMs(v.lastAt))}</div></div></div>`).join('');
}
const sinceDay = () => A.range === 'all' ? '' : ymd(new Date(Date.now() - Number(A.range) * 86400000));

function draw() {
    const m = document.getElementById('analytics-modal');
    if (!m) return;
    const keep = m.scrollTop;
    const tabs = [['attendance', '✅ Attendance'], ['games', '⚽ Games'], ['page', '🏠 Community page'], ['posts', '📰 Posts']];
    const body = { attendance: attendanceHtml, games: gamesHtml, page: pageHtml, posts: postsHtml }[A.tab] || attendanceHtml;
    m.innerHTML = `<div class="max-w-2xl mx-auto px-4 pt-4 pb-24 text-white space-y-4">
        <div class="flex items-center gap-3">
            <button onclick="closeAnalytics()" class="w-9 h-9 rounded-full bg-black/60 border border-white/15 flex items-center justify-center"><i class="fa-solid fa-arrow-left"></i></button>
            <div class="flex-1 min-w-0"><div class="text-[10px] font-black uppercase tracking-wider text-[#00F296]">📈 Analytics</div><div class="text-sm font-black truncate">${esc(A.name)}</div></div>
        </div>
        <div class="flex gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1 pb-1">${tabs.map(([k, l]) => `
            <button onclick="setAnalyticsTab('${k}')" class="shrink-0 px-3 py-2 rounded-xl text-[11px] font-black ${A.tab === k ? 'bg-[#00F296] text-slate-950' : 'bg-black/50 border border-white/15 text-white/80'}">${l}</button>`).join('')}</div>
        ${A.loading ? '<div class="text-xs text-white/50 text-center py-2"><i class="fa-solid fa-spinner fa-spin mr-1"></i> Loading…</div>' : ''}
        ${body()}
        <p class="text-[10px] text-white/35 text-center pt-2">Only admins see this. Views are counted from the website now; the apps start counting after their next update. Admins' own views aren't counted.</p>
    </div>`;
    m.scrollTop = keep;
}

function attendanceHtml() {
    const events = (window.eventsList || []).filter(e => e.communityId === A.cid);
    const stats = attendanceStats(events, A.cancels, Date.now(), sinceDay());
    const top = [...stats].filter(s => s.showed > 0).sort((a, b) => b.showed - a.showed || b.pct - a.pct).slice(0, 15);
    const miss = [...stats].filter(s => s.missed > 0).sort((a, b) => b.missed - a.missed || a.pct - b.pct).slice(0, 15);
    const games = events.filter(ev => { const s = startMsOf(ev); return (ev.isSessionEnded || (s && s <= Date.now())) && String(ev.date || '').slice(0, 10) >= sinceDay(); }).length;
    const row = (s, right) => `<div class="flex items-center gap-2.5 bg-black/40 border border-white/10 rounded-xl px-2.5 py-2">
        ${avatar(s.uid, s.name)}<div class="flex-1 min-w-0"><div class="text-xs font-bold truncate">${esc(s.name)}</div>
        <div class="text-[10px] text-white/50">Came ${s.showed} of ${s.signed}${s.late ? ` · ${s.late} late` : ''}${s.noShow ? ` · ${s.noShow} no-show` : ''}${s.lateCancels ? ` · ${s.lateCancels} late cancel` : ''}${s.lastDay ? ` · last ${esc(s.lastDay)}` : ''}</div></div>${right}</div>`;
    return `<select onchange="setAnalyticsRange(this.value)" class="w-full bg-black/60 border border-teal-500/50 rounded-xl px-3 py-2.5 text-white text-base sm:text-sm font-bold">
        ${[['30', 'Last 30 days'], ['90', 'Last 90 days'], ['365', 'Last 12 months'], ['all', 'All time']].map(([k, l]) => `<option value="${k}" ${A.range === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <div class="text-[11px] text-white/60 text-center">${games} game${games === 1 ? '' : 's'} played</div>
    <div class="text-[10px] font-black uppercase tracking-wider text-[#00F296]">🏅 Comes the most</div>
    <div class="space-y-2">${top.map(s => row(s, `<b class="text-sm text-[#00F296] shrink-0">${s.showed}</b>`)).join('') || '<p class="text-xs text-white/45 italic">No games played in this time.</p>'}</div>
    <div class="text-[10px] font-black uppercase tracking-wider text-[#FF8080] pt-2">🚩 Keeps missing</div>
    <p class="text-[10px] text-white/50">No-shows (signed up, didn't come; mark them in the game's Admin tab) and late cancels (cancelled less than 2 hours before).</p>
    <div class="space-y-2">${miss.map(s => row(s, `<b class="text-sm text-[#FF8080] shrink-0">${s.missed}</b>`)).join('') || '<p class="text-xs text-white/45 italic">Nobody missed a game. 🎉</p>'}</div>`;
}

function gamesHtml() {
    const g = groupViews(A.views, 'game');
    const events = (window.eventsList || []).filter(e => e.communityId === A.cid)
        .sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).slice(0, 40);
    return `<p class="text-[10px] text-white/50">Who opened each game. "Looked but didn't join" helps you see who's interested.</p>
    <div class="space-y-2">${events.map(ev => {
        const v = g[ev.id] || { people: 0, visits: 0, list: [] };
        const going = new Set((ev.attendees || []).map(a => String(a.uid || '')));
        const notJoined = v.list.filter(x => !going.has(String(x.uid))).length;
        const open = A.open === ev.id;
        return `<div class="bg-black/40 border border-white/10 rounded-xl p-2.5">
            <button onclick="toggleAnalyticsItem('${jsArg(ev.id)}')" class="w-full flex items-center gap-2 text-left">
                <div class="flex-1 min-w-0"><div class="text-xs font-bold truncate">${esc(ev.title || 'Game')}</div>
                    <div class="text-[10px] text-white/50">${esc(String(ev.date || '').slice(0, 10))} · ${going.size} going${notJoined ? ` · <span class="text-amber-300">${notJoined} looked but didn't join</span>` : ''}</div></div>
                <span class="text-sm font-black shrink-0">👁️ ${v.people}</span><i class="fa-solid fa-chevron-${open ? 'up' : 'down'} text-white/40 text-xs"></i></button>
            ${open ? `<div class="space-y-1.5 mt-2">${viewerRows(v.list, (x) => going.has(String(x.uid)) ? ' <span class="text-[9px] text-[#00F296]">going</span>' : '') || '<p class="text-[11px] text-white/45">No views yet.</p>'}</div>` : ''}
        </div>`;
    }).join('') || '<p class="text-xs text-white/45 italic">No games yet.</p>'}</div>`;
}

function pageHtml() {
    const v = groupViews(A.views, 'community')[A.cid] || { people: 0, visits: 0, list: [] };
    const week = v.list.filter(x => Date.now() - tsMs(x.lastAt) < 7 * 86400000).length;
    return `<div class="grid grid-cols-3 gap-2">${[['People', v.people], ['Visits', v.visits], ['This week', week]].map(([l, n]) => `
        <div class="bg-black/40 border border-white/10 rounded-2xl p-3 text-center"><div class="text-[10px] font-black uppercase text-white/50">${l}</div><div class="text-xl font-black mt-1">${n}</div></div>`).join('')}</div>
    <div class="space-y-1.5">${viewerRows(v.list) || '<p class="text-xs text-white/45 italic">No visits yet.</p>'}</div>`;
}

function postsHtml() {
    const g = Object.values(groupViews(A.views, 'post')).sort((a, b) => tsMs(b.list[0]?.lastAt) - tsMs(a.list[0]?.lastAt));
    return `<p class="text-[10px] text-white/50">A post counts as seen when it stays on someone's screen for a moment.</p>
    <div class="space-y-2">${g.map(p => {
        const open = A.open === p.targetId;
        return `<div class="bg-black/40 border border-white/10 rounded-xl p-2.5">
            <button onclick="toggleAnalyticsItem('${jsArg(p.targetId)}')" class="w-full flex items-center gap-2 text-left">
                <div class="flex-1 min-w-0"><div class="text-xs font-bold truncate">${esc(p.title || 'Post')}</div>
                    <div class="text-[10px] text-white/50">${p.visits} view${p.visits === 1 ? '' : 's'} · last ${ago(tsMs(p.list[0]?.lastAt))}</div></div>
                <span class="text-sm font-black shrink-0">👁️ ${p.people}</span><i class="fa-solid fa-chevron-${open ? 'up' : 'down'} text-white/40 text-xs"></i></button>
            ${open ? `<div class="space-y-1.5 mt-2">${viewerRows(p.list)}</div>` : ''}
        </div>`;
    }).join('') || '<p class="text-xs text-white/45 italic">No post views yet.</p>'}</div>`;
}
