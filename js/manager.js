// js/manager.js: futnet.site/manager, the owner's control room. Only the owner accounts get in:
// the page checks the email fingerprint, and every action is checked again on the server (manager function).
import { auth, app } from './firebase-config.js';
import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, OAuthProvider, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js";

const OWNER_EMAIL_SHA256 = ['0cc4e2724ff40ad5f2b24d4a43d906996652b2d33d242c17c1efb4b7ff90d67b', 'dc33de30406203e7cdf8490b5ef4b5c7f993bdb2989bc3025bc5e4dd6b129378', '903a1d99aac1826f6f04f45b8b6e56911ea4cbfb8a85a4c09631906a726de23a'];
const callManager = httpsCallable(getFunctions(app, 'us-central1'), 'manager', { timeout: 300000 });
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const jsq = (v) => String(v ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const money = (c) => `${c < 0 ? '-' : ''}$${(Math.abs(+c || 0) / 100).toFixed(2)}`;
const dt = (ms) => ms ? new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '';
const AV = 'https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg';
const $ = (id) => document.getElementById(id);
const val = (id) => String($(id)?.value || '').trim();
const BADGE = (c) => `<svg viewBox="0 0 24 24" width="15" height="15" style="display:inline;vertical-align:-2px"><path fill="${c}" d="M12 1.5l2.6 1.9 3.2-.2 1 3 2.6 1.9-1 3.1 1 3.1-2.6 1.9-1 3-3.2-.2L12 22.5l-2.6-1.9-3.2.2-1-3-2.6-1.9 1-3.1-1-3.1 2.6-1.9 1-3 3.2.2z"/><path fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="M7.5 12.3l3 3 6-6.2"/></svg>`;
const BLUE = BADGE('#1D9BF0'), GOLD = BADGE('#E6B800');

const S = { tab: 'home', hello: null, busy: false };
async function sha256(t) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }
function toast(msg, bad) {
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = `position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:999;padding:10px 16px;border-radius:12px;font-weight:800;font-size:13px;max-width:90vw;background:${bad ? '#7f1d1d' : '#064e3b'};color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.5)`;
    document.body.appendChild(t); setTimeout(() => t.remove(), 4200);
}
async function call(action, data = {}) {
    try { return (await callManager({ action, ...data })).data; }
    catch (e) { toast(String(e.message || e).replace(/^.*?:\s*/, ''), true); throw e; }
}
const errMsg = (e) => String((e && e.message) || e).replace(/^.*?:\s*/, '');

// ---------------------------------------------------------------- sign in
function signInScreen(msg) {
    $('app').innerHTML = `<div class="card text-center space-y-4 mt-16">
        <img src="img/FutnetJustLogo.png" class="w-16 h-16 mx-auto" onerror="this.remove()">
        <div class="text-xl font-black">FutNet Manager</div>
        ${msg ? `<p class="text-sm text-red-300">${esc(msg)}</p>` : '<p class="text-sm text-white/60">Owner access only.</p>'}
        <button onclick="mgrSignIn('apple')" class="btn-dark w-full py-3"><i class="fa-brands fa-apple mr-2"></i>Sign in with Apple</button>
        <button onclick="mgrSignIn('google')" class="btn-dark w-full py-3"><i class="fa-brands fa-google mr-2"></i>Sign in with Google</button>
    </div>`;
}
window.mgrSignIn = async (kind) => {
    try { await signInWithPopup(auth, kind === 'apple' ? new OAuthProvider('apple.com') : new GoogleAuthProvider()); }
    catch (e) { toast(errMsg(e), true); }
};
window.mgrSignOut = () => signOut(auth);
onAuthStateChanged(auth, async (u) => {
    if (!u) return signInScreen();
    const ok = OWNER_EMAIL_SHA256.includes(await sha256(String(u.email || '').trim().toLowerCase()));
    if (!ok) return signInScreen("This account doesn't have access. Sign in with the owner's Apple or Google account.");
    try { S.hello = await call('hello'); draw(); }
    catch (e) { signInScreen(errMsg(e)); }
});

// ---------------------------------------------------------------- layout
const TABS = [['home', '🏠 Home'], ['players', '🔎 Players'], ['verify', '✔️ Verified'], ['messages', '💬 Admin messages'], ['analytics', '📈 Analytics'], ['money', '💰 Money'], ['settings', '⚙️ Settings']];
window.mgrTab = (k) => { S.tab = k; draw(); };
function draw() {
    $('app').innerHTML = `
        <div class="flex items-center justify-between">
            <div class="flex items-center gap-2"><img src="img/FutnetJustLogo.png" class="w-8 h-8" onerror="this.remove()"><div><div class="text-lg font-black leading-tight">FutNet Manager</div><div class="text-[11px] text-white/50">${esc(auth.currentUser.email || '')}</div></div></div>
            <div class="flex gap-2"><a href="/" class="btn-dark">Open app</a><button onclick="mgrSignOut()" class="btn-dark">Sign out</button></div>
        </div>
        <div class="flex gap-1 overflow-x-auto bg-black/40 border border-white/10 rounded-2xl p-1">${TABS.map(([k, l]) => `<button onclick="mgrTab('${k}')" class="tab ${S.tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        <div id="body" class="space-y-4"></div>`;
    ({ home, players, verify, messages, analytics, money: moneyTab, settings })[S.tab]();
}
const body = (html) => { $('body').innerHTML = html; };
const loading = () => body('<div class="text-center text-white/60 text-sm py-10"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Loading…</div>');

// ---------------------------------------------------------------- home
function home() {
    const h = S.hello || {};
    const tile = (n, l, tab, icon = '') => `<button onclick="mgrTab('${tab}')" class="card text-left"><div class="text-2xl font-black">${esc(n)} ${icon}</div><div class="text-[11px] text-white/60">${l}</div></button>`;
    body(`<div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
            ${tile(h.players ?? '-', 'Players', 'players')}${tile(h.games ?? '-', 'Games (all time)', 'analytics')}
            ${tile(h.communities ?? '-', 'Communities', 'home')}${tile(h.vsMatches ?? '-', 'VS matches', 'home')}
            ${tile(h.tournaments ?? '-', 'Tournaments', 'home')}${tile(h.blue ?? '-', 'Blue verified', 'verify', BLUE)}${tile(h.gold ?? '-', 'Gold verified', 'verify', GOLD)}
        </div>
        <div class="card text-sm text-white/75 space-y-1">
            <div class="font-black text-white">What's here</div>
            <div>🔎 <b>Players</b>: find anyone, see their account, fix their name, verify, merge duplicates, delete.</div>
            <div>✔️ <b>Verified</b>: everyone with a check, and when the blue ones run out.</div>
            <div>💬 <b>Admin messages</b>: the FutNet Admin chats and reports. Answer as FutNet Admin.</div>
            <div>📈 <b>Analytics</b>: what people tap the most.</div>
            <div>💰 <b>Money</b>: FutNet's own income and costs (Apple, Google, Claude, hosting...).</div>
        </div>`);
}

// ---------------------------------------------------------------- players (everyone, filters as you type)
const initials = (n) => String(n || '?').split(' ').map(w => w[0] || '').join('').slice(0, 2).toUpperCase();
const pic = (p, size = 40) => p.avatar ? `<img src="${esc(p.avatar)}" onerror="this.outerHTML='<div class=&quot;rounded-full bg-white/10 flex items-center justify-center font-black text-white/70&quot; style=&quot;width:${size}px;height:${size}px;font-size:${Math.round(size / 2.6)}px&quot;>${esc(initials(p.name))}</div>'" class="rounded-full object-cover shrink-0" style="width:${size}px;height:${size}px">`
    : `<div class="rounded-full bg-white/10 flex items-center justify-center font-black text-white/70 shrink-0" style="width:${size}px;height:${size}px;font-size:${Math.round(size / 2.6)}px">${esc(initials(p.name))}</div>`;
function players() {
    body(`<div class="card space-y-3">
            <div class="lbl">Players <span id="pl-count" class="text-white/40"></span></div>
            <input id="q" class="inp" placeholder="Start typing a name, nickname or user id…" oninput="mgrFilter()" onkeydown="if(event.key==='Enter')mgrSearch()" autocomplete="off">
            <div class="flex flex-wrap gap-1.5 text-[11px]">
                ${[['all', 'Everyone'], ['blue', 'Blue ✓'], ['gold', 'Gold ✓'], ['none', 'Not verified'], ['dupes', 'Same name (duplicates?)'], ['hidden', 'Deleted / merged']].map(([k, l]) => `<button onclick="mgrPlFilter('${k}')" class="${(S.plf || 'all') === k ? 'btn' : 'btn-dark'} !py-1 !px-2.5 text-[11px]">${l}</button>`).join('')}
            </div>
            <p class="text-[11px] text-white/45">Press Enter (or Search) to also see emails and sign-in type, to tell duplicate accounts apart.</p>
            <button onclick="mgrSearch()" class="btn-dark !py-1.5 text-[12px]">Search with emails</button>
        </div><div id="results" class="space-y-2"><div class="text-white/60 text-sm"><i class="fa-solid fa-spinner fa-spin mr-1"></i>Loading players…</div></div>`);
    setTimeout(() => $('q')?.focus(), 50);
    if (S.all) mgrFilter();
    else call('list').then(r => { S.all = r.list; mgrFilter(); }).catch(() => { $('results').innerHTML = ''; });
}
window.mgrPlFilter = (k) => { S.plf = k; players(); };
window.mgrFilter = () => {
    const all = S.all || []; if (!$('results')) return;
    const q = val('q').toLowerCase(), f = S.plf || 'all';
    const counts = {}; all.forEach(p => { const k = p.name.toLowerCase(); counts[k] = (counts[k] || 0) + 1; });
    let list = all.filter(p => f === 'hidden' ? p.hidden : !p.hidden)
        .filter(p => f === 'blue' ? p.badge === 'blue' : f === 'gold' ? p.badge === 'gold' : f === 'none' ? !p.badge : f === 'dupes' ? counts[p.name.toLowerCase()] > 1 : true)
        .filter(p => !q || p.name.toLowerCase().includes(q) || p.nickname.toLowerCase().includes(q) || p.uid.toLowerCase() === q);
    if (q) list.sort((a, b) => (b.name.toLowerCase().startsWith(q) ? 1 : 0) - (a.name.toLowerCase().startsWith(q) ? 1 : 0));
    $('pl-count').textContent = `(${list.length}${list.length !== all.length ? ' of ' + all.length : ''})`;
    $('results').innerHTML = list.slice(0, 150).map(p => `<button onclick="mgrPlayer('${jsq(p.uid)}')" class="card !py-2.5 w-full text-left flex items-center gap-3 ${p.hidden ? 'opacity-50' : ''}">
        ${pic(p)}
        <div class="flex-1 min-w-0"><div class="font-black truncate">${esc(p.name)} ${p.badge === 'gold' ? GOLD : p.badge === 'blue' ? BLUE : ''}${counts[p.name.toLowerCase()] > 1 ? ' <span class="text-[10px] text-amber-300">×' + counts[p.name.toLowerCase()] + '</span>' : ''}</div>
            <div class="text-[11px] text-white/45 truncate">${p.nickname ? '"' + esc(p.nickname) + '" · ' : ''}${esc(p.uid)}</div></div>
        <i class="fa-solid fa-chevron-right text-white/40"></i></button>`).join('') + (list.length > 150 ? `<p class="text-[11px] text-white/45 text-center">Showing 150 of ${list.length}. Keep typing to narrow it down.</p>` : '') || '<p class="text-sm text-white/50">Nobody matches.</p>';
};
window.mgrSearch = async () => {
    const q = val('q'); if (q.length < 2) return toast('Type at least 2 letters.', true);
    $('results').innerHTML = '<div class="text-white/60 text-sm"><i class="fa-solid fa-spinner fa-spin mr-1"></i>Searching with emails…</div>';
    const r = await call('search', { q }).catch(() => ({ list: [] }));
    $('results').innerHTML = r.list.map(p => `<button onclick="mgrPlayer('${jsq(p.uid)}')" class="card w-full text-left flex items-center gap-3 ${p.hidden ? 'opacity-50' : ''}">
        ${pic(p)}
        <div class="flex-1 min-w-0"><div class="font-black truncate">${esc(p.name || '(no name)')} ${p.verification && p.verification.gold ? GOLD : p.verification && p.verification.blue ? BLUE : ''} ${p.hidden ? '<span class="text-[10px] text-red-300">HIDDEN</span>' : ''}</div>
            <div class="text-[11px] text-white/55 truncate">${esc(p.auth && p.auth.email || 'no email')} · ${esc((p.auth && p.auth.providers || []).join(', ').replace('.com', ''))} · ${esc(p.uid)}</div></div>
        <i class="fa-solid fa-chevron-right text-white/40"></i></button>`).join('') || '<p class="text-sm text-white/50">Nobody found.</p>';
};
window.mgrPlayer = async (uid) => {
    S.tab = 'players'; loading();
    const [p, g] = await Promise.all([call('player', { uid }).catch(() => null), S.gate ? Promise.resolve(S.gate) : call('gate').catch(() => null)]);
    if (g) S.gate = g;
    if (!p) return players();
    S.player = p;
    const a = p.activity, v = p.verification || {}, au = p.auth || {};
    const blueOn = v.blue && Math.max(+v.blue.at || 0, +v.lastRealGameAt || 0) + 60 * 86400000 > Date.now();
    const blueUntil = v.blue ? Math.max(+v.blue.at || 0, +v.lastRealGameAt || 0) + 60 * 86400000 : 0;
    body(`<button onclick="mgrTab('players')" class="btn-dark"><i class="fa-solid fa-chevron-left mr-1"></i>Back</button>
        <div class="card flex items-center gap-3">
            ${pic({ avatar: p.card.avatar, name: p.card.name }, 64)}
            <div class="min-w-0 flex-1"><div class="text-lg font-black">${esc(p.card.name || '(no name)')} ${v.gold ? GOLD : blueOn ? BLUE : ''}</div>
                <div class="text-[11px] text-white/55">${esc(au.email || 'no email')} · ${esc((au.providers || []).join(', '))}${au.disabled ? ' · <b class="text-red-300">CAN\'T SIGN IN</b>' : ''}</div>
                <div class="text-[11px] text-white/45">Joined ${esc(au.created || '?')} · last sign-in ${esc(au.lastSignIn || '?')}</div>
                <div class="text-[10px] text-white/35">${esc(p.uid)}</div></div>
        </div>
        ${p.card.deleted || p.card.mergedInto ? `<div class="card border-red-500/50 text-sm text-red-200">${p.card.mergedInto ? `Merged into another account (${esc(p.card.mergedInto)}).` : `Deleted on ${dt(p.card.deletedAt)}.`} <button onclick="mgrRestore('${jsq(p.uid)}')" class="btn-dark ml-2">Restore</button>${p.card.deleted ? ` <button onclick="mgrPurge('${jsq(p.uid)}','${jsq(p.card.name || '')}')" class="btn-red ml-2">Delete forever</button>` : ''}</div>` : ''}
        <div class="card space-y-2 text-sm">
            <div class="lbl">Activity</div>
            <div class="grid grid-cols-3 gap-2 text-center">
                <div><div class="text-xl font-black">${a.played}</div><div class="text-[10px] text-white/55">games played</div></div>
                <div><div class="text-xl font-black">${a.upcoming}</div><div class="text-[10px] text-white/55">signed up (upcoming)</div></div>
                <div><div class="text-xl font-black">${a.organized}</div><div class="text-[10px] text-white/55">games organized</div></div>
            </div>
            <div class="text-[12px] text-white/70">Last played: ${esc(a.lastPlayed || 'never')} · Credit: ${money(a.creditCents)}</div>
            <div class="text-[12px] text-white/70">Communities: ${a.communities.map(c => `${esc(c.name)} (${esc(c.role)})`).join(', ') || 'none'}</div>
            <div class="text-[12px] text-white/70">Teams: ${a.teams.map(t => esc(t.name) + (t.owner ? ' (owner)' : '')).join(', ') || 'none'}</div>
        </div>
        <div class="card space-y-3">
            <div class="lbl">Verification</div>
            <div class="flex items-center justify-between gap-2">
                <div class="text-sm">${BLUE} <b>Blue</b>: real person ${v.blue ? `<span class="text-[11px] ${blueOn ? 'text-[#00F296]' : 'text-amber-300'}">· ${blueOn ? 'active until' : 'ran out'} ${dt(blueUntil)}</span>` : ''}</div>
                ${v.blue ? `<button onclick="mgrVerify('${jsq(p.uid)}','blue',false)" class="btn-dark">Remove</button>` : ''}
                <button onclick="mgrVerify('${jsq(p.uid)}','blue',true)" class="btn">${v.blue ? 'Renew' : 'Give blue'}</button>
            </div>
            <p class="text-[11px] text-white/45">Blue stays while they play a game with a real organizer at least once every 60 days (Settings has the organizer list).</p>
            <div class="border-t border-white/10 pt-3 space-y-2">
                <div class="text-sm">${GOLD} <b>Gold</b>: name and age checked ${v.gold ? `<span class="text-[11px] text-amber-200">· ${esc(v.gold.name)}, born ${esc(v.gold.dob)}</span>` : ''}</div>
                ${v.gold ? `<button onclick="mgrVerify('${jsq(p.uid)}','gold',false)" class="btn-dark">Remove gold (unlocks name)</button>` : `
                <div class="grid grid-cols-2 gap-2"><div><div class="lbl">Name on their ID</div><input id="g-name" class="inp" value="${esc(`${p.profile.firstName} ${p.profile.lastName}`.trim() || p.card.name || '')}"></div>
                <div><div class="lbl">Birthday</div><input id="g-dob" type="date" class="inp" value="${esc(p.profile.dob || '')}"></div></div>
                <button onclick="mgrGold('${jsq(p.uid)}')" class="btn w-full">Give gold (locks name + birthday)</button>`}
            </div>
        </div>
        <div class="card flex items-center justify-between gap-3">
            <div><div class="font-black text-sm">🧪 Can create games and matches</div><div class="text-[11px] text-white/55">Only matters while beta mode is ON (Settings).</div></div>
            ${(S.gate && S.gate.creators || []).includes(p.uid) ? `<button onclick="mgrGateAllow('${jsq(p.uid)}', false)" class="btn-dark shrink-0">Approved ✓ · Remove</button>` : `<button onclick="mgrGateAllow('${jsq(p.uid)}', true)" class="btn shrink-0">Allow to create</button>`}
        </div>
        <div class="card space-y-2">
            <div class="lbl">Troubleshoot</div>
            <div class="text-[12px] text-white/70">Profile: ${esc(p.profile.firstName)} ${esc(p.profile.lastName)} · nickname "${esc(p.profile.nickname)}" · ${esc(p.profile.position)} · born ${esc(p.profile.dob || '?')}</div>
            <div class="flex flex-wrap gap-2">
                <button onclick="mgrFixName('${jsq(p.uid)}')" class="btn-dark">Fix "Player" name (copy from profile)</button>
                <a href="/#" onclick="navigator.clipboard.writeText('${jsq(p.uid)}');return false" class="btn-dark">Copy user id</a>
            </div>
            ${a.upcomingList.length ? `<div class="text-[12px] text-white/70">Upcoming: ${a.upcomingList.map(g => `${esc(g.title)} (${esc(g.date)})`).join(', ')}</div>` : ''}
        </div>
        <div class="card space-y-2">
            <div class="lbl">Duplicate account? Merge</div>
            <p class="text-[11px] text-white/55">Moves THIS account's games, communities, credit, teams and VS goals into the other account, then hides this one (it can't sign in any more). You'll see what moves before anything changes.</p>
            <div class="flex gap-2"><input id="m-keep" class="inp" placeholder="User id of the account to KEEP"><button onclick="mgrMergePreview('${jsq(p.uid)}')" class="btn-dark">Preview</button></div>
            <div id="merge-box"></div>
        </div>
        ${!p.card.deleted ? `<div class="card space-y-2 border-red-500/40">
            <div class="lbl text-red-300">Delete</div>
            <p class="text-[11px] text-white/55">Hides the player and blocks sign-in. You can restore them for 30 days, then "Delete forever" becomes available.</p>
            <button onclick="mgrDeletePreview('${jsq(p.uid)}')" class="btn-red">Check before deleting…</button>
            <div id="del-box"></div>
        </div>` : ''}`);
};
window.mgrVerify = async (uid, level, on) => { if (!on && !confirm(`Remove the ${level} check?`)) return; await call('verify', { uid, level, on }); toast(on ? 'Verified ✅' : 'Removed.'); window.mgrPlayer(uid); };
window.mgrGold = async (uid) => {
    const name = val('g-name'), dob = val('g-dob');
    if (!name || !dob) return toast('Enter the name and birthday from their ID.', true);
    if (!confirm(`Give GOLD to "${name}", born ${dob}?\n\nTheir name and birthday will be set to this and locked.`)) return;
    await call('verify', { uid, level: 'gold', on: true, name, dob }); toast('Gold verified 🏅'); window.mgrPlayer(uid);
};
window.mgrFixName = async (uid) => { const r = await call('fixName', { uid }); toast(r.name ? `Name set to ${r.name}` : 'No name found in their profile either.', !r.name); };
window.mgrMergePreview = async (drop) => {
    const keep = val('m-keep'); if (!keep) return toast('Paste the user id of the account to keep (search for them, open, "Copy user id").', true);
    $('merge-box').innerHTML = '<div class="text-sm text-white/60"><i class="fa-solid fa-spinner fa-spin mr-1"></i>Checking…</div>';
    const r = await call('mergePreview', { keep, drop }).catch(() => null); if (!r) { $('merge-box').innerHTML = ''; return; }
    $('merge-box').innerHTML = `<div class="bg-black/40 rounded-xl p-3 space-y-2 text-sm">
        <div>Move <b>${esc(r.dropName)}</b> (${esc(r.dropAuth.email || 'no email')}) into <b>${esc(r.keepName)}</b> (${esc(r.keepAuth.email || 'no email')})</div>
        <div class="text-[12px] text-white/70">${r.changes.games} games · ${r.changes.communities} communities · ${money(r.changes.credits)} credit · ${r.changes.teams} teams · ${r.changes.vs} VS matches</div>
        <div class="lbl pt-1">Type <span class="text-white">${esc(r.confirmWord)}</span> to confirm</div>
        <input id="m-confirm" class="inp" autocomplete="off">
        <button onclick="mgrMerge('${jsq(keep)}','${jsq(drop)}')" class="btn-red w-full">Merge (can't be undone automatically)</button></div>`;
};
window.mgrMerge = async (keep, drop) => {
    const r = await call('merge', { keep, drop, confirm: val('m-confirm') }).catch(() => null); if (!r) return;
    toast('Merged ✅'); window.mgrPlayer(keep);
};
window.mgrDeletePreview = async (uid) => {
    $('del-box').innerHTML = '<div class="text-sm text-white/60"><i class="fa-solid fa-spinner fa-spin mr-1"></i>Checking…</div>';
    const r = await call('deletePreview', { uid }).catch(() => null); if (!r) { $('del-box').innerHTML = ''; return; }
    const a = r.activity;
    $('del-box').innerHTML = `<div class="bg-black/40 rounded-xl p-3 space-y-2 text-sm">
        ${r.active ? `<div class="text-amber-200 font-bold">⚠️ This is an ACTIVE player: ${a.played} games played, ${a.upcoming} upcoming, ${a.organized} organized, ${a.teams.length} teams, ${money(a.creditCents)} credit.</div>
            ${a.upcoming ? `<div class="text-[12px] text-amber-100">They're still signed up for: ${a.upcomingList.map(g => esc(g.title) + ' (' + esc(g.date) + ')').join(', ')}. Take them off those games first.</div>` : ''}
            ${a.creditCents > 0 ? `<label class="flex items-center gap-2 text-[12px]"><input id="d-credit" type="checkbox"> I know they still have ${money(a.creditCents)} credit</label>` : ''}` : '<div class="text-white/70">No games, teams or credit. Safe to delete.</div>'}
        <div class="lbl pt-1">Type <span class="text-white">${esc(r.confirmWord)}</span> to confirm</div>
        <input id="d-confirm" class="inp" autocomplete="off">
        <button onclick="mgrDelete('${jsq(uid)}')" class="btn-red w-full">Delete ${esc(r.name)}</button></div>`;
};
window.mgrDelete = async (uid) => {
    const r = await call('delete', { uid, confirm: val('d-confirm'), forceCredit: !!$('d-credit')?.checked }).catch(() => null); if (!r) return;
    toast('Deleted (you can restore for 30 days).'); window.mgrPlayer(uid);
};
window.mgrRestore = async (uid) => { if (!confirm('Restore this account?')) return; await call('restore', { uid }); toast('Restored ✅'); window.mgrPlayer(uid); };
window.mgrPurge = async (uid, name) => {
    const word = `FOREVER ${String(name).toUpperCase()}`;
    const typed = prompt(`This can't be undone. Type ${word} to delete forever:`); if (!typed) return;
    await call('purge', { uid, confirm: typed }).then(() => { toast('Deleted forever.'); window.mgrTab('players'); }).catch(() => {});
};

// ---------------------------------------------------------------- verified list
async function verify() {
    loading();
    const r = await call('verifications').catch(() => ({ list: [] }));
    const now = Date.now();
    body(`<div class="card text-[12px] text-white/70">${BLUE} Blue runs out 60 days after their last game with a real organizer. Ones running out within 14 days are on top.</div>
        <div class="space-y-2">${r.list.map(v => { const left = v.blueUntil ? Math.ceil((v.blueUntil - now) / 86400000) : null; return `<button onclick="mgrPlayer('${jsq(v.uid)}')" class="card w-full text-left flex items-center gap-3">
            <img src="${esc(v.avatar || AV)}" onerror="this.src='${AV}'" class="w-9 h-9 rounded-full object-cover">
            <div class="flex-1 min-w-0"><div class="font-black truncate">${esc(v.name)} ${v.gold ? GOLD : ''}${v.blue ? BLUE : ''}</div>
            <div class="text-[11px] ${left !== null && left <= 14 ? 'text-amber-300' : 'text-white/55'}">${v.blue ? (left > 0 ? `Blue: ${left} days left` : 'Blue ran out') : ''}${v.gold ? ` · Gold: ${esc(v.gold.name)}` : ''}</div></div></button>`; }).join('') || '<p class="text-sm text-white/50">Nobody verified yet. Open a player in Players to verify them.</p>'}</div>`);
}

// ---------------------------------------------------------------- admin messages
async function messages() {
    loading();
    const r = await call('adminThreads').catch(() => ({ threads: [], reports: [] }));
    S.threads = r.threads;
    body(`${r.reports.length ? `<div class="card space-y-2"><div class="lbl text-red-300">🚩 Reports</div>${r.reports.map(x => `<div class="text-[12px] border-b border-white/10 pb-1.5">
            <b>${esc(x.reporterName || x.byName || 'Someone')}</b> reported <b>${esc(x.targetName || x.name || x.targetUid || '')}</b> · ${esc(x.reason || '')} · ${dt(x.createdAt)}
            ${x.details || x.note ? `<div class="text-white/60">"${esc(x.details || x.note)}"</div>` : ''}
            ${x.targetUid ? `<button onclick="mgrPlayer('${jsq(x.targetUid)}')" class="text-[#00F296] font-bold">Open player ›</button>` : ''}</div>`).join('')}</div>` : ''}
        <div class="space-y-2">${r.threads.map((t, i) => `<div class="card space-y-2">
            <div class="flex items-center gap-2"><img src="${esc(t.avatar || AV)}" onerror="this.src='${AV}'" class="w-8 h-8 rounded-full object-cover"><div class="flex-1 min-w-0"><div class="font-black truncate">${esc(t.name)}</div><div class="text-[10px] text-white/45">${t.last ? new Date(t.last.createdAt).toLocaleString() : ''}</div></div>
                <button onclick="mgrPlayer('${jsq(t.id)}')" class="btn-dark !py-1 !px-2 text-[11px]">Player</button></div>
            <div class="space-y-1 max-h-48 overflow-y-auto">${t.messages.slice(-8).map(m => `<div class="text-[12px] ${String(m.senderUid) === String(t.id) ? 'text-white' : 'text-[#00F296]'}"><b>${String(m.senderUid) === String(t.id) ? esc(t.name.split(' ')[0]) : 'FutNet Admin'}:</b> ${esc(m.text || (m.media ? '📷' : ''))}</div>`).join('')}</div>
            <div class="flex gap-2"><input id="r-${i}" class="inp" placeholder="Reply as FutNet Admin…" onkeydown="if(event.key==='Enter')mgrReply(${i})"><button onclick="mgrReply(${i})" class="btn">Send</button></div>
        </div>`).join('') || '<p class="text-sm text-white/50">No admin chats yet.</p>'}</div>`);
}
window.mgrReply = async (i) => {
    const t = S.threads[i]; const text = val(`r-${i}`); if (!t || !text) return;
    await call('adminReply', { to: t.id, text }).then(() => { toast('Sent ✅'); messages(); }).catch(() => {});
};

// ---------------------------------------------------------------- analytics
async function analytics(days) {
    S.days = days || S.days || 7;
    loading();
    const r = await call('analytics', { days: S.days }).catch(() => ({ totals: [], perDay: [] }));
    const max = Math.max(1, ...r.perDay.map(d => d.taps));
    const nice = (k) => k.replace(/^switchModalTab:/, 'Game tab: ').replace(/^vsTab:/, 'VS tab: ').replace(/^switchTab:/, 'Main tab: ').replace(/^setCommunityTab:/, 'Community tab: ').replace(/^ttTab:/, 'Tournament tab: ').replace(/^link:/, 'Link: ').replace(/^app:open$/, 'App opened');
    body(`<div class="flex gap-2">${[7, 30, 90].map(d => `<button onclick="mgrDays(${d})" class="${S.days === d ? 'btn' : 'btn-dark'}">${d} days</button>`).join('')}</div>
        <div class="card"><div class="lbl">Taps per day (and people)</div>
            <div class="flex items-end gap-1 h-32">${r.perDay.map(d => `<div class="flex-1 flex flex-col items-center justify-end h-full" title="${esc(d.day)}: ${d.taps} taps, ${d.users} people"><div class="w-full rounded-t bg-[#00F296]/80" style="height:${Math.round(d.taps / max * 100)}%"></div></div>`).join('')}</div>
            <div class="flex justify-between text-[10px] text-white/45 mt-1"><span>${esc(r.perDay[0]?.day || '')}</span><span>${esc(r.perDay.slice(-1)[0]?.day || '')}</span></div></div>
        <div class="card"><div class="lbl">What people tap the most</div>
            ${r.totals.length ? `<div class="space-y-1">${r.totals.map(([k, n]) => `<div class="flex items-center gap-2 text-[12px]"><span class="flex-1 truncate">${esc(nice(k))}</span><span class="font-black text-[#00F296]">${n}</span></div>`).join('')}</div>` : '<p class="text-sm text-white/50">No taps counted yet. Counting starts once this update is live.</p>'}</div>`);
}
window.mgrDays = (d) => analytics(d);

// ---------------------------------------------------------------- money (FutNet itself)
async function moneyTab() {
    loading();
    const r = await call('books').catch(() => ({ list: [] }));
    S.books = r.list;
    drawMoney();
}
function monthly(e) { return e.every === 'month' ? e.amountCents : e.every === 'year' ? e.amountCents / 12 : 0; }
function drawMoney() {
    const list = S.books || [];
    const thisYear = new Date().getFullYear() + '';
    const sum = (type) => list.filter(e => e.type === type).reduce((s, e) => s + (e.every === 'once' ? (String(e.date).startsWith(thisYear) ? e.amountCents : 0) : e.every === 'month' ? e.amountCents * (new Date().getMonth() + 1) : e.amountCents), 0);
    const inc = sum('income'), exp = sum('expense');
    const perMonth = list.filter(e => e.type === 'expense').reduce((s, e) => s + monthly(e), 0);
    const quick = [['Apple Developer', 9900, 'year', 'App stores'], ['Google Play (one time)', 2500, 'once', 'App stores'], ['Claude subscription', 0, 'month', 'Tools'], ['Firebase / Google Cloud', 0, 'month', 'Hosting'], ['Domain (GoDaddy)', 0, 'year', 'Hosting']];
    body(`<div class="grid grid-cols-3 gap-3">
            <div class="card"><div class="text-xl font-black text-[#00F296]">${money(inc)}</div><div class="text-[11px] text-white/55">Income ${thisYear}</div></div>
            <div class="card"><div class="text-xl font-black text-red-300">${money(exp)}</div><div class="text-[11px] text-white/55">Costs ${thisYear}</div></div>
            <div class="card"><div class="text-xl font-black ${inc - exp >= 0 ? 'text-[#00F296]' : 'text-red-300'}">${money(inc - exp)}</div><div class="text-[11px] text-white/55">Net ${thisYear}</div></div>
        </div>
        <div class="card text-[12px] text-white/70">Running costs: about <b class="text-white">${money(perMonth)}</b> a month.</div>
        <div class="card space-y-2">
            <div class="lbl">Add</div>
            <div class="flex flex-wrap gap-1.5">${quick.map(([n, c, ev, cat]) => `<button onclick="mgrQuick('${jsq(n)}',${c},'${ev}','${jsq(cat)}')" class="btn-dark !py-1 !px-2 text-[11px]">+ ${esc(n)}</button>`).join('')}</div>
            <div class="grid grid-cols-2 gap-2">
                <select id="b-type" class="inp"><option value="expense">Cost</option><option value="income">Income</option></select>
                <input id="b-amt" class="inp" inputmode="decimal" placeholder="Amount $">
                <input id="b-note" class="inp" placeholder="What (e.g. Claude Max)">
                <input id="b-cat" class="inp" placeholder="Category (e.g. Tools)">
                <select id="b-every" class="inp"><option value="once">One time</option><option value="month">Every month</option><option value="year">Every year</option></select>
                <input id="b-date" type="date" class="inp" value="${new Date().toISOString().slice(0, 10)}">
            </div>
            <button onclick="mgrAddBook()" class="btn w-full">Save</button>
        </div>
        <div class="space-y-1.5">${list.map(e => `<div class="card !py-2 flex items-center gap-2 text-[13px]">
            <span class="${e.type === 'income' ? 'text-[#00F296]' : 'text-red-300'} font-black w-24">${e.type === 'income' ? '+' : '-'}${money(e.amountCents)}</span>
            <span class="flex-1 min-w-0 truncate">${esc(e.note || '')} <span class="text-white/45 text-[11px]">${esc(e.category || '')} · ${e.every === 'once' ? esc(e.date) : e.every === 'month' ? 'monthly' : 'yearly'}</span></span>
            ${e.old ? '<span class="text-[10px] text-white/40">from money tracker</span>' : `<button onclick="mgrDelBook('${jsq(e.id)}')" class="text-red-300 text-[12px] font-bold">Delete</button>`}</div>`).join('') || '<p class="text-sm text-white/50">Nothing yet. Add your Apple, Google and Claude costs above.</p>'}</div>`);
}
window.mgrQuick = (n, c, ev, cat) => { $('b-type').value = 'expense'; $('b-note').value = n; $('b-cat').value = cat; $('b-every').value = ev; $('b-amt').value = c ? (c / 100).toFixed(2) : ''; $('b-amt').focus(); };
window.mgrAddBook = async () => {
    const amountCents = Math.round((parseFloat(val('b-amt').replace(/[$,]/g, '')) || 0) * 100);
    if (!amountCents) return toast('Enter the amount.', true);
    const r = await call('books', { add: { type: val('b-type'), amountCents, note: val('b-note'), category: val('b-cat'), every: val('b-every'), date: val('b-date') } }).catch(() => null);
    if (r) { S.books = r.list; drawMoney(); toast('Saved ✅'); }
};
window.mgrDelBook = async (id) => { if (!confirm('Delete this line?')) return; const r = await call('books', { remove: id }).catch(() => null); if (r) { S.books = r.list; drawMoney(); } };

// ---------------------------------------------------------------- settings
async function settings() {
    loading();
    const [c, del, g] = await Promise.all([call('config').catch(() => ({ realOrganizers: [], names: {} })), call('deleted').catch(() => ({ list: [] })), call('gate').catch(() => ({ creatorsOnly: false, creators: [], names: {} }))]);
    const blk = await call('blocked').catch(() => ({ list: [] }));
    S.orgs = c.realOrganizers;
    S.gate = g;
    body(`<div class="card space-y-2 ${blk.list.length ? 'border-red-500/50' : ''}">
            <div class="lbl">🛡️ Blocked changes (someone tried to change a team or tournament that isn't theirs, and it was put back)</div>
            ${blk.list.map(x => `<div class="text-sm flex items-start gap-2 py-1 border-b border-white/5"><button onclick="mgrPlayer('${jsq(x.uid)}')" class="font-bold text-[#00F296] shrink-0">${esc(x.who || x.uid)}</button><span class="flex-1 text-white/80">${esc(x.kind)} <b>${esc(x.name)}</b>: ${esc(x.why)}</span><span class="text-[11px] text-white/45 shrink-0">${x.at ? new Date(x.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}</span></div>`).join('') || '<p class="text-sm text-white/50">Nothing blocked yet.</p>'}
        </div>
        <div class="card space-y-3 ${g.creatorsOnly ? 'border-amber-400/60' : ''}">
            <div class="flex items-center justify-between gap-3">
                <div><div class="font-black">🧪 Beta mode: only approved people create</div>
                    <div class="text-[11px] text-white/55">When ON, other players can't create games, VS matches, tournaments or communities. They see "FutNet is in beta, message the admin".</div></div>
                <button onclick="mgrGate(${!g.creatorsOnly})" class="${g.creatorsOnly ? 'btn' : 'btn-dark'} shrink-0">${g.creatorsOnly ? 'ON' : 'OFF'}</button>
            </div>
            <div class="lbl pt-1">Approved to create (${g.creators.length})</div>
            ${g.creators.map(u => `<div class="flex items-center gap-2 text-sm"><span class="flex-1">${esc(g.names[u] || u)}${u === (S.hello || {}).me ? ' (you)' : ''}</span>${u === (S.hello || {}).me ? '' : `<button onclick="mgrGateRemove('${jsq(u)}')" class="text-red-300 text-[12px] font-bold">Remove</button>`}</div>`).join('')}
            <p class="text-[11px] text-white/45">To approve someone: Players > open them > "Allow to create".</p>
        </div>
        <div class="card space-y-2">
            <div class="lbl">Real organizers (keep blue checks alive)</div>
            <p class="text-[11px] text-white/55">Players keep their blue check while they play a game run by one of these at least once every 60 days.</p>
            ${c.realOrganizers.map(u => `<div class="flex items-center gap-2 text-sm"><span class="flex-1">${esc(c.names[u] || u)}</span><button onclick="mgrDelOrg('${jsq(u)}')" class="text-red-300 text-[12px] font-bold">Remove</button></div>`).join('')}
            <div class="flex gap-2"><input id="o-uid" class="inp" placeholder="User id of an organizer to add"><button onclick="mgrAddOrg()" class="btn">Add</button></div>
        </div>
        <div class="card space-y-2">
            <div class="lbl">Deleted / merged accounts</div>
            ${del.list.map(x => `<button onclick="mgrPlayer('${jsq(x.uid)}')" class="w-full text-left text-sm flex items-center gap-2 py-1"><span class="flex-1">${esc(x.name || x.uid)}</span><span class="text-[11px] text-white/50">${x.mergedInto ? 'merged' : 'deleted ' + dt(x.deletedAt)}</span></button>`).join('') || '<p class="text-sm text-white/50">None.</p>'}
        </div>`);
}
window.mgrGate = async (on) => {
    if (!confirm(on ? 'Turn ON beta mode? Only approved people will be able to create.' : 'Turn OFF beta mode? Everyone will be able to create again.')) return;
    await call('gate', { creatorsOnly: on }); toast(on ? 'Beta mode ON 🧪' : 'Beta mode OFF'); settings();
};
window.mgrGateRemove = async (u) => { if (!confirm('Remove this person from the approved list?')) return; await call('gate', { remove: u }); settings(); };
window.mgrGateAllow = async (u, on) => { S.gate = await call('gate', on ? { add: u } : { remove: u }); toast(on ? 'Approved to create ✅' : 'Not approved any more.'); window.mgrPlayer(u); };
window.mgrAddOrg = async () => { const u = val('o-uid'); if (!u) return; await call('config', { realOrganizers: [...S.orgs, u] }); settings(); };
window.mgrDelOrg = async (u) => { if (!confirm('Remove this organizer?')) return; await call('config', { realOrganizers: S.orgs.filter(x => x !== u) }); settings(); };
