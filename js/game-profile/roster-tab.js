// js/game-profile/roster-tab.js
export function renderRosterTab(event) {
    const attendees = event.attendees || [];
    const maxCapacity = event.maxCapacity || 14;

    return `
        <div class="space-y-4">
            <div class="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex items-center justify-between">
                <div>
                    <h4 class="text-xs font-black text-slate-900 uppercase">Match Roster (${attendees.length}/${maxCapacity})</h4>
                    <p class="text-[11px] text-slate-500">Confirmed players and team lineup manager.</p>
                </div>
                <button onclick="openTeamMakingModal('${event.id}')" class="bg-brand hover:bg-brand-dark text-slate-950 font-black px-4 py-2.5 rounded-xl text-xs shadow transition flex items-center gap-2">
                    <i class="fa-solid fa-shield-halved"></i> Team Building Tool
                </button>
            </div>

            <div class="bg-white border border-slate-200 rounded-2xl p-4 space-y-3 shadow-sm">
                <h4 class="text-xs font-black text-slate-900 uppercase tracking-wider">Confirmed Attendees</h4>
                <div class="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
                    ${attendees.length === 0 ? '<div class="text-center text-xs text-slate-400 py-8">No players confirmed yet. Be the first to join!</div>' : ''}
                    ${attendees.map(att => {
                        const isPaid = att.paid === 'Paid';
                        return `
                            <div class="flex items-center justify-between bg-slate-50 border border-slate-200 p-3 rounded-xl shadow-xs">
                                <div class="flex items-center gap-3 cursor-pointer group" onclick="viewPlayerProfile('${att.uid}', '${att.name.replace(/'/g, "\\'")}')">
                                    <img src="${att.avatar || 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100'}" class="w-8 h-8 rounded-full object-cover border border-slate-300 group-hover:border-brand transition">
                                    <div>
                                        <div class="text-xs font-bold text-slate-900 group-hover:text-brand transition">${att.name}</div>
                                        <div class="text-[10px] text-slate-500">${att.position || 'Player'}</div>
                                    </div>
                                </div>
                                <div class="flex items-center gap-2">
                                    <span class="text-[10px] font-bold px-2.5 py-1 rounded-full ${isPaid ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' : 'bg-slate-200 text-slate-700'} flex items-center shadow-xs">
                                        ${isPaid ? '<i class="fa-solid fa-dollar-sign text-emerald-600 mr-1"></i>' : ''}Confirmed
                                    </span>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        </div>
    `;
}