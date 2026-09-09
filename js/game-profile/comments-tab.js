// js/game-profile/comments-tab.js
import { db, appId } from '../firebase-config.js';
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

export function renderCommentsTab(event) {
    const activeEvent = event || window.currentSelectedEvent || {};
    const comments = Array.isArray(activeEvent.comments) ? activeEvent.comments : [];
    const typingUsers = (Array.isArray(activeEvent.typingUsers) ? activeEvent.typingUsers : []).filter(u => u.uid !== window.currentUser?.uid);
    
    let typingText = "";
    if (typingUsers.length === 1) {
        typingText = `${typingUsers[0].name} is typing...`;
    } else if (typingUsers.length > 1) {
        typingText = "Multiple players are typing...";
    }

    const eventId = activeEvent.id || window.activeModalEventId || (window.currentSelectedEvent && window.currentSelectedEvent.id);

    return `
        <div class="space-y-3 flex flex-col bg-slate-100 p-4 rounded-2xl border border-slate-200 shadow-inner">
            <!-- WhatsApp-style Chat Messages Container -->
            <div class="min-h-[300px] max-h-[45vh] overflow-y-auto space-y-3 pr-2" id="chat-messages-scroll">
                ${comments.length === 0 ? '<div class="text-center text-xs text-slate-400 py-16">No messages yet. Start the conversation!</div>' : ''}
                ${comments.map(c => {
                    const isMe = c.uid === window.currentUser?.uid;
                    const avatarUrl = c.avatar || 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100';
                    return `
                        <div class="flex items-end gap-2 ${isMe ? 'justify-end' : 'justify-start'}">
                            ${!isMe ? `<img src="${avatarUrl}" class="w-7 h-7 rounded-full object-cover mb-1 shadow-sm shrink-0">` : ''}
                            
                            <div class="max-w-[80%] px-4 py-2.5 shadow-sm space-y-1 relative text-xs ${
                                isMe 
                                    ? 'bg-emerald-500 text-white rounded-l-2xl rounded-tr-2xl rounded-br-sm' 
                                    : 'bg-white text-slate-900 border border-slate-200 rounded-r-2xl rounded-tl-2xl rounded-bl-sm'
                            }">
                                ${!isMe ? `<div class="text-[10px] font-black text-emerald-700 mb-0.5">${c.name || 'Player'}</div>` : ''}
                                <p class="break-words leading-relaxed">${c.text || ''}</p>
                                <div class="text-[9px] text-right ${isMe ? 'text-emerald-100' : 'text-slate-400'} mt-0.5">${c.timestamp || 'Just now'}</div>
                            </div>

                            ${isMe ? `<img src="${avatarUrl}" class="w-7 h-7 rounded-full object-cover mb-1 shadow-sm shrink-0">` : ''}
                        </div>
                    `;
                }).join('')}
            </div>

            <!-- WhatsApp Typing Indicator & Input Bar (Using direct onclick to avoid form validation bugs) -->
            <div class="bg-white p-3 rounded-2xl border border-slate-200 shadow-sm space-y-2">
                <div id="game-typing-indicator" class="text-[11px] italic text-emerald-600 font-bold animate-pulse px-1 h-4">${typingText}</div>
                <div class="flex gap-2 items-center">
                    <input type="text" id="game-comment-input" oninput="handleGameCommentTyping('${eventId}')" onkeydown="if(event.key === 'Enter') handleSendGameComment('${eventId}')" placeholder="Type a message..." class="flex-1 bg-slate-50 border border-slate-300 rounded-xl px-4 py-3 text-slate-900 text-xs focus:outline-none focus:border-emerald-500">
                    <button type="button" onclick="handleSendGameComment('${eventId}')" class="bg-emerald-500 hover:bg-emerald-600 text-white font-black px-5 py-3 rounded-xl text-xs transition shadow shrink-0 flex items-center gap-1.5 cursor-pointer">
                        <i class="fa-solid fa-paper-plane"></i> Send
                    </button>
                </div>
            </div>
        </div>
    `;
}

// 💬 Handle sending chat messages live to Firestore
window.handleSendGameComment = async function(eventId) {
    const targetEventId = eventId || window.activeModalEventId || (window.currentSelectedEvent && window.currentSelectedEvent.id);
    const input = document.getElementById('game-comment-input');
    const messageText = input ? input.value.trim() : '';
    
    console.log("SEND TRIGGERED -> Text:", messageText, "| Target Event ID:", targetEventId);

    if (!messageText) {
        window.showToast("Please type a message first.", "error");
        return;
    }

    if (!targetEventId) {
        console.error("FATAL: Missing active modal event ID!");
        window.showToast("Error: No active game found.", "error");
        return;
    }

    if (input) input.value = '';

    try {
        let eventDocRef = doc(db, 'artifacts', appId, 'eventsList', targetEventId);
        let docSnap = await getDoc(eventDocRef);
        let eventData = null;

        if (docSnap.exists()) {
            eventData = docSnap.data();
        } else {
            const globalRef = doc(db, 'artifacts', appId, 'global', 'events');
            const globalSnap = await getDoc(globalRef);
            if (globalSnap.exists()) {
                const list = globalSnap.data().list || [];
                eventData = list.find(ev => ev.id === targetEventId);
            }
        }

        if (!eventData) {
            window.showToast("Game event not found", "error");
            return;
        }

        eventData.comments = Array.isArray(eventData.comments) ? eventData.comments : [];

        const user = window.currentUser || {};
        const profile = window.userProfile || {};
        const senderName = profile.firstName ? `${profile.firstName} ${profile.lastName || ''}`.trim() : (user.name || user.displayName || 'Player');
        const senderAvatar = profile.avatar || user.avatar || user.photoURL || 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100';

        const newComment = {
            uid: String(user.uid || 'anon'),
            name: String(senderName),
            avatar: String(senderAvatar),
            text: String(messageText),
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };

        // Push locally immediately
        eventData.comments.push(newComment);
        eventData.typingUsers = (eventData.typingUsers || []).filter(u => u.uid !== user.uid);
        
        window.currentSelectedEvent = eventData;
        if (window.eventsList) {
            const idx = window.eventsList.findIndex(ev => ev.id === targetEventId);
            if (idx !== -1) window.eventsList[idx] = eventData;
        }

        // Re-render modal view instantly
        if (typeof window.renderEventDetailModalContent === 'function') {
            window.renderEventDetailModalContent();
        }

        // Save to Firestore
        await setDoc(eventDocRef, eventData);

        // Scroll to bottom
        setTimeout(() => {
            const scrollContainer = document.getElementById('chat-messages-scroll');
            if (scrollContainer) scrollContainer.scrollTop = scrollContainer.scrollHeight;
        }, 50);

    } catch (err) {
        console.error("DETAILED COMMENT SEND ERROR:", err);
        window.showToast("Failed to send message: " + err.message, "error");
    }
};

// ⌨️ Handle live typing indicator state
let typingTimeout = null;
window.handleGameCommentTyping = async function(eventId) {
    const targetEventId = eventId || window.activeModalEventId || (window.currentSelectedEvent && window.currentSelectedEvent.id);
    const user = window.currentUser;
    if (!user || !user.uid || !targetEventId) return;

    try {
        const eventDocRef = doc(db, 'artifacts', appId, 'eventsList', targetEventId);
        const docSnap = await getDoc(eventDocRef);
        if (!docSnap.exists()) return;

        let eventData = docSnap.data();
        eventData.typingUsers = Array.isArray(eventData.typingUsers) ? eventData.typingUsers : [];

        const profile = window.userProfile || {};
        const userName = profile.firstName ? `${profile.firstName} ${profile.lastName || ''}`.trim() : (user.name || 'Player');

        const existingIndex = eventData.typingUsers.findIndex(u => u.uid === user.uid);
        if (existingIndex === -1) {
            eventData.typingUsers.push({
                uid: user.uid,
                name: userName
            });
            await setDoc(eventDocRef, eventData);
        }

        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(async () => {
            try {
                const freshSnap = await getDoc(eventDocRef);
                if (freshSnap.exists()) {
                    let freshData = freshSnap.data();
                    freshData.typingUsers = (freshData.typingUsers || []).filter(u => u.uid !== user.uid);
                    await setDoc(eventDocRef, freshData);
                }
            } catch (e) {
                console.error("Error clearing typing status:", e);
            }
        }, 2000);

    } catch (err) {
        console.error("Error updating typing status:", err);
    }
};