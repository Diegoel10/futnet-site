// js/home.js: Handles the dedicated Home Hub screen
window.renderHomeScreen = function() {
    const homeContainer = document.getElementById('tab-home');
    if (!homeContainer) return;

    homeContainer.innerHTML = `
        <div class="space-y-6">
            <!-- Welcome Banner -->
            <div class="bg-gradient-to-r from-brand/20 to-[#0f1523] border border-brand/30 rounded-2xl p-6 shadow-xl">
                <h1 class="text-2xl font-black text-white">Welcome back, ${window.userProfile?.firstName || 'Player'}! ⚽</h1>
                <p class="text-slate-400 text-xs mt-1">Ready to organize your next match or check your squad?</p>
            </div>

            <!-- Quick Action Cards Grid -->
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div onclick="switchTab('events')" class="bg-[#0f1523] border border-slate-800 hover:border-brand/50 p-5 rounded-2xl cursor-pointer transition shadow-lg space-y-2">
                    <div class="w-10 h-10 bg-brand/10 text-brand rounded-xl flex items-center justify-center font-bold">
                        <i class="fa-solid fa-calendar-days text-base"></i>
                    </div>
                    <h3 class="text-sm font-black text-white">Browse Games</h3>
                    <p class="text-slate-400 text-xs">Find upcoming matches, view rosters, and join teams.</p>
                </div>

                <div onclick="toggleCreateEventModal(true)" class="bg-[#0f1523] border border-slate-800 hover:border-brand/50 p-5 rounded-2xl cursor-pointer transition shadow-lg space-y-2">
                    <div class="w-10 h-10 bg-emerald-500/10 text-emerald-400 rounded-xl flex items-center justify-center font-bold">
                        <i class="fa-solid fa-plus text-base"></i>
                    </div>
                    <h3 class="text-sm font-black text-white">Create a Match</h3>
                    <p class="text-slate-400 text-xs">Set up a new park game, pick a format, and invite your squad.</p>
                </div>
            </div>
        </div>
    `;
};