// js/chat.js: Handles WhatsApp-style messaging threads and real-time chat sync
import { db, appId } from './firebase-config.js';
import { doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

window.activeChatThreadId = null;

window.renderChatsList = function() {
    const query = (document.getElementById('chats-search-input')?.value || '').toLowerCase().trim();
    const container = document.getElementById('chats-threads-container');
    if (!container) return;

    let activeThreads = (window.chatsThreads || []).filter(th => th.messages && th.messages.length > 0);

    if (query !== '') {
        activeThreads = activeThreads.filter(th => th.name.toLowerCase().includes(query));
    }

    if (activeThreads.length === 0) {
        container.innerHTML = `<div class="p-6 text-center text-xs text-slate-500 italic">No active conversations. Start a chat from your Friends list!</div>`;
        return;
    }

    container.innerHTML = activeThreads.map(th => {
        const lastMsg = th.messages[th.messages.length - 1].text;
        const lastTime = th.messages[th.messages.length - 1].time;

        return `
            <div onclick="openChatThread('${th.id}')" class="p-3.5 flex items-center justify-between hover:bg-[#090d16] cursor-pointer transition ${window.activeChatThreadId === th.id ? 'bg-[#090d16]' : ''}">
                <div class="flex items-center gap-3">
                    <img src="${th.avatar}" class="w-10 h-10 rounded-full object-cover">
                    <div>
                        <h3 class="text-xs font-black text-white">${th.name}</h3>
                        <p class="text-[11px] text-slate-400 mt-0.5 truncate max-w-[140px]">${lastMsg}</p>
                    </div>
                </div>
                <span class="text-[9px] text-slate-500">${lastTime}</span>
            </div>
        `;
    }).join('');
};

window.openChatThread = function(id) {
    window.activeChatThreadId = id;
    const th = (window.chatsThreads || []).find(t => t.id === id);
    if (!th) return;

    document.getElementById('no-chat-selected')?.classList.add('hidden');
    document.getElementById('active-chat-box')?.classList.remove('hidden');

    const nameEl = document.getElementById('active-chat-name');
    const avatarEl = document.getElementById('active-chat-avatar');
    if (nameEl) nameEl.innerText = th.name;
    if (avatarEl) avatarEl.src = th.avatar;

    window.renderActiveChatMessages();
    window.renderChatsList();
};

window.renderActiveChatMessages = function() {
    const th = (window.chatsThreads || []).find(t => t.id === window.activeChatThreadId);
    if (!th) return;
    const container = document.getElementById('active-chat-messages');
    if (!container) return;
    
    if (!th.messages || th.messages.length === 0) {
        container.innerHTML = `
            <div class="flex flex-col items-center justify-center h-full text-slate-500 space-y-2">
                <i class="fa-solid fa-comments text-3xl opacity-40"></i>
                <p class="text-xs font-semibold">No chat history. Say hello!</p>
            </div>
        `;
        return;
    }

    container.innerHTML = th.messages.map(m => {
        const isMe = m.sender === `${window.userProfile?.firstName}`;
        return `
            <div class="flex items-start gap-2.5 ${isMe ? 'flex-row-reverse text-right' : ''}">
                <img src="${m.avatar}" class="w-7 h-7 rounded-full object-cover">
                <div class="bg-[#090d16] border border-slate-800 p-3 rounded-xl max-w-md">
                    <div class="flex items-center gap-2 mb-1 ${isMe ? 'justify-end' : ''}">
                        <span class="text-xs font-bold text-brand">${m.sender}</span>
                        <span class="text-[9px] text-slate-500">${m.time}</span>
                    </div>
                    <p class="text-xs text-white">${m.text}</p>
                </div>
            </div>
        `;
    }).join('');
    container.scrollTop = container.scrollHeight;
};

window.handleSendActiveChatMessage = async function(e) {
    e.preventDefault();
    const input = document.getElementById('active-chat-input');
    const text = input.value.trim();
    if (!text) return;

    let th = (window.chatsThreads || []).find(t => t.id === window.activeChatThreadId);
    const newMessage = {
        sender: `${window.userProfile.firstName}`,
        text: text,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        avatar: window.userProfile.avatar
    };

    if (th) {
        if (!th.messages) th.messages = [];
        th.messages.push(newMessage);
    }

    input.value = '';
    window.renderActiveChatMessages();
    window.renderChatsList();

    await setDoc(doc(db, 'artifacts', appId, 'users', window.currentUser.uid, 'chats', 'data'), { threads: window.chatsThreads });
};