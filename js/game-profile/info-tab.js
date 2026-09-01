// js/game-profile/info-tab.js
export function renderInfoTab(event) {
    const isAttendee = (event.attendees || []).some(a => a.uid === window.currentUser?.uid);
    const isSessionEnded = event.isSessionEnded || false;

    // Convert Date format from YYYY-MM-DD (or similar) to MM/DD/YYYY
    let formattedDate = event.date;
    if (event.date && event.date.includes('-')) {
        const parts = event.date.split('-');
        if (parts.length === 3) {
            formattedDate = `${parts[1]}/${parts[2]}/${parts[0]}`;
        }
    }

    // Convert Time from 24-hour military (e.g. 20:00) to 12-hour standard format (e.g. 8:00 PM)
    let formattedTime = event.time;
    if (event.time && event.time.includes(':')) {
        const [hourStr, minuteStr] = event.time.split(':');
        let hour = parseInt(hourStr, 10);
        if (!isNaN(hour)) {
            const ampm = hour >= 12 ? 'PM' : 'AM';
            hour = hour % 12;
            hour = hour ? hour : 12; // the hour '0' should be '12'
            formattedTime = `${hour}:${minuteStr} ${ampm}`;
        }
    }

    return `
        <div class="space-y-4">
            ${isSessionEnded ? `
                <div class="bg-emerald-50 border-2 border-emerald-400 rounded-2xl p-5 text-center space-y-3 shadow-md">
                    <div class="text-xs font-black text-emerald-700 uppercase tracking-widest"><i class="fa-solid fa-trophy mr-1"></i> Session Winner Announced!</div>
                    ${(() => {
                        const teamsCount = event.teamsCount || 3;
                        const stats = {};
                        for(let i=0; i<teamsCount; i++) {
                            const tName = (window.teamNames && window.teamNames[event.id] && window.teamNames[event.id][i]) || `Team ${i + 1}`;
                            stats[i] = { index: i, name: tName, points: 0, gf: 0, ga: 0 };
                        }
                        (event.matches || []).forEach(m => {
                            if (!m.isFinished) return;
                            const t1Score = (m.team1Goals || []).length;
                            const t2Score = (m.team2Goals || []).length;
                            let t1Idx = 0, t2Idx = 1;
                            for (let i = 0; i < teamsCount; i++) {
                                const cName = (window.teamNames && window.teamNames[event.id] && window.teamNames[event.id][i]) || `Team ${i + 1}`;
                                if (m.teamA === cName) t1Idx = i;
                                if (m.teamB === cName) t2Idx = i;
                            }
                            if (stats[t1Idx] && stats[t2Idx]) {
                                stats[t1Idx].gf += t1Score; stats[t1Idx].ga += t2Score;
                                stats[t2Idx].gf += t2Score; stats[t2Idx].ga += t1Score;
                                if (t1Score > t2Score) { stats[t1Idx].points += 3; }
                                else if (t2Score > t1Score) { stats[t2Idx].points += 3; }
                                else { stats[t1Idx].points += 1; stats[t2Idx].points += 1; }
                            }
                        });
                        const sorted = Object.values(stats).sort((a,b) => {
                            if (b.points !== a.points) return b.points - a.points;
                            return (b.gf - b.ga) - (a.gf - a.ga);
                        });
                        const winner = sorted[0];
                        if (!winner) return `<div class="text-sm font-bold text-emerald-800">Session finalized.</div>`;

                        const winningPlayers = (window.teamAssignments && window.teamAssignments[event.id] && window.teamAssignments[event.id][winner.index]) || [];

                        return `
                            <div class="text-xl font-black text-emerald-950">${winner.name} Crowned Session Champions (${winner.points} pts)! 🏆</div>
                            <div class="flex items-center justify-center gap-2 pt-1 flex-wrap">
                                ${winningPlayers.map(p => `
                                    <div class="flex items-center gap-1.5 bg-white border border-emerald-300 px-2.5 py-1 rounded-full shadow-xs">
                                        <img src="${p.avatar || 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100'}" class="w-6 h-6 rounded-full object-cover border border-emerald-400">
                                        <span class="text-xs font-bold text-slate-900">${p.name.split(' ')[0]}</span>
                                    </div>
                                `).join('')}
                            </div>
                        `;
                    })()}
                </div>
            ` : ''}

            <div class="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex items-center justify-between">
                <div class="flex items-center gap-3 cursor-pointer group" onclick="viewPlayerProfile('${event.organizerId || ''}', '${event.organizer}')">
                    <img src="${event.organizerAvatar || 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100'}" class="w-10 h-10 rounded-full object-cover border border-slate-300 shadow-sm group-hover:border-brand transition">
                    <div>
                        <div class="text-[10px] font-bold text-slate-400 uppercase">👑 Organizer (Click to Connect)</div>
                        <div class="text-sm font-black text-slate-900 group-hover:text-brand transition">${event.organizer}</div>
                    </div>
                </div>
                ${isAttendee ? `<button onclick="handleRSVPAction('${event.id}', 'cancel')" class="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 px-4 py-2 rounded-xl text-xs font-bold">❌ Cancel (RSVP No)</button>` : `<button onclick="handleRSVPAction('${event.id}', 'join')" class="bg-brand hover:bg-brand-dark text-slate-950 font-black px-5 py-2.5 rounded-xl text-xs shadow">⚽ Join Game</button>`}
            </div>

            <div class="grid grid-cols-2 gap-4">
                <div class="bg-slate-50 border border-slate-200 p-4 rounded-2xl space-y-1">
                    <div class="text-[10px] font-bold text-slate-400 uppercase">📅 Date</div>
                    <div class="text-sm font-black text-slate-900">${formattedDate}</div>
                </div>
                <div class="bg-slate-50 border border-slate-200 p-4 rounded-2xl space-y-1">
                    <div class="text-[10px] font-bold text-slate-400 uppercase">⏰ Time</div>
                    <div class="text-sm font-black text-slate-900">${formattedTime}</div>
                </div>
            </div>

            <div class="bg-slate-50 border border-slate-200 p-4 rounded-2xl flex items-center justify-between gap-3">
                <div class="overflow-hidden">
                    <div class="text-[10px] font-bold text-slate-400 uppercase">📍 Location</div>
                    <div class="text-xs font-black text-slate-900 mt-0.5 truncate">${event.location}</div>
                </div>
                <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location)}" target="_blank" class="bg-brand hover:bg-brand-dark text-slate-950 font-black px-4 py-2.5 rounded-xl text-xs flex items-center gap-2 shadow shrink-0 transition">
                    <i class="fa-solid fa-location-arrow"></i> Navigate
                </a>
            </div>

            <div class="grid grid-cols-2 gap-4">
                <div class="bg-slate-50 border border-slate-200 p-4 rounded-2xl space-y-1">
                    <div class="text-[10px] font-bold text-slate-400 uppercase">⚽ Game Type & Format</div>
                    <div class="text-sm font-black text-slate-900">${event.format || '7v7'}</div>
                </div>
                <div class="bg-slate-50 border border-slate-200 p-4 rounded-2xl space-y-1">
                    <div class="text-[10px] font-bold text-slate-400 uppercase">👥 Amount of Teams</div>
                    <div class="text-sm font-black text-slate-900">${event.teamsCount || 3} Teams</div>
                </div>
            </div>
        </div>
    `;
}