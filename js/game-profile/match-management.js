// js/game-profile/match-management.js: Dedicated screen for live match tracking and score management
import { db, appId } from '../firebase-config.js';
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

window.openStartMatchScreen = function(eventId) {
    let modal = document.getElementById('start-match-screen-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'start-match-screen-modal';
        modal.className = 'fixed inset-0 z-[130] flex flex-col justify-end bg-black/80 backdrop-blur-sm animate-in fade-in duration-200';
        document.body.appendChild(modal);
    }

    modal.innerHTML = `
        <div class="bg-[#040E13] border-t border-emerald-500/40 rounded-t-[32px] p-6 space-y-5 max-w-lg w-full mx-auto shadow-2xl text-white max-h-[90vh] overflow-y-auto" onclick="event.stopPropagation()">
            <div class="w-12 h-1.5 bg-white/20 rounded-full mx-auto mb-2"></div>
            <div class="flex items-center justify-between border-b border-white/10 pb-3">
                <div>
                    <h3 class="text-base font-black text-white uppercase tracking-wider">Manage Live Match</h3>
                    <p class="text-[10px] text-white/50">Track scores, timer, and match results.</p>
                </div>
                <button onclick="document.getElementById('start-match-screen-modal').remove()" class="text-white/50 hover:text-white text-sm font-bold"><i class="fa-solid fa-xmark text-lg"></i></button>
            </div>

            <!-- Team Selection Row -->
            <div class="grid grid-cols-2 gap-3">
                <div class="space-y-1">
                    <label class="block text-[9px] font-black text-white/60 uppercase">Team 1</label>
                    <select id="live-match-teamA" class="w-full bg-black border border-teal-500/50 rounded-xl px-3 py-2 text-white text-xs" style="background-color: #000000 !important; color: #ffffff !important;">
                        <option value="Blue Team">Blue Team</option>
                        <option value="Red Team">Red Team</option>
                        <option value="Yellow Team">Yellow Team</option>
                        <option value="Green Team">Green Team</option>
                    </select>
                </div>
                <div class="space-y-1">
                    <label class="block text-[9px] font-black text-white/60 uppercase">Team 2</label>
                    <select id="live-match-teamB" class="w-full bg-black border border-teal-500/50 rounded-xl px-3 py-2 text-white text-xs" style="background-color: #000000 !important; color: #ffffff !important;">
                        <option value="Red Team" selected>Red Team</option>
                        <option value="Blue Team">Blue Team</option>
                        <option value="Yellow Team">Yellow Team</option>
                        <option value="Green Team">Green Team</option>
                    </select>
                </div>
            </div>

            <!-- Score Cards -->
            <div class="grid grid-cols-2 gap-4 text-center">
                <div class="bg-black/40 border border-emerald-500/40 rounded-2xl p-4 space-y-3">
                    <div id="label-teamA" class="text-xs font-bold text-white">Blue Team</div>
                    <div id="score-teamA" class="text-4xl font-black text-[#00F296]">0</div>
                    <button onclick="addLiveGoal('A')" class="w-full bg-emerald-500/20 hover:bg-emerald-500/30 text-[#00F296] border border-emerald-500/40 font-black py-2 rounded-xl text-xs">+ Goal</button>
                </div>
                <div class="bg-black/40 border border-emerald-500/40 rounded-2xl p-4 space-y-3">
                    <div id="label-teamB" class="text-xs font-bold text-white">Red Team</div>
                    <div id="score-teamB" class="text-4xl font-black text-red-400">0</div>
                    <button onclick="addLiveGoal('B')" class="w-full bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/40 font-black py-2 rounded-xl text-xs">+ Goal</button>
                </div>
            </div>

            <!-- Save & End Match -->
            <button onclick="saveLiveMatchResult('${eventId}')" class="w-full bg-gradient-to-r from-[#00F296] to-[#00B4AE] hover:opacity-95 text-slate-950 font-black py-3.5 rounded-xl text-xs uppercase tracking-wider shadow-md transition">
                Save & End Match
            </button>
        </div>
    `;

    window.liveMatchState = { team1Goals: [], team2Goals: [] };
};

window.addLiveGoal = function(teamKey) {
    const scorer = prompt("Enter goal scorer name:") || "Player";
    if (teamKey === 'A') {
        window.liveMatchState.team1Goals.push(scorer);
        document.getElementById('score-teamA').innerText = window.liveMatchState.team1Goals.length;
    } else {
        window.liveMatchState.team2Goals.push(scorer);
        document.getElementById('score-teamB').innerText = window.liveMatchState.team2Goals.length;
    }
};

window.saveLiveMatchResult = async function(eventId) {
    const teamA = document.getElementById('live-match-teamA').value;
    const teamB = document.getElementById('live-match-teamB').value;

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
        document.getElementById('start-match-screen-modal').remove();
    } catch (e) {
        window.showToast("Failed to save match result", "error");
    }
};