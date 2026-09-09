// js/game-profile/info-tab.js: Renders the core game info summary tab
export function renderInfoTab(event) {
    const organizerName = event.organizer || 'Organizer';
    const organizerAvatar = event.organizerAvatar || 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100';
    const organizerId = event.organizerId;

    return `
        <div class="space-y-6">
            <!-- Organizer Banner Card (Clickable Profile View) -->
            <div class="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex items-center justify-between">
                <div onclick="openPlayerProfileModal('${organizerId}', '${organizerName.replace(/'/g, "\\'")}', '${organizerAvatar}')" class="flex items-center gap-3.5 cursor-pointer group">
                    <img src="${organizerAvatar}" class="w-12 h-12 rounded-full object-cover border-2 border-brand shadow-sm group-hover:scale-105 transition">
                    <div>
                        <div class="text-[10px] font-black uppercase text-amber-600 tracking-wider flex items-center gap-1">
                            <i class="fa-solid fa-crown"></i> Organizer
                        </div>
                        <h4 class="text-sm font-black text-slate-900 group-hover:text-brand transition mt-0.5">${organizerName}</h4>
                    </div>
                </div>
            </div>

            <!-- Date & Time Grid -->
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div class="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-1">
                    <span class="text-[10px] font-black text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                        <i class="fa-solid fa-calendar-days text-brand"></i> Date
                    </span>
                    <p class="text-sm font-black text-slate-900">${event.date || 'TBD'}</p>
                </div>
                <div class="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-1">
                    <span class="text-[10px] font-black text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                        <i class="fa-solid fa-clock text-brand"></i> Time
                    </span>
                    <p class="text-sm font-black text-slate-900">${event.time || 'TBD'}</p>
                </div>
            </div>

            <!-- Location & Navigation Bar -->
            <div class="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex items-center justify-between gap-4">
                <div class="space-y-1 truncate pr-2">
                    <span class="text-[10px] font-black text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                        <i class="fa-solid fa-location-dot text-brand"></i> Location
                    </span>
                    <p class="text-sm font-black text-slate-900 truncate">${event.location || 'Park location TBD'}</p>
                </div>
                <button onclick="window.open('https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location || '')}', '_blank')" class="bg-brand hover:bg-brand-dark text-slate-950 font-black px-4 py-2.5 rounded-xl text-xs shadow transition flex items-center gap-2 shrink-0">
                    <i class="fa-solid fa-location-arrow"></i> Navigate
                </button>
            </div>

            <!-- Game Type & Teams Count -->
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div class="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-1">
                    <span class="text-[10px] font-black text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                        <i class="fa-solid fa-futbol text-brand"></i> Game Type & Format
                    </span>
                    <p class="text-sm font-black text-slate-900">${event.format || '7v7'}</p>
                </div>
                <div class="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-1">
                    <span class="text-[10px] font-black text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                        <i class="fa-solid fa-users text-brand"></i> Amount of Teams
                    </span>
                    <p class="text-sm font-black text-slate-900">${event.teamsCount || 3} Teams</p>
                </div>
            </div>

            <!-- Description & Rules if present -->
            ${event.description ? `
                <div class="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-1.5">
                    <span class="text-[10px] font-black text-slate-400 uppercase tracking-wider">Description & Overview</span>
                    <p class="text-xs text-slate-700 leading-relaxed font-medium">${event.description}</p>
                </div>
            ` : ''}

            ${event.rules ? `
                <div class="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-1.5">
                    <span class="text-[10px] font-black text-slate-400 uppercase tracking-wider">Rules & Guidelines</span>
                    <p class="text-xs text-slate-700 leading-relaxed font-medium">${event.rules}</p>
                </div>
            ` : ''}
        </div>
    `;
};