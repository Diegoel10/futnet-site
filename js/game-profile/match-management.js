// js/game-profile/match-management.js: Full live match tracker with browser web audio alarm synthesizer
import { db, appId } from '../firebase-config.js';
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

window.liveMatchTimerInterval = null;
window.liveMatchSeconds = 0;
window.liveMatchIsRunning = false;
window.liveMatchMode = 'timer'; // 'stopwatch' or 'timer'
window.liveMatchDurationMinutes = 10;
window.liveMatchAlarmEnabled = true;

window.openStartMatchScreen = function(eventId) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event) return;

    let modal = document.getElementById('start-match-screen-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'start-match-screen-modal';
        modal.className = 'fixed inset-0 z-[130] flex flex-col justify-end bg-black/85 backdrop-blur-md animate-in fade-in duration-200';
        document.body.appendChild(modal);
    }

    const teamsCount = event.teamsCount || 3;
    const teamNamesArr = [];
    for (let i = 0; i < teamsCount; i++) {
        const tName = (event.teamNames && event.teamNames[i]) || `Team ${i + 1}`;
        teamNamesArr.push(tName);
    }

    const defaultTeamA = teamNamesArr[0] || 'Team 1';
    const defaultTeamB = teamNamesArr[1] || 'Team 2';

    window.liveMatchState = {
        teamA: defaultTeamA,
        teamB: defaultTeamB,
        team1Goals: [],
        team2Goals: []
    };

    window.liveMatchMode = 'timer';
    window.liveMatchSeconds = 10 * 60;
    window.liveMatchIsRunning = false;
    if (window.liveMatchTimerInterval) clearInterval(window.liveMatchTimerInterval);

    modal.innerHTML = `
        <div class="bg-[#040E13] border-t border-[#00B4AE]/50 rounded-t-[32px] p-5 space-y-4 max-w-lg w-full mx-auto shadow-2xl text-white h-[92vh] flex flex-col justify-between overflow-y-auto" onclick="event.stopPropagation()">
            <div class="space-y-4">
                <div class="w-12 h-1.5 bg-white/20 rounded-full mx-auto mb-1"></div>
                <div class="flex items-center justify-between border-b border-white/10 pb-2.5">
                    <div>
                        <h3 class="text-base font-black text-white uppercase tracking-wider flex items-center gap-2">
                            Manage Live Match
                        </h3>
                        <p class="text-[10px] text-white/50">Track scores, timer, and match results.</p>
                    </div>
                    <button onclick="document.getElementById('start-match-screen-modal').remove()" class="text-white/50 hover:text-white text-sm font-bold"><i class="fa-solid fa-xmark text-lg"></i></button>
                </div>

                <!-- Timer / Stopwatch Control Box -->
                <div class="bg-black/50 border border-[#00B4AE]/40 rounded-2xl p-3.5 space-y-3 shadow-inner">
                    <div class="grid grid-cols-2 gap-2 bg-black/60 p-1 rounded-xl border border-white/10">
                        <button onclick="setLiveMatchMode('stopwatch')" id="mode-stopwatch-btn" class="py-1.5 rounded-lg text-[10px] font-black uppercase transition text-white/60 hover:text-white">
                            <i class="fa-solid fa-stopwatch mr-1"></i> Stopwatch (Up)
                        </button>
                        <button onclick="setLiveMatchMode('timer')" id="mode-timer-btn" class="py-1.5 rounded-lg text-[10px] font-black uppercase transition bg-[#00F296] text-slate-950 shadow">
                            <i class="fa-solid fa-hourglass-half mr-1"></i> Timer (Down)
                        </button>
                    </div>

                    <div id="timer-settings-row" class="flex items-center justify-between text-xs px-1">
                        <span class="text-white/60 font-bold uppercase text-[10px]">Duration:</span>
                        <select id="live-match-duration-select" onchange="updateLiveMatchDuration(this.value)" class="bg-black/80 text-white font-bold text-xs px-3 py-1 rounded-xl border border-white/20">
                            <option value="5">5 min</option>
                            <option value="10" selected>10 min</option>
                            <option value="15">15 min</option>
                            <option value="20">20 min</option>
                        </select>
                    </div>

                    <div class="flex items-center justify-between text-xs px-1">
                        <span class="text-white/60 font-bold uppercase text-[10px]">Play alarm at 0'</span>
                        <input type="checkbox" id="live-match-alarm-toggle" checked onchange="window.liveMatchAlarmEnabled = this.checked" class="w-4 h-4 accent-[#00F296] cursor-pointer">
                    </div>

                    <div class="flex items-center justify-between pt-1">
                        <div id="live-match-display" class="text-3xl font-black text-[#00F296] tracking-wider font-mono">10:00</div>
                        <div class="flex items-center gap-2">
                            <button onclick="toggleLiveMatchTimer()" id="live-match-start-btn" class="bg-[#00F296] text-slate-950 font-black px-4 py-2 rounded-xl text-xs shadow flex items-center gap-1.5 transition">
                                <i class="fa-solid fa-play"></i> Start
                            </button>
                            <button onclick="resetLiveMatchTimer()" class="bg-black/60 text-white hover:bg-black p-2.5 rounded-xl border border-white/20 transition">
                                <i class="fa-solid fa-rotate-right text-xs"></i>
                            </button>
                        </div>
                    </div>
                </div>

                <!-- Team Selection Row -->
                <div class="grid grid-cols-2 gap-3">
                    <div class="space-y-1">
                        <label class="block text-[9px] font-black text-white/60 uppercase">Team 1</label>
                        <select id="live-match-teamA" onchange="updateLiveMatchTeamNames()" class="w-full bg-black/80 border border-teal-500/50 rounded-xl px-3 py-2 text-white text-xs font-bold">
                            ${teamNamesArr.map(t => `<option value="${t}">${t}</option>`).join('')}
                        </select>
                    </div>
                    <div class="space-y-1">
                        <label class="block text-[9px] font-black text-white/60 uppercase">Team 2</label>
                        <select id="live-match-teamB" onchange="updateLiveMatchTeamNames()" class="w-full bg-black/80 border border-red-500/50 rounded-xl px-3 py-2 text-white text-xs font-bold">
                            ${teamNamesArr.map((t, i) => `<option value="${t}" ${i === 1 ? 'selected' : ''}>${t}</option>`).join('')}
                        </select>
                    </div>
                </div>

                <!-- Score Cards -->
                <div class="grid grid-cols-2 gap-4 text-center">
                    <div class="bg-black/40 border-2 border-emerald-500/40 rounded-2xl p-4 space-y-3 shadow-lg">
                        <div class="flex items-center justify-center gap-1.5">
                            <i class="fa-solid fa-shirt text-[#00F296] text-xs"></i>
                            <span id="label-teamA" class="text-xs font-bold text-white truncate max-w-[120px]">${defaultTeamA}</span>
                        </div>
                        <div id="score-teamA" class="text-5xl font-black text-[#00F296]">0</div>
                        <button onclick="openGoalScorerPicker('${eventId}', 'A')" class="w-full bg-emerald-500/20 hover:bg-emerald-500/30 text-[#00F296] border border-emerald-500/40 font-black py-2.5 rounded-xl text-xs shadow">+ Goal</button>
                    </div>
                    <div class="bg-black/40 border-2 border-red-500/40 rounded-2xl p-4 space-y-3 shadow-lg">
                        <div class="flex items-center justify-center gap-1.5">
                            <i class="fa-solid fa-shirt text-red-400 text-xs"></i>
                            <span id="label-teamB" class="text-xs font-bold text-white truncate max-w-[120px]">${defaultTeamB}</span>
                        </div>
                        <div id="score-teamB" class="text-5xl font-black text-red-400">0</div>
                        <button onclick="openGoalScorerPicker('${eventId}', 'B')" class="w-full bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/40 font-black py-2.5 rounded-xl text-xs shadow">+ Goal</button>
                    </div>
                </div>
            </div>

            <!-- Save & End Match -->
            <div class="space-y-2 pt-2">
                <button onclick="saveLiveMatchResult('${eventId}')" class="w-full bg-gradient-to-r from-[#00F296] to-[#00B4AE] hover:opacity-95 text-slate-950 font-black py-3.5 rounded-xl text-xs uppercase tracking-wider shadow-md transition flex items-center justify-center gap-2">
                    <i class="fa-solid fa-futbol"></i> Save & End Match
                </button>
                <button onclick="document.getElementById('start-match-screen-modal').remove()" class="w-full bg-black/60 text-white/60 hover:text-white py-2 rounded-xl text-xs font-bold transition">
                    Close
                </button>
            </div>
        </div>
    `;
};

window.setLiveMatchMode = function(mode) {
    window.liveMatchMode = mode;
    const stopwatchBtn = document.getElementById('mode-stopwatch-btn');
    const timerBtn = document.getElementById('mode-timer-btn');
    const settingsRow = document.getElementById('timer-settings-row');

    if (mode === 'stopwatch') {
        stopwatchBtn.className = "py-1.5 rounded-lg text-[10px] font-black uppercase transition bg-[#00F296] text-slate-950 shadow";
        timerBtn.className = "py-1.5 rounded-lg text-[10px] font-black uppercase transition text-white/60 hover:text-white";
        settingsRow.classList.add('hidden');
        window.liveMatchSeconds = 0;
    } else {
        timerBtn.className = "py-1.5 rounded-lg text-[10px] font-black uppercase transition bg-[#00F296] text-slate-950 shadow";
        stopwatchBtn.className = "py-1.5 rounded-lg text-[10px] font-black uppercase transition text-white/60 hover:text-white";
        settingsRow.classList.remove('hidden');
        const dur = parseInt(document.getElementById('live-match-duration-select').value, 10) || 10;
        window.liveMatchSeconds = dur * 60;
    }
    window.liveMatchIsRunning = false;
    if (window.liveMatchTimerInterval) clearInterval(window.liveMatchTimerInterval);
    document.getElementById('live-match-start-btn').innerHTML = '<i class="fa-solid fa-play"></i> Start';
    updateLiveMatchTimerDisplay();
};

window.updateLiveMatchDuration = function(mins) {
    const m = parseInt(mins, 10) || 10;
    window.liveMatchDurationMinutes = m;
    if (window.liveMatchMode === 'timer' && !window.liveMatchIsRunning) {
        window.liveMatchSeconds = m * 60;
        updateLiveMatchTimerDisplay();
    }
};

window.toggleLiveMatchTimer = function() {
    window.liveMatchIsRunning = !window.liveMatchIsRunning;
    const startBtn = document.getElementById('live-match-start-btn');

    if (window.liveMatchIsRunning) {
        startBtn.innerHTML = '<i class="fa-solid fa-pause"></i> Pause';
        window.liveMatchTimerInterval = setInterval(() => {
            if (window.liveMatchMode === 'stopwatch') {
                window.liveMatchSeconds++;
            } else {
                if (window.liveMatchSeconds > 0) {
                    window.liveMatchSeconds--;
                } else {
                    window.liveMatchIsRunning = false;
                    clearInterval(window.liveMatchTimerInterval);
                    startBtn.innerHTML = '<i class="fa-solid fa-play"></i> Start';
                    if (window.liveMatchAlarmEnabled) {
                        playAlarmSound();
                    }
                }
            }
            updateLiveMatchTimerDisplay();
        }, 1000);
    } else {
        startBtn.innerHTML = '<i class="fa-solid fa-play"></i> Start';
        clearInterval(window.liveMatchTimerInterval);
    }
};

window.resetLiveMatchTimer = function() {
    window.liveMatchIsRunning = false;
    if (window.liveMatchTimerInterval) clearInterval(window.liveMatchTimerInterval);
    document.getElementById('live-match-start-btn').innerHTML = '<i class="fa-solid fa-play"></i> Start';
    if (window.liveMatchMode === 'stopwatch') {
        window.liveMatchSeconds = 0;
    } else {
        const dur = parseInt(document.getElementById('live-match-duration-select')?.value || '10', 10);
        window.liveMatchSeconds = dur * 60;
    }
    updateLiveMatchTimerDisplay();
};

function updateLiveMatchTimerDisplay() {
    const displayEl = document.getElementById('live-match-display');
    if (!displayEl) return;
    const m = Math.floor(window.liveMatchSeconds / 60);
    const s = window.liveMatchSeconds % 60;
    displayEl.innerText = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function playAlarmSound() {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        const ctx = new AudioContext();

        for (let i = 0; i < 3; i++) {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            
            osc.type = 'square';
            osc.frequency.setValueAtTime(659.25, ctx.currentTime + (i * 0.25));
            
            gain.gain.setValueAtTime(0.2, ctx.currentTime + (i * 0.25));
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (i * 0.25) + 0.2);
            
            osc.connect(gain);
            gain.connect(ctx.destination);
            
            osc.start(ctx.currentTime + (i * 0.25));
            osc.stop(ctx.currentTime + (i * 0.25) + 0.2);
        }
    } catch (e) {
        console.warn("Audio Context blocked:", e);
    }
}

window.updateLiveMatchTeamNames = function() {
    const tA = document.getElementById('live-match-teamA').value;
    const tB = document.getElementById('live-match-teamB').value;
    window.liveMatchState.teamA = tA;
    window.liveMatchState.teamB = tB;
    document.getElementById('label-teamA').innerText = tA;
    document.getElementById('label-teamB').innerText = tB;
};

window.openGoalScorerPicker = function(eventId, teamKey) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event) return;

    const teamName = teamKey === 'A' ? window.liveMatchState.teamA : window.liveMatchState.teamB;
    
    let assignedPlayers = [];
    if (event.teamAssignments) {
        let tIdx = -1;
        if (event.teamNames) {
            tIdx = Object.keys(event.teamNames).find(k => event.teamNames[k] === teamName);
        }
        if (tIdx !== undefined && tIdx !== -1 && event.teamAssignments[tIdx]) {
            assignedPlayers = event.teamAssignments[tIdx].filter(p => p && p.name);
        }
    }

    if (assignedPlayers.length === 0) {
        assignedPlayers = (event.attendees || []).map(a => ({ name: a.name || 'Player' }));
    }

    let picker = document.getElementById('goal-scorer-picker-modal');
    if (!picker) {
        picker = document.createElement('div');
        picker.id = 'goal-scorer-picker-modal';
        picker.className = 'fixed inset-0 z-[140] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm';
        document.body.appendChild(picker);
    }

    picker.innerHTML = `
        <div class="bg-[#040E13] border border-emerald-500/40 rounded-3xl max-w-xs w-full p-6 space-y-4 shadow-2xl text-white">
            <div class="flex items-center justify-between border-b border-white/10 pb-3">
                <h4 class="text-xs font-black uppercase text-white truncate">Goal Scorer (${teamName})</h4>
                <button onclick="document.getElementById('goal-scorer-picker-modal').remove()" class="text-white/50 hover:text-white text-lg font-bold"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="space-y-2 max-h-60 overflow-y-auto pr-1">
                <div onclick="recordLiveGoal('${teamKey}', 'Unknown Scorer')" class="p-3 bg-black/40 hover:bg-black rounded-xl cursor-pointer text-xs font-bold text-white transition border border-white/10">
                    Unassigned / Team Goal
                </div>
                ${assignedPlayers.map(p => `
                    <div onclick="recordLiveGoal('${teamKey}', '${(p.name || 'Player').replace(/'/g, "\\'")}')" class="flex items-center gap-3 p-3 bg-black/40 hover:bg-black rounded-xl cursor-pointer transition border border-white/10">
                        <img src="${p.avatar || 'https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg'}" class="w-7 h-7 rounded-full object-cover">
                        <span class="text-xs font-bold text-white">${p.name}</span>
                    </div>
                `).join('')}
            </div>
            <button onclick="document.getElementById('goal-scorer-picker-modal').remove()" class="w-full bg-black/60 text-white py-2.5 rounded-xl text-xs font-bold border border-white/20">Cancel</button>
        </div>
    `;
};

window.recordLiveGoal = function(teamKey, scorerName) {
    const picker = document.getElementById('goal-scorer-picker-modal');
    if (picker) picker.remove();

    if (teamKey === 'A') {
        window.liveMatchState.team1Goals.push(scorerName);
        document.getElementById('score-teamA').innerText = window.liveMatchState.team1Goals.length;
    } else {
        window.liveMatchState.team2Goals.push(scorerName);
        document.getElementById('score-teamB').innerText = window.liveMatchState.team2Goals.length;
    }
    if (typeof window.showToast === 'function') {
        window.showToast(`⚽ Goal! ${scorerName}`);
    }
};

window.saveLiveMatchResult = async function(eventId) {
    const teamA = window.liveMatchState.teamA;
    const teamB = window.liveMatchState.teamB;

    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event) return;

    let matches = Array.isArray(event.matches) ? [...event.matches] : [];
    matches.push({
        teamA,
        teamB,
        team1Goals: window.liveMatchState.team1Goals,
        team2Goals: window.liveMatchState.team2Goals,
        timestamp: new Date().toISOString()
    });

    try {
        await setDoc(doc(db, 'artifacts', appId, 'eventsList', eventId), { matches }, { merge: true });
        window.showToast("Match saved and recorded!");
        const modal = document.getElementById('start-match-screen-modal');
        if (modal) modal.remove();
    } catch (e) {
        window.showToast("Failed to save match result", "error");
    }
};