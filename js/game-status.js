// js/game-status.js: weather + game status on a game.
//   weather    – filled in by the server every 3 hours for games in the next 7 days
//                ({ emoji, label, tempF, rainPct, storm })
//   gameStatus – set by the organizer / admins in the Admin tab ({ state: 'on' | 'watch' | 'delayed', note })
//                Everyone on the game gets a notification when it changes. No status = "Game on".
import { mutateEvent, escapeHtml } from './game-profile/event-store.js';

export const GAME_STATES = {
    on: { emoji: '✅', label: 'Game on', cls: 'bg-emerald-500/15 text-[#00F296] border-emerald-400/50' },
    watch: { emoji: '⛈️', label: 'Storm watch', cls: 'bg-amber-500/15 text-amber-300 border-amber-400/60' },
    delayed: { emoji: '⏰', label: 'Delayed', cls: 'bg-orange-500/15 text-orange-300 border-orange-400/60' },
};

export const statusOf = (ev) => {
    const s = ev && ev.gameStatus && ev.gameStatus.state;
    return GAME_STATES[s] ? s : 'on';
};

const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const isOver = (ev) => ev.isSessionEnded === true || (!!ev.date && String(ev.date).slice(0, 10) < localToday());

/** "☀️ 84° · 10%" chip, or '' when there's no forecast yet. */
export function weatherChipHtml(ev, big = false) {
    const w = ev && ev.weather;
    if (!w || !w.emoji || isOver(ev)) return '';
    const rain = Number(w.rainPct) || 0;
    const storm = w.storm === true;
    const text = big
        ? `${w.emoji} ${escapeHtml(w.label || '')} · ${Math.round(Number(w.tempF) || 0)}°F${rain >= 10 ? ` · ${rain}% rain` : ''}`
        : `${w.emoji} ${Math.round(Number(w.tempF) || 0)}°${rain >= 20 ? ` · ${rain}%` : ''}`;
    return `<span title="Forecast at kickoff: ${escapeHtml(w.label || '')}" class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold whitespace-nowrap ${storm ? 'bg-amber-500/15 text-amber-200 border-amber-400/60' : 'bg-sky-500/10 text-sky-200 border-sky-400/40'}">${text}</span>`;
}

/** "✅ Game on" / "⛈️ Storm watch" / "⏰ Delayed" pill ('' for past games). */
export function statusPillHtml(ev) {
    if (!ev || isOver(ev)) return '';
    const s = GAME_STATES[statusOf(ev)];
    return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-black whitespace-nowrap ${s.cls}">${s.emoji} ${s.label}</span>`;
}

/** Both badges for a game card. */
export function gameBadgesHtml(ev) {
    const html = statusPillHtml(ev) + weatherChipHtml(ev);
    return html ? `<div class="flex flex-wrap items-center gap-1.5">${html}</div>` : '';
}

/** The box on the game page (Info tab): status, the admin's note, and the forecast. */
export function gameStatusCardHtml(ev) {
    if (!ev || isOver(ev)) return '';
    const st = statusOf(ev);
    const s = GAME_STATES[st];
    const note = String(ev.gameStatus?.note || '').trim();
    const w = weatherChipHtml(ev, true);
    return `
        <div class="bg-[#040E13]/95 border-2 ${st === 'on' ? 'border-[#00B4AE]/40' : 'border-amber-400/60'} rounded-[22px] p-4 shadow-xl space-y-2">
            <div class="flex items-center justify-between gap-2 flex-wrap">
                <span class="text-[9px] font-black text-white/50 uppercase tracking-wider">Game status</span>
                <span class="inline-flex items-center gap-1 px-3 py-1 rounded-full border text-xs font-black ${s.cls}">${s.emoji} ${s.label}</span>
            </div>
            ${note ? `<p class="text-xs text-white/90">${escapeHtml(note)}</p>` : ''}
            ${w ? `<div class="flex items-center gap-2"><span class="text-[10px] text-white/50 font-bold">At kickoff:</span>${w}</div>` : ''}
        </div>`;
}

/** Admin tab: pick the status (+ optional note). Players get a notification. */
export function adminStatusHtml(ev) {
    if (!ev || isOver(ev)) return '';
    const st = statusOf(ev);
    const id = escapeHtml(String(ev.id));
    const btn = (key) => {
        const s = GAME_STATES[key];
        return `<button type="button" onclick="pickGameStatus('${id}', '${key}')" data-gs="${key}"
            class="flex-1 min-w-[90px] px-2 py-2.5 rounded-xl text-xs font-black border-2 transition ${st === key ? s.cls : 'bg-black/40 text-white/70 border-white/15'}">${s.emoji} ${s.label}</button>`;
    };
    return `
        <div class="bg-black/40 border border-white/10 rounded-2xl p-4 space-y-3">
            <h5 class="text-xs font-black uppercase text-[#00F296]">Game status</h5>
            <p class="text-[11px] text-white/60">Shown on the game for everyone. Players get a notification when you change it.</p>
            ${weatherChipHtml(ev, true) ? `<div class="flex items-center gap-2"><span class="text-[10px] text-white/50 font-bold">Forecast at kickoff:</span>${weatherChipHtml(ev, true)}</div>` : ''}
            <div class="flex flex-wrap gap-2">${btn('on')}${btn('watch')}${btn('delayed')}</div>
            <input id="gs-note" type="text" maxlength="160" value="${escapeHtml(ev.gameStatus?.note || '')}"
                placeholder="Note for players (optional), e.g. Starts 7:30 instead"
                class="w-full bg-black/60 border border-white/20 rounded-xl px-3 py-2.5 text-white text-base sm:text-xs focus:outline-none focus:border-[#00F296]">
            <button type="button" onclick="saveGameStatus('${id}')" class="w-full bg-[#00F296] text-slate-950 font-black px-4 py-2.5 rounded-xl text-xs shadow">Save status</button>
            <p class="text-[10px] text-white/45">To call the game off, use Cancel Game (it handles refunds).</p>
        </div>`;
}

let picked = {};
window.pickGameStatus = function (eventId, state) {
    picked[eventId] = state;
    document.querySelectorAll('[data-gs]').forEach(b => {
        const on = b.dataset.gs === state;
        const s = GAME_STATES[b.dataset.gs];
        b.className = `flex-1 min-w-[90px] px-2 py-2.5 rounded-xl text-xs font-black border-2 transition ${on ? s.cls : 'bg-black/40 text-white/70 border-white/15'}`;
    });
};

window.saveGameStatus = async function (eventId) {
    const ev = (window.eventsList || []).find(e => e.id === eventId) || {};
    const state = picked[eventId] || statusOf(ev);
    const note = (document.getElementById('gs-note')?.value || '').trim().slice(0, 160);
    const me = window.currentUser;
    const p = window.userProfile || {};
    const res = await mutateEvent(eventId, (draft) => {
        draft.gameStatus = {
            state, note: state === 'on' && !note ? '' : note,
            by: me ? String(me.uid) : '', byName: p.name || `${p.firstName || ''} ${p.lastName || ''}`.trim() || '',
            at: Date.now()
        };
    });
    if (res && res.ok !== false) {
        delete picked[eventId];
        if (window.showToast) window.showToast(`Status saved: ${GAME_STATES[state].label}. Players were notified.`);
    }
};

window.gameBadgesHtml = gameBadgesHtml;
window.gameStatusCardHtml = gameStatusCardHtml;
