// js/game-status.js: Storm watch on a game.
//   gameStatus = { stormWatch: true|false, state: 'on' | 'likely' | 'unlikely', note, by, byName, at, cancelReason }
//   - The organizer / admins turn on "Storm watch" in the Admin tab and pick: Game on / Game likely / Game not likely.
//   - Only while Storm watch is on, the game page shows a weather section (icon + forecast + the status)
//     and the game card shows a small "⛈️ Storm watch" tag. Everyone on the game is notified of changes.
//   - "Cancel game due to storm" cancels the game (refunds as usual) and tells players it was the storm.
//   weather = the kickoff forecast the server fills in ({ emoji, label, tempF, rainPct, storm }).
import { mutateEvent, escapeHtml } from './game-profile/event-store.js';

export const STORM_STATES = {
    on: { emoji: '✅', label: 'Game on', cls: 'bg-emerald-500/15 text-[#00F296] border-emerald-400/60' },
    likely: { emoji: '🟡', label: 'Game likely', cls: 'bg-amber-500/15 text-amber-300 border-amber-400/60' },
    unlikely: { emoji: '🔴', label: 'Game not likely', cls: 'bg-red-500/15 text-red-300 border-red-400/60' },
};

const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const isOver = (ev) => ev.isSessionEnded === true || (!!ev.date && String(ev.date).slice(0, 10) < localToday());

export const stormOn = (ev) => !!(ev && ev.gameStatus && ev.gameStatus.stormWatch === true) && !isOver(ev);
export const stormState = (ev) => {
    const s = ev && ev.gameStatus && ev.gameStatus.state;
    return STORM_STATES[s] ? s : 'on';
};

/** Game card: a small tag, only while Storm watch is on. */
export function gameBadgesHtml(ev) {
    if (!stormOn(ev)) return '';
    const s = STORM_STATES[stormState(ev)];
    return `<div class="flex flex-wrap items-center gap-1.5">
        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-black bg-amber-500/15 text-amber-200 border-amber-400/60">⛈️ Storm watch</span>
        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-black ${s.cls}">${s.emoji} ${s.label}</span>
    </div>`;
}

/** Game page (top of Info): weather icon + forecast on the left, the status on the right. Only while Storm watch is on. */
export function gameStatusCardHtml(ev) {
    if (!stormOn(ev)) return '';
    const s = STORM_STATES[stormState(ev)];
    const w = ev.weather || {};
    const note = String(ev.gameStatus?.note || '').trim();
    const rain = Number(w.rainPct) || 0;
    const forecast = w.emoji
        ? `${escapeHtml(w.label || '')} · ${Math.round(Number(w.tempF) || 0)}°F${rain >= 10 ? ` · ${rain}% rain` : ''}`
        : 'Weather is being watched';
    return `
        <div class="bg-[#1A1405]/95 border-2 border-amber-400/60 rounded-[22px] p-4 shadow-xl space-y-2">
            <div class="flex items-center gap-3">
                <div class="text-4xl leading-none shrink-0">${w.emoji || '⛈️'}</div>
                <div class="flex-1 min-w-0">
                    <div class="text-[10px] font-black uppercase tracking-wider text-amber-300">Storm watch</div>
                    <div class="text-xs text-white/85">${forecast}</div>
                </div>
                <span class="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-full border-2 text-xs font-black ${s.cls}">${s.emoji} ${s.label}</span>
            </div>
            ${note ? `<p class="text-xs text-white/90">${escapeHtml(note)}</p>` : ''}
        </div>`;
}

/** Admin tab: Storm watch switch; when on, the 3 choices + Save, and "Cancel game due to storm". */
export function adminStatusHtml(ev) {
    if (!ev || isOver(ev)) return '';
    const id = escapeHtml(String(ev.id));
    const on = ev.gameStatus?.stormWatch === true;
    const st = stormState(ev);
    const w = ev.weather || {};
    const choice = (key) => {
        const s = STORM_STATES[key];
        return `<label class="flex items-center gap-3 bg-black/40 border border-white/10 rounded-xl px-3 py-2.5 cursor-pointer">
            <input type="radio" name="storm-state" value="${key}" ${st === key ? 'checked' : ''} class="w-4 h-4 accent-[#00F296]">
            <span class="text-xs font-bold text-white">${s.emoji} ${s.label}</span></label>`;
    };
    return `
        <div class="bg-black/40 border ${on ? 'border-amber-400/60' : 'border-white/10'} rounded-2xl p-4 space-y-3">
            <label class="flex items-center justify-between gap-3 cursor-pointer">
                <span><span class="block text-xs font-black uppercase text-amber-300">⛈️ Storm watch</span>
                <span class="block text-[10px] text-white/55">Shows a weather box on the game and notifies the players.</span></span>
                <input type="checkbox" ${on ? 'checked' : ''} onchange="toggleStormWatch('${id}', this.checked)" class="w-5 h-5 accent-[#00F296] shrink-0">
            </label>
            ${w.emoji ? `<div class="text-[11px] text-white/70">Forecast at kickoff: <b class="text-white">${w.emoji} ${escapeHtml(w.label || '')} · ${Math.round(Number(w.tempF) || 0)}°F${Number(w.rainPct) >= 10 ? ` · ${Number(w.rainPct)}% rain` : ''}</b></div>` : ''}
            ${on ? `
                <div class="space-y-2">${choice('on')}${choice('likely')}${choice('unlikely')}</div>
                <input id="gs-note" type="text" maxlength="160" value="${escapeHtml(ev.gameStatus?.note || '')}"
                    placeholder="Note for players (optional), e.g. We'll decide at 6:30"
                    class="w-full bg-black/60 border border-white/20 rounded-xl px-3 py-2.5 text-white text-base sm:text-xs focus:outline-none focus:border-[#00F296]">
                <button type="button" onclick="saveStormStatus('${id}')" class="w-full bg-[#00F296] text-slate-950 font-black px-4 py-2.5 rounded-xl text-xs shadow">Save</button>
                <button type="button" onclick="cancelGameForStorm('${id}')" class="w-full bg-red-500/20 border border-red-500/50 text-red-300 font-black px-4 py-2.5 rounded-xl text-xs">⛈️ Cancel game due to storm</button>` : ''}
        </div>`;
}

async function writeStatus(eventId, patch) {
    const me = window.currentUser;
    const p = window.userProfile || {};
    return mutateEvent(eventId, (draft) => {
        draft.gameStatus = {
            ...(draft.gameStatus || {}), ...patch,
            by: me ? String(me.uid) : '', byName: p.name || `${p.firstName || ''} ${p.lastName || ''}`.trim() || '',
            at: Date.now()
        };
    });
}

window.toggleStormWatch = async function (eventId, on) {
    const res = await writeStatus(eventId, on ? { stormWatch: true, state: 'on' } : { stormWatch: false });
    if (res && res.ok !== false && window.showToast) window.showToast(on ? 'Storm watch on. Players were notified.' : 'Storm watch off.');
};

window.saveStormStatus = async function (eventId) {
    const state = document.querySelector('input[name="storm-state"]:checked')?.value || 'on';
    const note = (document.getElementById('gs-note')?.value || '').trim().slice(0, 160);
    const res = await writeStatus(eventId, { stormWatch: true, state, note });
    if (res && res.ok !== false && window.showToast) window.showToast(`Saved: ${STORM_STATES[state].label}. Players were notified.`);
};

// Cancels like the normal Cancel Game (confirm, refunds), but players are told it was because of the storm.
window.cancelGameForStorm = async function (eventId) {
    await writeStatus(eventId, { cancelReason: 'storm' });
    if (window.cancelGameEvent) window.cancelGameEvent(eventId);
};

window.gameBadgesHtml = gameBadgesHtml;
window.gameStatusCardHtml = gameStatusCardHtml;
