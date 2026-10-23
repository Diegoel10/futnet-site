// js/game-profile/match-management.js: Live match tracker with direct team builder roster lookups and custom team color styling
import { mutateEvent, escapeHtml, ownGoalLabel, UNKNOWN_SCORER } from './event-store.js';

// Team names/colors come from team-tool.js (single source of truth). Fallbacks only if it isn't loaded yet.
const MM_FALLBACK_COLORS = ['#3b82f6', '#ef4444', '#eab308', '#22c55e', '#a855f7', '#ec4899', '#f97316', '#ffffff', '#000000'];
function mmTeamNames(event) {
    if (window.getTeamNames) return window.getTeamNames(event);
    const saved = (window.teamNames && window.teamNames[event.id]) || event.teamNames || {};
    return Array.from({ length: event.teamsCount || 3 }, (_, i) => saved[i] || `Team ${i + 1}`);
}
function mmTeamColors(event) {
    if (window.getTeamColors) return window.getTeamColors(event);
    const saved = (window.teamColors && window.teamColors[event.id]) || event.teamColors || {};
    return Array.from({ length: event.teamsCount || 3 }, (_, i) => saved[i] || MM_FALLBACK_COLORS[i % MM_FALLBACK_COLORS.length]);
}
function mmAccent(hex) {
    return window.teamAccent ? window.teamAccent(hex) : hex;
}

window.liveMatchTimerInterval = null;
window.liveMatchMode = 'timer'; // 'stopwatch' or 'timer'
window.liveMatchAlarmEnabled = true;

function playMatchEndAlarm() {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, audioCtx.currentTime); // A5 note
        gain.gain.setValueAtTime(0.5, audioCtx.currentTime);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 1.2);
    } catch (e) {
        console.warn("Audio alarm blocked or unavailable:", e);
    }
}

window.openStartMatchScreen = function(eventId) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event) return;

    let modal = document.getElementById('start-match-screen-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'start-match-screen-modal';
        modal.className = 'fixed inset-0 z-[200] flex flex-col bg-black/85 backdrop-blur-sm text-white';   // full-screen sheet
        document.body.appendChild(modal);
    }

    const teamNamesArr = mmTeamNames(event);
    const teamColorsArr = mmTeamColors(event);
    const teamCount = teamNamesArr.length;

    let active = event.liveMatchActive;
    let needsSync = false;
    let isNew = false;
    if (!active) {
        isNew = true;
        active = {
            teamA: teamNamesArr[0],
            teamB: teamNamesArr[1] || teamNamesArr[0],
            teamAIndex: 0,
            teamBIndex: teamCount > 1 ? 1 : 0,
            team1Goals: [],
            team2Goals: [],
            durationSeconds: 10 * 60,
            isRunning: false,
            mode: 'timer',
            elapsedSeconds: 10 * 60,
            lastUpdatedTimestamp: Date.now()
        };
        needsSync = true;
    }

    // Always resolve the two teams by INDEX so the name + color match the Team Builder, even after renames/recolors
    const pickIdx = (idx, name, fallback) => {
        if (Number.isInteger(idx) && idx >= 0 && idx < teamCount) return idx;
        const byName = teamNamesArr.indexOf(name);
        return byName !== -1 ? byName : fallback;
    };
    let idxA = pickIdx(active.teamAIndex, active.teamA, 0);
    let idxB = pickIdx(active.teamBIndex, active.teamB, teamCount > 1 ? 1 : 0);
    if (idxA === idxB && teamCount > 1) idxB = (idxA + 1) % teamCount;

    const nextState = {
        teamAIndex: idxA,
        teamBIndex: idxB,
        teamA: teamNamesArr[idxA],
        teamB: teamNamesArr[idxB],
        teamAColor: teamColorsArr[idxA],
        teamBColor: teamColorsArr[idxB]
    };
    Object.keys(nextState).forEach(k => { if (active[k] !== nextState[k]) { active[k] = nextState[k]; needsSync = true; } });

    event.liveMatchActive = active;
    if (needsSync) syncLiveMatchState(eventId, active, { create: isNew });

    window.liveMatchState = active;
    window.liveMatchMode = active.mode || 'timer';
    if (window.liveMatchTimerInterval) clearInterval(window.liveMatchTimerInterval);

    const currentSecs = window.calculateCurrentLiveSeconds(active);
    const initialM = Math.floor(currentSecs / 60);
    const initialS = currentSecs % 60;
    const initialDisplay = `${String(initialM).padStart(2, '0')}:${String(initialS).padStart(2, '0')}`;

    const colorA = mmAccent(teamColorsArr[idxA]);
    const colorB = mmAccent(teamColorsArr[idxB]);
    const mode = window.liveMatchMode;
    const alarmOn = active.alarmEnabled !== false;
    const goalsA = active.team1Goals || [], goalsB = active.team2Goals || [];
    const untouched = !goalsA.length && !goalsB.length &&
        (mode === 'stopwatch' ? currentSecs === 0 : currentSecs === (active.durationSeconds || 600));
    const status = active.isRunning ? ['LIVE', '#00F296', 'rgba(0,242,150,0.12)'] : untouched ? ['READY', '#9ca3af', 'rgba(255,255,255,0.06)'] : ['PAUSED', '#f59e0b', 'rgba(245,158,11,0.12)'];
    const startLabel = active.isRunning ? '<i class="fa-solid fa-pause"></i> Pause' : (untouched ? '<i class="fa-solid fa-play"></i> Start' : '<i class="fa-solid fa-play"></i> Resume');
    const shirt = (c) => `<i class="fa-solid fa-shirt" style="color:${c}"></i>`;
    const scorerName = (g) => typeof g === 'string' ? g : (g && (g.name || g.scorer)) || 'Goal';
    const goalList = (goals, key) => goals.length ? `<div class="space-y-1.5 pt-1 text-left">${goals.map((g, i) => `
        <div class="flex items-center gap-2 text-sm text-white/90">
            <span class="text-base leading-none">⚽</span><span class="flex-1 truncate">${escapeHtml(scorerName(g))}</span>
            <button onclick="removeLiveGoal('${eventId}', '${key}', ${i})" class="w-6 h-6 rounded-full bg-white/15 hover:bg-white/25 text-white/80 text-[11px] flex items-center justify-center shrink-0" title="Remove goal"><i class="fa-solid fa-xmark"></i></button>
        </div>`).join('')}</div>` : '';
    const durations = [5, 10, 15, 20, 25, 30];
    const curMins = Math.round((active.durationSeconds || 600) / 60);
    if (!durations.includes(curMins)) durations.push(curMins);
    const teamSelect = (id, idx, other, color) => `
        <div class="relative">
            <span class="absolute left-4 top-1/2 -translate-y-1/2 text-xl pointer-events-none">${shirt(color)}</span>
            <select id="${id}" onchange="updateLiveMatchTeamNames('${eventId}')" class="w-full appearance-none bg-[#0b151b] border-2 rounded-2xl pl-12 pr-9 py-3.5 text-white text-base font-bold focus:outline-none" style="border-color:${color}99">
                ${teamNamesArr.map((t, i) => `<option value="${i}" ${i === idx ? 'selected' : ''} ${i === other ? 'disabled' : ''}>${escapeHtml(t)}</option>`).join('')}
            </select>
            <i class="fa-solid fa-sort absolute right-4 top-1/2 -translate-y-1/2 text-white/50 text-xs pointer-events-none"></i>
        </div>`;
    const scoreCard = (key, name, goals, color) => `
        <div class="rounded-3xl p-4 space-y-3 text-center self-start" style="border:2px solid ${color}99; background:#081117;">
            <div class="flex items-center justify-center gap-2 text-lg">${shirt(color)}<span id="label-team${key}" class="font-bold text-white truncate">${escapeHtml(name)}</span></div>
            <div id="score-team${key}" class="text-7xl font-black leading-none py-1" style="color:${color}">${goals.length}</div>
            <button onclick="openGoalScorerPicker('${eventId}', '${key}')" class="w-full font-black py-3 rounded-2xl text-base transition hover:opacity-90" style="background-color:${color}26; color:${color}; border:1.5px solid ${color}66;">+ Goal</button>
            <div id="goals-team${key}">${goalList(goals, key)}</div>
        </div>`;

    modal.innerHTML = `
        <div class="flex-1 flex flex-col min-h-0 bg-[#060d12] rounded-t-[32px] mt-3 sm:mt-6 border-t border-white/10 overflow-hidden" style="margin-top: max(12px, env(safe-area-inset-top));">
        <div class="flex-1 overflow-y-auto">
        <div class="max-w-2xl mx-auto w-full px-5 pt-7 pb-8 space-y-6">
            <div class="space-y-2">
                <div class="flex items-start justify-between gap-2">
                    <h3 class="text-[26px] sm:text-4xl font-black text-white leading-tight whitespace-nowrap">Manage <span class="text-[#6ee7a0]">Live Match</span></h3>
                    <span class="mt-1.5 shrink-0 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-black tracking-widest" style="color:${status[1]}; background:${status[2]}; border:1.5px solid ${status[1]}88;">
                        <span class="w-2 h-2 rounded-full ${active.isRunning ? 'animate-pulse' : ''}" style="background:${status[1]}"></span>${status[0]}
                    </span>
                </div>
                <p class="text-sm text-white/55 leading-snug">The clock keeps running even if you close this screen. Everyone sees the score live.</p>
            </div>

            <!-- Clock -->
            <div class="rounded-3xl p-4 sm:p-5 space-y-4 border-2 border-[#1f4a44]" style="background:#081117;">
                <div class="grid grid-cols-2 gap-1 p-1 rounded-full bg-black/60 border border-[#1f4a44]">
                    <button onclick="setLiveMatchMode('${eventId}', 'stopwatch')" id="mode-stopwatch-btn" class="py-2.5 rounded-full text-sm font-bold transition ${mode === 'stopwatch' ? 'bg-[#6ee7a0] text-slate-950' : 'text-white hover:text-white/80'}"><i class="fa-solid fa-stopwatch mr-1.5"></i>Stopwatch (Up)</button>
                    <button onclick="setLiveMatchMode('${eventId}', 'timer')" id="mode-timer-btn" class="py-2.5 rounded-full text-sm font-bold transition ${mode === 'timer' ? 'bg-[#6ee7a0] text-slate-950' : 'text-white hover:text-white/80'}"><i class="fa-solid fa-hourglass-half mr-1.5"></i>Timer (Down)</button>
                </div>
                <div id="timer-settings-row" class="space-y-4 px-1 ${mode === 'stopwatch' ? 'hidden' : ''}">
                    <div class="flex items-center justify-between">
                        <span class="text-sm font-bold text-white/70">Duration:</span>
                        <div class="relative">
                            <select id="live-match-duration-select" onchange="updateLiveMatchDuration('${eventId}', this.value)" ${active.isRunning ? 'disabled' : ''} class="appearance-none bg-transparent text-[#3b9bff] text-xl font-medium pr-6 text-right focus:outline-none disabled:opacity-50">
                                ${durations.sort((x, y) => x - y).map(m => `<option value="${m}" ${m === curMins ? 'selected' : ''} style="color:#000">${m} min</option>`).join('')}
                            </select>
                            <i class="fa-solid fa-sort absolute right-0 top-1/2 -translate-y-1/2 text-[#3b9bff] text-sm pointer-events-none"></i>
                        </div>
                    </div>
                    <label class="flex items-center justify-between gap-3 cursor-pointer">
                        <span class="text-sm font-bold text-white/85">Alarm at 00:00 (match ends automatically)</span>
                        <input type="checkbox" class="sr-only peer" ${alarmOn ? 'checked' : ''} onchange="setLiveMatchAlarm('${eventId}', this.checked)">
                        <span class="relative w-14 h-8 shrink-0 rounded-full bg-white/15 peer-checked:bg-[#6ee7a0] transition after:content-[''] after:absolute after:top-1 after:left-1 after:w-6 after:h-6 after:rounded-full after:bg-white after:shadow after:transition peer-checked:after:translate-x-6"></span>
                    </label>
                </div>
                <div class="flex items-center justify-between gap-2">
                    <div id="live-match-display" class="text-[44px] min-[400px]:text-[52px] sm:text-7xl font-black text-[#6ee7a0] font-mono leading-none tabular-nums min-w-0">${initialDisplay}</div>
                    <div class="flex items-center gap-2 shrink-0">
                        <button onclick="toggleLiveMatchTimer('${eventId}')" id="live-match-start-btn" class="bg-[#6ee7a0] hover:opacity-90 text-slate-950 font-black px-5 py-3 rounded-full text-base flex items-center gap-2 transition whitespace-nowrap">${startLabel}</button>
                        <button onclick="resetLiveMatchTimer('${eventId}')" title="Reset clock" class="w-12 h-12 shrink-0 rounded-full bg-black/60 border-2 border-[#1f4a44] text-white hover:bg-black flex items-center justify-center transition"><i class="fa-solid fa-rotate-left text-lg"></i></button>
                    </div>
                </div>
            </div>

            <!-- Teams -->
            <div class="grid grid-cols-2 gap-3">
                <div class="space-y-1.5"><label class="block text-xs font-black text-white/60 tracking-wider">TEAM 1</label>${teamSelect('live-match-teamA', idxA, idxB, colorA)}</div>
                <div class="space-y-1.5"><label class="block text-xs font-black text-white/60 tracking-wider">TEAM 2</label>${teamSelect('live-match-teamB', idxB, idxA, colorB)}</div>
            </div>

            <!-- Scores -->
            <div class="grid grid-cols-2 gap-3 items-start">
                ${scoreCard('A', active.teamA, goalsA, colorA)}
                ${scoreCard('B', active.teamB, goalsB, colorB)}
            </div>

            <!-- Actions -->
            <div class="space-y-3 pt-1">
                <button onclick="saveLiveMatchResult('${eventId}')" class="w-full bg-gradient-to-r from-[#6ee7a0] to-[#4fbfa8] hover:opacity-95 text-slate-950 font-black py-4 rounded-3xl text-lg shadow-[0_0_30px_rgba(110,231,160,0.25)] transition flex items-center justify-center gap-3">
                    <i class="fa-solid fa-flag-checkered"></i> Save &amp; End Match
                </button>
                <button onclick="discardLiveMatch('${eventId}')" class="w-full text-red-400 hover:text-red-300 font-bold py-2 text-base">Delete live match</button>
                <button onclick="closeLiveMatchScreen()" class="w-full text-white/60 hover:text-white font-bold py-2 text-base">Close (match keeps going)</button>
            </div>
        </div>
        </div>
        </div>
    `;

    startLiveMatchInterval(eventId);
};

window.calculateCurrentLiveSeconds = function(active) {
    if (!active) return 0;
    if (!active.isRunning) {
        return active.elapsedSeconds !== undefined ? active.elapsedSeconds : (active.durationSeconds || 600);
    }

    const now = Date.now();
    const diffSeconds = Math.floor((now - (active.lastUpdatedTimestamp || now)) / 1000);

    if (active.mode === 'stopwatch') {
        return (active.elapsedSeconds || 0) + diffSeconds;
    } else {
        const baseSeconds = active.elapsedSeconds !== undefined ? active.elapsedSeconds : (active.durationSeconds || 600);
        const remaining = baseSeconds - diffSeconds;
        return Math.max(0, remaining);
    }
};

function startLiveMatchInterval(eventId) {
    if (window.liveMatchTimerInterval) clearInterval(window.liveMatchTimerInterval);

    const updateDisplay = () => {
        const event = (window.eventsList || []).find(ev => ev.id === eventId);
        if (!event || !event.liveMatchActive) return;

        const currentSecs = window.calculateCurrentLiveSeconds(event.liveMatchActive);
        const m = Math.floor(currentSecs / 60);
        const s = currentSecs % 60;
        
        const displayEl = document.getElementById('live-match-display');
        if (displayEl) {
            displayEl.innerText = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        }

        if (event.liveMatchActive.isRunning && event.liveMatchActive.mode === 'timer' && currentSecs <= 0) {
            event.liveMatchActive.isRunning = false;
            event.liveMatchActive.elapsedSeconds = 0;
            if (event.liveMatchActive.alarmEnabled !== false) {
                // Alarm on: ring and save the match automatically (even if this screen was closed)
                syncLiveMatchState(eventId, event.liveMatchActive);
                playMatchEndAlarm();
                if (typeof window.showToast === 'function') window.showToast("⏰ Time's up! Match ended.", "info");
                window.saveLiveMatchResult(eventId);
            } else {
                // Alarm off: the clock just stops at 00:00, the admin ends the match
                syncLiveMatchState(eventId, event.liveMatchActive).then(() => refreshLiveScreen(eventId));
            }
        }
    };

    updateDisplay();
    window.liveMatchTimerInterval = setInterval(updateDisplay, 1000);
}

/** Redraws the live match screen if it is open (status pill, buttons, goal lists). */
function refreshLiveScreen(eventId) {
    if (document.getElementById('start-match-screen-modal')) window.openStartMatchScreen(eventId);
}

window.closeLiveMatchScreen = function() {
    // Only the screen closes: the match, the clock and the auto-save at 00:00 keep going.
    document.getElementById('start-match-screen-modal')?.remove();
};

window.setLiveMatchAlarm = async function(eventId, on) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event || !event.liveMatchActive) return;
    event.liveMatchActive.alarmEnabled = !!on;
    await syncLiveMatchState(eventId, event.liveMatchActive);
};

window.removeLiveGoal = async function(eventId, teamKey, index) {
    const key = teamKey === 'A' ? 'team1Goals' : 'team2Goals';
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    const goal = event?.liveMatchActive?.[key]?.[index];
    const name = typeof goal === 'string' ? goal : (goal && goal.name) || 'this goal';
    if (!confirm(`Remove the goal by ${name}?`)) return;
    const res = await mutateEvent(eventId, (draft) => {
        const live = draft.liveMatchActive;
        if (!live || !Array.isArray(live[key]) || index >= live[key].length) return false;
        // Remove the same goal even if another phone added one meanwhile
        if (JSON.stringify(live[key][index]) !== JSON.stringify(goal)) {
            const at = live[key].findIndex(g => JSON.stringify(g) === JSON.stringify(goal));
            if (at < 0) return false;
            live[key].splice(at, 1);
        } else live[key].splice(index, 1);
    });
    if (res.ok && !res.aborted) {
        if (event) event.liveMatchActive = res.event.liveMatchActive;
        refreshLiveScreen(eventId);
    }
};

window.setLiveMatchMode = async function(eventId, mode) {
    window.liveMatchMode = mode;
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event || !event.liveMatchActive) return;
    const dur = event.liveMatchActive.durationSeconds || 600;
    event.liveMatchActive = {
        ...event.liveMatchActive,
        mode,
        isRunning: false,
        durationSeconds: dur,
        elapsedSeconds: mode === 'stopwatch' ? 0 : dur,
        lastUpdatedTimestamp: Date.now()
    };
    refreshLiveScreen(eventId);
    await syncLiveMatchState(eventId, event.liveMatchActive);
};

window.updateLiveMatchDuration = async function(eventId, mins) {
    const dur = (parseInt(mins, 10) || 10) * 60;
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event || !event.liveMatchActive) return;

    if (!event.liveMatchActive.isRunning) {
        event.liveMatchActive.durationSeconds = dur;
        event.liveMatchActive.elapsedSeconds = dur;
        event.liveMatchActive.lastUpdatedTimestamp = Date.now();
        refreshLiveScreen(eventId);
        await syncLiveMatchState(eventId, event.liveMatchActive);
    }
};

window.toggleLiveMatchTimer = async function(eventId) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event || !event.liveMatchActive) return;

    const active = event.liveMatchActive;
    const currentSecs = window.calculateCurrentLiveSeconds(active);

    active.isRunning = !active.isRunning;
    active.elapsedSeconds = currentSecs;
    active.lastUpdatedTimestamp = Date.now();

    refreshLiveScreen(eventId);
    await syncLiveMatchState(eventId, active);
};

window.resetLiveMatchTimer = async function(eventId) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event || !event.liveMatchActive) return;

    const active = event.liveMatchActive;
    active.isRunning = false;
    active.elapsedSeconds = active.mode === 'stopwatch' ? 0 : active.durationSeconds;
    active.lastUpdatedTimestamp = Date.now();

    refreshLiveScreen(eventId);
    await syncLiveMatchState(eventId, active);
};

// Saves the timer / teams of the live match on top of the LIVE game:
//  - goals are never overwritten here (another phone may have just added one)
//  - if the match was already saved or discarded somewhere else, nothing is brought back
async function syncLiveMatchState(eventId, activeState, opts = {}) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (event) event.liveMatchActive = activeState;
    await mutateEvent(eventId, (draft) => {
        const live = draft.liveMatchActive;
        if (!live) {
            if (!opts.create) return false;
            draft.liveMatchActive = activeState;
            return;
        }
        draft.liveMatchActive = {
            ...live,
            ...activeState,
            team1Goals: Array.isArray(live.team1Goals) ? live.team1Goals : [],
            team2Goals: Array.isArray(live.team2Goals) ? live.team2Goals : []
        };
    });
}

window.updateLiveMatchTeamNames = async function(eventId) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event || !event.liveMatchActive) return;

    const iA = parseInt(document.getElementById('live-match-teamA').value, 10);
    const iB = parseInt(document.getElementById('live-match-teamB').value, 10);
    if (iA === iB) {
        if (typeof window.showToast === 'function') window.showToast("A team can't play against itself.", "error");
        window.openStartMatchScreen(eventId);
        return;
    }

    const names = mmTeamNames(event);
    const colors = mmTeamColors(event);
    event.liveMatchActive.teamAIndex = iA;
    event.liveMatchActive.teamBIndex = iB;
    event.liveMatchActive.teamA = names[iA];
    event.liveMatchActive.teamB = names[iB];
    event.liveMatchActive.teamAColor = colors[iA];
    event.liveMatchActive.teamBColor = colors[iB];

    window.openStartMatchScreen(eventId);
    await syncLiveMatchState(eventId, event.liveMatchActive);
};

/** A team's players for the live match: only people actually on that team (Team Builder), never everyone. */
function liveTeamPlayers(event, teamKey) {
    const live = event.liveMatchActive || {};
    let teamName = teamKey === 'A' ? live.teamA : live.teamB;
    const assignments = event.teamAssignments || window.teamAssignments?.[event.id] || {};
    const configuredNames = (window.teamNames && window.teamNames[event.id]) || event.teamNames || {};
    let teamIndex = teamKey === 'A' ? live.teamAIndex : live.teamBIndex;
    if (!Number.isInteger(teamIndex)) teamIndex = -1;
    for (let i = 0; teamIndex === -1 && i < (event.teamsCount || 3); i++) {
        if ((configuredNames[i] || `Team ${i + 1}`) === teamName) teamIndex = i;
    }
    if (teamIndex !== -1) teamName = mmTeamNames(event)[teamIndex] || teamName;
    let players = [];
    if (teamIndex !== -1 && Array.isArray(assignments[teamIndex])) players = assignments[teamIndex].filter(p => p && p.name);
    if (!players.length) {
        Object.entries(assignments).forEach(([tKey, roster]) => {
            if ((configuredNames[tKey] || `Team ${parseInt(tKey) + 1}`) === teamName && Array.isArray(roster)) {
                roster.forEach(p => { if (p && p.name && !players.some(x => x.name === p.name)) players.push(p); });
            }
        });
    }
    return { teamName, players };
}

window.openGoalScorerPicker = function(eventId, teamKey) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event || !event.liveMatchActive) return;

    // Only players on this team can score for it (no one outside the two teams).
    const { teamName, players: assignedPlayers } = liveTeamPlayers(event, teamKey);
    // Own goal: a player from the OTHER team scores into their own net; it counts for this team.
    const { teamName: otherName, players: otherPlayers } = liveTeamPlayers(event, teamKey === 'A' ? 'B' : 'A');

    let picker = document.getElementById('goal-scorer-picker-modal');
    if (!picker) {
        picker = document.createElement('div');
        picker.id = 'goal-scorer-picker-modal';
        picker.className = 'fixed inset-0 z-[220] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm';
        document.body.appendChild(picker);
    }
    const row = (p, label) => `
        <div data-goal="${escapeHtml(label)}" onclick="recordLiveGoal('${eventId}', '${teamKey}', this.dataset.goal)" class="flex items-center gap-3 p-3 bg-black/40 hover:bg-black rounded-xl cursor-pointer transition border border-white/10">
            <img src="${escapeHtml((window.resolvePlayerAvatar ? window.resolvePlayerAvatar(p) : p.avatar) || 'https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg')}" class="w-7 h-7 rounded-full object-cover" onerror="this.src='https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg'">
            <span class="text-xs font-bold text-white">${escapeHtml(p.name)}</span>
        </div>`;

    picker.innerHTML = `
        <div class="bg-[#040E13] border border-emerald-500/40 rounded-3xl max-w-xs w-full p-6 space-y-4 shadow-2xl text-white max-h-[90vh] overflow-y-auto">
            <div class="flex items-center justify-between border-b border-white/10 pb-3">
                <h4 class="text-xs font-black uppercase text-white truncate">Goal for ${escapeHtml(teamName || 'Team')}</h4>
                <button onclick="document.getElementById('goal-scorer-picker-modal').remove()" class="text-white/50 hover:text-white text-lg font-bold"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="space-y-2">
                ${assignedPlayers.length ? assignedPlayers.map(p => row(p, p.name || 'Player')).join('')
                    : '<p class="text-xs text-white/60">Nobody is on this team yet. Add players in Team Builder first.</p>'}
            </div>
            <div data-goal="${UNKNOWN_SCORER}" onclick="recordLiveGoal('${eventId}', '${teamKey}', this.dataset.goal)" class="flex items-center gap-3 p-3 bg-black/40 hover:bg-black rounded-xl cursor-pointer transition border border-dashed border-white/25">
                <span class="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-sm">🤷</span>
                <span class="text-xs font-bold text-white/90">Don't recall / someone else</span>
            </div>
            ${otherPlayers.length ? `
            <div class="space-y-2 pt-2 border-t border-white/10">
                <div class="text-[10px] font-black uppercase tracking-wider text-amber-300">Own goal by ${escapeHtml(otherName || 'the other team')}</div>
                ${otherPlayers.map(p => row(p, ownGoalLabel(p.name || 'Player'))).join('')}
            </div>` : ''}
            <button onclick="document.getElementById('goal-scorer-picker-modal').remove()" class="w-full bg-black/60 text-white py-2.5 rounded-xl text-xs font-bold border border-white/20">Cancel</button>
        </div>
    `;
};

window.recordLiveGoal = async function(eventId, teamKey, scorerName) {
    const picker = document.getElementById('goal-scorer-picker-modal');
    if (picker) picker.remove();

    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event || !event.liveMatchActive) return;

    // The goal is added to the LIVE match, so a goal added at the same moment on a phone is kept too.
    const key = teamKey === 'A' ? 'team1Goals' : 'team2Goals';
    const res = await mutateEvent(eventId, (draft) => {
        if (!draft.liveMatchActive) return false;   // the match was already saved somewhere else
        draft.liveMatchActive[key] = Array.isArray(draft.liveMatchActive[key]) ? draft.liveMatchActive[key] : [];
        draft.liveMatchActive[key].push(scorerName);
    });
    if (!res.ok) return;
    if (res.aborted) { window.showToast && window.showToast('This match was already saved.', 'error'); return; }
    event.liveMatchActive = res.event.liveMatchActive || {};
    refreshLiveScreen(eventId);
    if (typeof window.showToast === 'function') {
        window.showToast(`⚽ Goal! ${scorerName}`);
    }
};

window.saveLiveMatchResult = async function(eventId) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event || !event.liveMatchActive) return;

    // Built from the LIVE game: if a phone (or another browser) already saved this match when the
    // timer hit 00:00, nothing is saved twice. Goals added on other devices are included.
    const res = await mutateEvent(eventId, (draft) => {
        const live = draft.liveMatchActive;
        if (!live) return false;
        const namesNow = mmTeamNames(draft.id ? draft : { ...draft, id: eventId });
        const colorsNow = mmTeamColors(draft.id ? draft : { ...draft, id: eventId });
        const iA = Number.isInteger(live.teamAIndex) ? live.teamAIndex : namesNow.indexOf(live.teamA);
        const iB = Number.isInteger(live.teamBIndex) ? live.teamBIndex : namesNow.indexOf(live.teamB);
        draft.matches = Array.isArray(draft.matches) ? draft.matches : [];
        draft.matches.push({
            teamA: iA >= 0 ? namesNow[iA] : live.teamA,
            teamB: iB >= 0 ? namesNow[iB] : live.teamB,
            teamAIndex: iA >= 0 ? iA : null,
            teamBIndex: iB >= 0 ? iB : null,
            teamAColor: iA >= 0 ? colorsNow[iA] : (live.teamAColor || null),
            teamBColor: iB >= 0 ? colorsNow[iB] : (live.teamBColor || null),
            team1Goals: live.team1Goals || [],
            team2Goals: live.team2Goals || [],
            isFinished: true,
            timestamp: new Date().toISOString()
        });
        draft.liveMatchActive = null;
    });
    if (res.ok && res.aborted) {
        // Already saved somewhere else: just close the screen.
        if (window.liveMatchTimerInterval) clearInterval(window.liveMatchTimerInterval);
        document.getElementById('start-match-screen-modal')?.remove();
        return;
    }
    if (res.ok) {
        if (window.liveMatchTimerInterval) clearInterval(window.liveMatchTimerInterval);
        window.showToast("Match saved and recorded!");
        const modal = document.getElementById('start-match-screen-modal');
        if (modal) modal.remove();
    }
};

window.discardLiveMatch = async function(eventId) {
    if (!confirm("Delete this live match? The score will not be saved.")) return;
    const res = await mutateEvent(eventId, (draft) => { draft.liveMatchActive = null; });
    if (res.ok) {
        if (window.liveMatchTimerInterval) clearInterval(window.liveMatchTimerInterval);
        document.getElementById('start-match-screen-modal')?.remove();
        window.showToast("Live match deleted.");
    }
};