// js/game-profile/match-management.js: Live match tracker with direct team builder roster lookups and custom team color styling
import { db, appId } from '../firebase-config.js';
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

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
        modal.className = 'fixed inset-0 z-[200] flex items-center justify-center bg-black/80 p-4 backdrop-blur-md overflow-y-auto';
        document.body.appendChild(modal);
    }

    const teamNamesArr = mmTeamNames(event);
    const teamColorsArr = mmTeamColors(event);
    const teamCount = teamNamesArr.length;

    let active = event.liveMatchActive;
    let needsSync = false;
    if (!active) {
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
    if (needsSync) syncLiveMatchState(eventId, active);

    window.liveMatchState = active;
    window.liveMatchMode = active.mode || 'timer';
    if (window.liveMatchTimerInterval) clearInterval(window.liveMatchTimerInterval);

    const currentSecs = window.calculateCurrentLiveSeconds(active);
    const initialM = Math.floor(currentSecs / 60);
    const initialS = currentSecs % 60;
    const initialDisplay = `${String(initialM).padStart(2, '0')}:${String(initialS).padStart(2, '0')}`;

    const colorA = mmAccent(teamColorsArr[idxA]);
    const colorB = mmAccent(teamColorsArr[idxB]);

    modal.innerHTML = `
        <div class="bg-[#040E13] border border-[#00B4AE]/50 rounded-3xl p-6 space-y-4 max-w-lg w-full mx-auto shadow-2xl text-white relative max-h-[90vh] overflow-y-auto" onclick="event.stopPropagation()">
            <div class="space-y-4">
                <div class="flex items-center justify-between border-b border-white/10 pb-3">
                    <div>
                        <h3 class="text-sm font-black text-white uppercase tracking-wider flex items-center gap-2">
                            Manage Live Match
                        </h3>
                        <p class="text-[10px] text-white/50">Track scores, timer, and match results.</p>
                    </div>
                    <button onclick="document.getElementById('start-match-screen-modal').remove()" class="text-white/50 hover:text-white text-lg font-bold"><i class="fa-solid fa-xmark"></i></button>
                </div>

                <!-- Timer / Stopwatch Control Box -->
                <div class="bg-black/50 border border-[#00B4AE]/40 rounded-2xl p-4 space-y-3 shadow-inner">
                    <div class="grid grid-cols-2 gap-2 bg-black/60 p-1 rounded-xl border border-white/10">
                        <button onclick="setLiveMatchMode('${eventId}', 'stopwatch')" id="mode-stopwatch-btn" class="py-2 rounded-lg text-[10px] font-black uppercase transition ${window.liveMatchMode === 'stopwatch' ? 'bg-[#00F296] text-slate-950 shadow' : 'text-white/60 hover:text-white'}">
                            <i class="fa-solid fa-stopwatch mr-1"></i> Stopwatch (Up)
                        </button>
                        <button onclick="setLiveMatchMode('${eventId}', 'timer')" id="mode-timer-btn" class="py-2 rounded-lg text-[10px] font-black uppercase transition ${window.liveMatchMode === 'timer' ? 'bg-[#00F296] text-slate-950 shadow' : 'text-white/60 hover:text-white'}">
                            <i class="fa-solid fa-hourglass-half mr-1"></i> Timer (Down)
                        </button>
                    </div>

                    <div id="timer-settings-row" class="flex items-center justify-between text-xs px-1 ${window.liveMatchMode === 'stopwatch' ? 'hidden' : ''}">
                        <span class="text-white/60 font-bold uppercase text-[10px]">Duration:</span>
                        <select id="live-match-duration-select" onchange="updateLiveMatchDuration('${eventId}', this.value)" class="bg-black/80 text-white font-bold text-xs px-3 py-1.5 rounded-xl border border-white/20">
                            <option value="5" ${active.durationSeconds === 300 ? 'selected' : ''}>5 min</option>
                            <option value="10" ${active.durationSeconds === 600 ? 'selected' : ''}>10 min</option>
                            <option value="15" ${active.durationSeconds === 900 ? 'selected' : ''}>15 min</option>
                            <option value="20" ${active.durationSeconds === 1200 ? 'selected' : ''}>20 min</option>
                        </select>
                    </div>

                    <div class="flex items-center justify-between pt-1">
                        <div id="live-match-display" class="text-3xl font-black text-[#00F296] tracking-wider font-mono">${initialDisplay}</div>
                        <div class="flex items-center gap-2">
                            <button onclick="toggleLiveMatchTimer('${eventId}')" id="live-match-start-btn" class="bg-[#00F296] text-slate-950 font-black px-4 py-2 rounded-xl text-xs shadow flex items-center gap-1.5 transition">
                                ${active.isRunning ? '<i class="fa-solid fa-pause"></i> Pause' : '<i class="fa-solid fa-play"></i> Start'}
                            </button>
                            <button onclick="resetLiveMatchTimer('${eventId}')" class="bg-black/60 text-white hover:bg-black p-2 rounded-xl border border-white/20 transition">
                                <i class="fa-solid fa-rotate-right text-xs"></i>
                            </button>
                        </div>
                    </div>
                </div>

                <!-- Team Selection Row -->
                <div class="grid grid-cols-2 gap-3">
                    <div class="space-y-1">
                        <label class="block text-[9px] font-black text-white/60 uppercase">Team 1</label>
                        <select id="live-match-teamA" onchange="updateLiveMatchTeamNames('${eventId}')" class="w-full bg-black/80 border-2 rounded-xl px-3 py-2 text-white text-xs font-bold" style="border-color: ${colorA};">
                            ${teamNamesArr.map((t, i) => `<option value="${i}" ${i === idxA ? 'selected' : ''} ${i === idxB ? 'disabled' : ''}>${t}</option>`).join('')}
                        </select>
                    </div>
                    <div class="space-y-1">
                        <label class="block text-[9px] font-black text-white/60 uppercase">Team 2</label>
                        <select id="live-match-teamB" onchange="updateLiveMatchTeamNames('${eventId}')" class="w-full bg-black/80 border-2 rounded-xl px-3 py-2 text-white text-xs font-bold" style="border-color: ${colorB};">
                            ${teamNamesArr.map((t, i) => `<option value="${i}" ${i === idxB ? 'selected' : ''} ${i === idxA ? 'disabled' : ''}>${t}</option>`).join('')}
                        </select>
                    </div>
                </div>

                <!-- Score Cards (Styled with matching Team Colors) -->
                <div class="grid grid-cols-2 gap-4 text-center">
                    <div id="card-teamA-container" class="bg-black/40 border-2 rounded-2xl p-4 space-y-3 shadow-lg" style="border-color: ${colorA};">
                        <div class="flex items-center justify-center gap-1.5">
                            <i class="fa-solid fa-shirt text-xs" style="color: ${colorA};"></i>
                            <span id="label-teamA" class="text-xs font-bold text-white truncate max-w-[120px]">${active.teamA}</span>
                        </div>
                        <div id="score-teamA" class="text-5xl font-black" style="color: ${colorA};">${(active.team1Goals || []).length}</div>
                        <button onclick="openGoalScorerPicker('${eventId}', 'A')" class="w-full font-black py-2.5 rounded-xl text-xs shadow transition hover:opacity-90" style="background-color: ${colorA}33; color: ${colorA}; border: 1px solid ${colorA}66;">+ Goal</button>
                    </div>
                    <div id="card-teamB-container" class="bg-black/40 border-2 rounded-2xl p-4 space-y-3 shadow-lg" style="border-color: ${colorB};">
                        <div class="flex items-center justify-center gap-1.5">
                            <i class="fa-solid fa-shirt text-xs" style="color: ${colorB};"></i>
                            <span id="label-teamB" class="text-xs font-bold text-white truncate max-w-[120px]">${active.teamB}</span>
                        </div>
                        <div id="score-teamB" class="text-5xl font-black" style="color: ${colorB};">${(active.team2Goals || []).length}</div>
                        <button onclick="openGoalScorerPicker('${eventId}', 'B')" class="w-full font-black py-2.5 rounded-xl text-xs shadow transition hover:opacity-90" style="background-color: ${colorB}33; color: ${colorB}; border: 1px solid ${colorB}66;">+ Goal</button>
                    </div>
                </div>
            </div>

            <!-- Save & End Match -->
            <div class="space-y-2 pt-3 border-t border-white/10">
                <button onclick="saveLiveMatchResult('${eventId}')" class="w-full bg-gradient-to-r from-[#00F296] to-[#00B4AE] hover:opacity-95 text-slate-950 font-black py-3 rounded-xl text-xs uppercase tracking-wider shadow-md transition flex items-center justify-center gap-2">
                    <i class="fa-solid fa-futbol"></i> Save & End Match
                </button>
                <button onclick="document.getElementById('start-match-screen-modal').remove()" class="w-full bg-black/60 text-white/60 hover:text-white py-2 rounded-xl text-xs font-bold transition">
                    Close
                </button>
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
            syncLiveMatchState(eventId, event.liveMatchActive);
            playMatchEndAlarm();
            if (typeof window.showToast === 'function') {
                window.showToast("⏰ Time's up! Match ended.", "info");
            }
            window.saveLiveMatchResult(eventId);
        }
    };

    updateDisplay();
    window.liveMatchTimerInterval = setInterval(updateDisplay, 1000);
}

window.setLiveMatchMode = async function(eventId, mode) {
    window.liveMatchMode = mode;
    const stopwatchBtn = document.getElementById('mode-stopwatch-btn');
    const timerBtn = document.getElementById('mode-timer-btn');
    const settingsRow = document.getElementById('timer-settings-row');

    const dur = parseInt(document.getElementById('live-match-duration-select')?.value || '10', 10) * 60;

    if (mode === 'stopwatch') {
        stopwatchBtn.className = "py-2 rounded-lg text-[10px] font-black uppercase transition bg-[#00F296] text-slate-950 shadow";
        timerBtn.className = "py-2 rounded-lg text-[10px] font-black uppercase transition text-white/60 hover:text-white";
        settingsRow.classList.add('hidden');
    } else {
        timerBtn.className = "py-2 rounded-lg text-[10px] font-black uppercase transition bg-[#00F296] text-slate-950 shadow";
        stopwatchBtn.className = "py-2 rounded-lg text-[10px] font-black uppercase transition text-white/60 hover:text-white";
        settingsRow.classList.remove('hidden');
    }

    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event) return;

    event.liveMatchActive = {
        ...event.liveMatchActive,
        mode: mode,
        isRunning: false,
        durationSeconds: dur,
        elapsedSeconds: mode === 'stopwatch' ? 0 : dur,
        lastUpdatedTimestamp: Date.now()
    };

    await syncLiveMatchState(eventId, event.liveMatchActive);
    startLiveMatchInterval(eventId);
};

window.updateLiveMatchDuration = async function(eventId, mins) {
    const dur = (parseInt(mins, 10) || 10) * 60;
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event || !event.liveMatchActive) return;

    if (!event.liveMatchActive.isRunning) {
        event.liveMatchActive.durationSeconds = dur;
        event.liveMatchActive.elapsedSeconds = dur;
        event.liveMatchActive.lastUpdatedTimestamp = Date.now();
        await syncLiveMatchState(eventId, event.liveMatchActive);
        startLiveMatchInterval(eventId);
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

    const startBtn = document.getElementById('live-match-start-btn');
    if (startBtn) {
        startBtn.innerHTML = active.isRunning ? '<i class="fa-solid fa-pause"></i> Pause' : '<i class="fa-solid fa-play"></i> Start';
    }

    await syncLiveMatchState(eventId, active);
    startLiveMatchInterval(eventId);
};

window.resetLiveMatchTimer = async function(eventId) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event || !event.liveMatchActive) return;

    const active = event.liveMatchActive;
    active.isRunning = false;
    active.elapsedSeconds = active.mode === 'stopwatch' ? 0 : active.durationSeconds;
    active.lastUpdatedTimestamp = Date.now();

    const startBtn = document.getElementById('live-match-start-btn');
    if (startBtn) startBtn.innerHTML = '<i class="fa-solid fa-play"></i> Start';

    await syncLiveMatchState(eventId, active);
    startLiveMatchInterval(eventId);
};

async function syncLiveMatchState(eventId, activeState) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event) return;

    event.liveMatchActive = activeState;
    try {
        await setDoc(doc(db, 'artifacts', appId, 'eventsList', eventId), { liveMatchActive: activeState }, { merge: true });
    } catch (e) {
        console.error("Failed to sync live match timestamp:", e);
    }
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

window.openGoalScorerPicker = function(eventId, teamKey) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event || !event.liveMatchActive) return;

    let teamName = teamKey === 'A' ? event.liveMatchActive.teamA : event.liveMatchActive.teamB;
    
    let assignedPlayers = [];
    const assignments = event.teamAssignments || window.teamAssignments?.[eventId] || {};
    const configuredNames = (window.teamNames && window.teamNames[eventId]) || event.teamNames || {};

    let teamIndex = teamKey === 'A' ? event.liveMatchActive.teamAIndex : event.liveMatchActive.teamBIndex;
    if (!Number.isInteger(teamIndex)) teamIndex = -1;
    for (let i = 0; teamIndex === -1 && i < (event.teamsCount || 3); i++) {
        const cName = configuredNames[i] || `Team ${i + 1}`;
        if (cName === teamName) {
            teamIndex = i;
            break;
        }
    }

    if (teamIndex !== -1) teamName = mmTeamNames(event)[teamIndex] || teamName;

    if (teamIndex !== -1 && assignments[teamIndex] && Array.isArray(assignments[teamIndex])) {
        assignedPlayers = assignments[teamIndex].filter(p => p && p.name);
    }

    if (assignedPlayers.length === 0) {
        // Fallback: check by iterating through assignments keys
        Object.entries(assignments).forEach(([tKey, roster]) => {
            const cName = configuredNames[tKey] || `Team ${parseInt(tKey) + 1}`;
            if (cName === teamName && Array.isArray(roster)) {
                roster.forEach(p => {
                    if (p && p.name && !assignedPlayers.some(ap => ap.name === p.name)) {
                        assignedPlayers.push(p);
                    }
                });
            }
        });
    }

    if (assignedPlayers.length === 0) {
        assignedPlayers = (event.attendees || []).map(a => ({ name: a.name || 'Player', avatar: a.avatar || a.photoURL }));
    }

    let picker = document.getElementById('goal-scorer-picker-modal');
    if (!picker) {
        picker = document.createElement('div');
        picker.id = 'goal-scorer-picker-modal';
        picker.className = 'fixed inset-0 z-[220] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm';
        document.body.appendChild(picker);
    }

    picker.innerHTML = `
        <div class="bg-[#040E13] border border-emerald-500/40 rounded-3xl max-w-xs w-full p-6 space-y-4 shadow-2xl text-white">
            <div class="flex items-center justify-between border-b border-white/10 pb-3">
                <h4 class="text-xs font-black uppercase text-white truncate">Goal Scorer (${teamName})</h4>
                <button onclick="document.getElementById('goal-scorer-picker-modal').remove()" class="text-white/50 hover:text-white text-lg font-bold"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="space-y-2 max-h-60 overflow-y-auto pr-1">
                ${assignedPlayers.map(p => `
                    <div onclick="recordLiveGoal('${eventId}', '${teamKey}', '${(p.name || 'Player').replace(/'/g, "\\'")}')" class="flex items-center gap-3 p-3 bg-black/40 hover:bg-black rounded-xl cursor-pointer transition border border-white/10">
                        <img src="${p.avatar || 'https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg'}" class="w-7 h-7 rounded-full object-cover" onerror="this.src='https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg'">
                        <span class="text-xs font-bold text-white">${p.name}</span>
                    </div>
                `).join('')}
            </div>
            <button onclick="document.getElementById('goal-scorer-picker-modal').remove()" class="w-full bg-black/60 text-white py-2.5 rounded-xl text-xs font-bold border border-white/20">Cancel</button>
        </div>
    `;
};

window.recordLiveGoal = async function(eventId, teamKey, scorerName) {
    const picker = document.getElementById('goal-scorer-picker-modal');
    if (picker) picker.remove();

    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event || !event.liveMatchActive) return;

    event.liveMatchActive.team1Goals = Array.isArray(event.liveMatchActive.team1Goals) ? event.liveMatchActive.team1Goals : [];
    event.liveMatchActive.team2Goals = Array.isArray(event.liveMatchActive.team2Goals) ? event.liveMatchActive.team2Goals : [];

    if (teamKey === 'A') {
        event.liveMatchActive.team1Goals.push(scorerName);
        document.getElementById('score-teamA').innerText = event.liveMatchActive.team1Goals.length;
    } else {
        event.liveMatchActive.team2Goals.push(scorerName);
        document.getElementById('score-teamB').innerText = event.liveMatchActive.team2Goals.length;
    }

    await syncLiveMatchState(eventId, event.liveMatchActive);
    if (typeof window.showToast === 'function') {
        window.showToast(`⚽ Goal! ${scorerName}`);
    }
};

window.saveLiveMatchResult = async function(eventId) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event || !event.liveMatchActive) return;

    let matches = Array.isArray(event.matches) ? [...event.matches] : [];
    const live = event.liveMatchActive;
    const namesNow = mmTeamNames(event);
    const colorsNow = mmTeamColors(event);
    const iA = Number.isInteger(live.teamAIndex) ? live.teamAIndex : namesNow.indexOf(live.teamA);
    const iB = Number.isInteger(live.teamBIndex) ? live.teamBIndex : namesNow.indexOf(live.teamB);
    matches.push({
        teamA: iA >= 0 ? namesNow[iA] : live.teamA,
        teamB: iB >= 0 ? namesNow[iB] : live.teamB,
        teamAIndex: iA >= 0 ? iA : null,
        teamBIndex: iB >= 0 ? iB : null,
        teamAColor: iA >= 0 ? colorsNow[iA] : (live.teamAColor || null),
        teamBColor: iB >= 0 ? colorsNow[iB] : (live.teamBColor || null),
        team1Goals: event.liveMatchActive.team1Goals || [],
        team2Goals: event.liveMatchActive.team2Goals || [],
        isFinished: true,
        timestamp: new Date().toISOString()
    });

    try {
        await setDoc(doc(db, 'artifacts', appId, 'eventsList', eventId), {
            matches,
            liveMatchActive: null
        }, { merge: true });
        window.showToast("Match saved and recorded!");
        const modal = document.getElementById('start-match-screen-modal');
        if (modal) modal.remove();
    } catch (e) {
        window.showToast("Failed to save match result", "error");
    }
};

window.discardLiveMatch = async function(eventId) {
    if (!confirm("Are you sure you want to discard this live match?")) return;
    try {
        await setDoc(doc(db, 'artifacts', appId, 'eventsList', eventId), {
            liveMatchActive: null
        }, { merge: true });
        window.showToast("Live match discarded.");
    } catch (e) {
        window.showToast("Failed to discard match", "error");
    }
};