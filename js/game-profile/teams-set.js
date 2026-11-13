// js/game-profile/teams-set.js: "Teams set" for regular games.
//   An admin (organizer or community admin) taps "✅ Teams set" when the teams are final.
//   - Everyone on a team gets ONE notification: "Teams are set ✅ You're on Team 2" (server: onGameWritten).
//     Before the teams are set, moving players around pings nobody (except live Caps mode picks).
//     After, a player who gets moved gets one ping a few minutes after the last change.
//   - The "You're in!" card says "You're on Team 2 · Wear Red" (tap = your team in the Roster).
//   - Roster > Confirmed: one box per team (shirt color + name), tap to open/close; your team first ("Your team").
//   The admin can tap "Unset" to make changes quietly again.
// Saved on the game: teamsSet = { at, by, byName } (or null).
import { mutateEvent, escapeHtml as esc, jsArg } from './event-store.js';

const toast = (m, t) => window.showToast && window.showToast(m, t);
const meUid = () => String((window.currentUser && window.currentUser.uid) || '');
const myName = () => { const p = window.userProfile || {}; return p.name || p.firstName || (window.currentUser && window.currentUser.displayName) || 'Admin'; };
const DEFAULT_AV = 'https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg';

export const teamsAreSet = (ev) => !!(ev && ev.teamsSet && ev.teamsSet.at);
export const isGameAdmin = (ev) => { const u = meUid(); return !!u && !!ev && (String(ev.organizerId) === u || (ev.communityId && (window.myCommunityRoles || {})[ev.communityId] === 'admin')); };

/** The teams of a game: [{ i, name, color, players: [...] }] plus who is going but not on a team. */
export function teamsOf(ev) {
    const n = Math.max(1, parseInt(ev.teamsCount, 10) || 3);
    const ta = (window.teamAssignments && window.teamAssignments[ev.id]) || ev.teamAssignments || {};
    const names = ev.teamNames || {};
    const colors = window.getTeamColors ? window.getTeamColors(ev) : [];
    const teams = Array.from({ length: n }, (_, i) => ({
        i, name: names[i] || `Team ${i + 1}`, color: colors[i] || '#00F296',
        players: (Array.isArray(ta[i]) ? ta[i] : (Array.isArray(ta[String(i)]) ? ta[String(i)] : [])).filter(p => p && (p.uid || p.name)),
    }));
    const onTeam = new Set(teams.flatMap(t => t.players.map(p => String(p.uid || p.name))));
    const going = (ev.attendees || []).filter(a => (a.status || 'confirmed') === 'confirmed');
    const loose = going.filter(a => !onTeam.has(String(a.uid || a.name)));
    return { teams, loose };
}
const shirt = (color) => `<i class="fa-solid fa-shirt" style="color:${/^#[0-9a-f]{3,8}$/i.test(String(color)) ? color : '#00F296'};-webkit-text-stroke:1px rgba(255,255,255,.35)"></i>`;
const av = (p) => esc(window.resolvePlayerAvatar ? window.resolvePlayerAvatar(p) : (p.avatar || DEFAULT_AV));

/** "Red", "Blue"… from a shirt color (the Team Builder's color list). */
export function colorName(hex) {
    const h = String(hex || '').toLowerCase();
    const hit = (window.TEAM_COLOR_OPTIONS || []).find(c => String(c.hex).toLowerCase() === h);
    return hit ? hit.name : '';
}
const myTeamOf = (ev) => { const me = meUid(); return me ? teamsOf(ev).teams.find(t => t.players.some(p => String(p.uid) === me)) : null; };

/** In the "You're in!" card: "👕 You're on Team 2 · wear Red" (taps open your team in the Roster). */
export function myTeamLineHtml(ev) {
    if (!teamsAreSet(ev)) return '';
    const t = myTeamOf(ev);
    if (!t) return `<div class="text-[11px] text-white/55">Teams are set. You're not on a team yet.</div>`;
    const cn = colorName(t.color);
    return `<button onclick="openMyTeam('${jsArg(ev.id)}')" class="mx-auto flex items-center gap-2 bg-black/50 border-2 rounded-2xl px-4 py-2.5" style="border-color:${esc(t.color)}">
        <span class="text-lg">${shirt(t.color)}</span>
        <span class="text-left"><span class="block text-[13px] font-black text-white">You're on ${esc(t.name)}</span>
        ${cn ? `<span class="block text-[11px] font-bold text-white/70">Wear ${esc(cn)}</span>` : ''}</span>
        <i class="fa-solid fa-chevron-right text-[10px] text-white/50 ml-1"></i></button>`;
}
/** Open the game's Roster with my team open on top (also where the "Teams are set" notification lands). */
window.openMyTeam = function (eventId) {
    window.activeRosterSubTab = 0;
    window.__openTeamOnce = eventId;
    if (window.switchModalTab) window.switchModalTab('roster');
};

/** Roster > Confirmed: one box per team (shirt color + name), tap to open/close. Your team first ("Your team"), open. */
export function teamsSetRosterHtml(ev, confirmedList, card) {
    const { teams } = teamsOf(ev);
    const me = meUid();
    const mine = myTeamOf(ev);
    const byKey = new Map(confirmedList.map(a => [String(a.uid || a.name), a]));
    const used = new Set();
    const order = mine ? [mine, ...teams.filter(t => t.i !== mine.i)] : teams;
    const groups = order.map(t => {
        const rows = t.players.map(p => { const k = String(p.uid || p.name); const a = byKey.get(k); if (!a) return ''; used.add(k); return card(a); }).filter(Boolean);
        const isMine = mine && t.i === mine.i;
        const cn = colorName(t.color);
        return `<details ${isMine || !mine ? 'open' : ''} class="group rounded-2xl border-2 bg-black/30 overflow-hidden" style="border-color:${esc(t.color)}66">
            <summary class="list-none [&::-webkit-details-marker]:hidden cursor-pointer flex items-center gap-2.5 px-3 py-2.5" style="background:linear-gradient(90deg, ${esc(t.color)}33, transparent)">
                <span class="text-lg">${shirt(t.color)}</span>
                <span class="flex-1 min-w-0 text-left"><span class="block text-sm font-black text-white truncate">${esc(t.name)}${isMine ? ' <span class="text-[10px] font-black text-slate-950 bg-[#00F296] rounded-full px-2 py-0.5 align-middle ml-1">Your team</span>' : ''}</span>
                ${cn ? `<span class="block text-[10px] text-white/55">${esc(cn)} shirts</span>` : ''}</span>
                <span class="text-xs font-bold text-white/60">${rows.length}</span>
                <i class="fa-solid fa-chevron-down text-[10px] text-white/60 transition group-open:rotate-180"></i>
            </summary>
            <div class="p-2.5 pt-1 space-y-2">${rows.join('') || '<div class="text-[11px] text-white/40 pl-1">No players</div>'}</div>
        </details>`;
    });
    const rest = confirmedList.filter(a => !used.has(String(a.uid || a.name)));
    if (rest.length) groups.push(`<details class="group rounded-2xl border border-white/15 bg-black/30 overflow-hidden">
        <summary class="list-none [&::-webkit-details-marker]:hidden cursor-pointer flex items-center gap-2.5 px-3 py-2.5"><span class="flex-1 text-sm font-black text-white/70">Not on a team yet</span><span class="text-xs font-bold text-white/60">${rest.length}</span><i class="fa-solid fa-chevron-down text-[10px] text-white/60 transition group-open:rotate-180"></i></summary>
        <div class="p-2.5 pt-1 space-y-2">${rest.map(card).join('')}</div></details>`);
    void me;
    return `<div class="space-y-2.5">${groups.join('')}</div>`;
}

/** Admin button ("✅ Teams set" / "Unset"). */
export function teamsSetButtonHtml(ev, cls = '') {
    if (!isGameAdmin(ev)) return '';
    return teamsAreSet(ev)
        ? `<button onclick="setTeamsReady('${jsArg(ev.id)}', false)" class="${cls || 'bg-black/60 border border-white/20 text-white/80 font-bold px-3 py-2 rounded-xl text-[11px]'}">↩️ Unset teams</button>`
        : `<button onclick="setTeamsReady('${jsArg(ev.id)}', true)" class="${cls || 'bg-[#00F296] text-slate-950 font-black px-3 py-2 rounded-xl text-[11px] shadow-[0_0_15px_rgba(0,242,150,0.4)]'}">✅ Teams set</button>`;
}

window.setTeamsReady = async function (eventId, on) {
    const ev = (window.eventsList || []).find(e => e.id === eventId);
    if (on) {
        const { teams, loose } = ev ? teamsOf(ev) : { teams: [], loose: [] };
        const empty = teams.filter(t => !t.players.length).length;
        const warn = [loose.length ? `${loose.length} player${loose.length === 1 ? " isn't" : "s aren't"} on a team yet.` : '', empty ? `${empty} team${empty === 1 ? ' is' : 's are'} empty.` : ''].filter(Boolean).join(' ');
        if (!confirm(`Teams set? Everyone on a team gets a notification with their team and shirt color.${warn ? '\n\n' + warn : ''}`)) return;
    } else if (!confirm('Unset the teams? You can move players around without anyone getting pinged, then tap "Teams set" again.')) return;
    const res = await mutateEvent(eventId, (draft) => { draft.teamsSet = on ? { at: Date.now(), by: meUid(), byName: myName() } : null; });
    if (!res.ok) return;
    toast(on ? 'Teams set ✅ Everyone was told their team.' : 'Teams unset. Make your changes, then tap "Teams set" again.');
    if (window.renderEventDetailModalContent) window.renderEventDetailModalContent();
    window.dispatchEvent(new CustomEvent('eventsDataUpdated', { detail: { eventId } }));
};
window.teamsSetButtonHtml = teamsSetButtonHtml;
