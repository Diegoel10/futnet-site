// js/game-profile/comments-tab.js
export function renderCommentsTab(event) {
    const typingUsers = (event.typingUsers || []).filter(u => u.uid !== window.currentUser?.uid);
    let typingText = "";
    if (typingUsers.length === 1) {
        typingText = `${typingUsers[0].name} is typing...`;
    } else if (typingUsers.length > 1) {
        typingText = "Multiple people are typing...";
    }

    return `
        <div class="space-y-4 flex flex-col h-[50vh]">
            <div class="flex-1 overflow-y-auto space-y-3 pr-2" id="chat-messages-scroll">
                ${(event.comments || []).length === 0 ? '<div class="text-center text-xs text-slate-400 py-10">No messages yet. Start the conversation!</div>' : ''}
                ${(event.comments || []).map(c => `
                    <div class="flex items-end gap-2 ${c.uid === window.currentUser?.uid ? 'justify-end' : 'justify-start'}">
                        ${c.uid !== window.currentUser?.uid ? `<img src="${c.avatar || 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100'}" class="w-7 h-7 rounded-full object-cover mb-1 shadow-sm">` : ''}
                        <div class="max-w-[75%] bg-slate-100 border border-slate-200 rounded-2xl px-4 py-2.5 shadow-sm space-y-1">
                            <div class="flex items-center justify-between gap-4">
                                <span class="text-[11px] font-black text-brand-dark">${c.name}</span>
                                <span class="text-[9px] text-slate-400">${c.timestamp || 'Just now'}</span>
                            </div>
                            <p class="text-xs text-slate-800">${c.text}</p>
                        </div>
                        ${c.uid === window.currentUser?.uid ? `<img src="${c.avatar || 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100'}" class="w-7 h-7 rounded-full object-cover mb-1 shadow-sm">` : ''}
                    </div>
                `).join('')}
            </div>

            <div class="pt-2 border-t border-slate-200 space-y-2">
                <div id="game-typing-indicator" class="text-[11px] italic text-brand font-bold animate-pulse px-1">${typingText}</div>
                <form onsubmit="handleSendGameComment(event)" class="flex gap-2">
                    <input type="text" id="game-comment-input" oninput="handleGameCommentTyping()" required placeholder="Type a message..." class="flex-1 bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-slate-900 text-xs focus:outline-none focus:border-brand">
                    <button type="submit" class="bg-brand hover:bg-brand-dark text-slate-950 font-black px-5 py-2.5 rounded-xl text-xs transition shadow">Send</button>
                </form>
            </div>
        </div>
    `;
}