// js/chat.js: Handles WhatsApp-style messaging threads, directory user search, real-time chat sync, read receipts, and typing indicators
import { db, appId } from './firebase-config.js';
import { doc, setDoc, getDoc, collection, getDocs, addDoc, serverTimestamp, onSnapshot } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

window.activeChatThreadId = null;
window.chatsThreads = [];
let chatUnsubscribe = null;
let typingUnsubscribe = null;
let typingTimeout = null;

// Real-time listener for chats from the user's directory document
window.initChatListener = function() {
    if (!window.currentUser) return;
    
    if (chatUnsubscribe) {
        chatUnsubscribe();
    }

    const userDocRef = doc(db, 'artifacts', appId, 'directory', window.currentUser.uid);
    chatUnsubscribe = onSnapshot(userDocRef, (snap) => {
        if (snap.exists()) {
            const data = snap.data();
            window.chatsThreads = data.chats || [];
            window.renderChatsList();
            if (window.activeChatThreadId) {
                window.renderActiveChatMessages();
                // Re-check for newly-arrived unread messages in the open thread
                // so the sender's checkmark turns blue live, not just on reopen.
                const activeThread = window.chatsThreads.find(t => t.id === window.activeChatThreadId);
                if (activeThread) {
                    window.markThreadAsReadLocally(activeThread);
                }
            }
        }
    }, (error) => {
        console.error("Error listening to chats:", error);
    });
};

window.renderChatsList = async function() {
    const query = (document.getElementById('chats-search-input')?.value || '').toLowerCase().trim();
    const container = document.getElementById('chats-threads-container');
    if (!container) return;

    if (!window.cachedDirectoryList) {
        try {
            const snap = await getDocs(collection(db, 'artifacts', appId, 'directory'));
            window.cachedDirectoryList = snap.docs.map(d => d.data());
        } catch (e) {
            window.cachedDirectoryList = [];
        }
    }

    let activeThreads = [...(window.chatsThreads || [])];

    if (query !== '') {
        activeThreads = activeThreads.filter(th => th.name.toLowerCase().includes(query));

        const existingThreadIds = new Set(activeThreads.map(t => t.id));
        const matchingDirectoryUsers = (window.cachedDirectoryList || []).filter(u => {
            if (u.uid === window.currentUser?.uid) return false;
            const fullName = (u.name || `${u.firstName || ''} ${u.lastName || ''}`).toLowerCase();
            const nickName = (u.nickname || '').toLowerCase();
            return (fullName.includes(query) || nickName.includes(query)) && !existingThreadIds.has(u.uid);
        });

        matchingDirectoryUsers.forEach(u => {
            const displayName = u.name || `${u.firstName || ''} ${u.lastName || ''}`.trim() || 'Player';
            activeThreads.push({
                id: u.uid,
                name: displayName,
                avatar: u.avatar || 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100',
                messages: []
            });
        });
    } else {
        activeThreads = activeThreads.filter(th => th.messages && th.messages.length > 0);
    }

    if (activeThreads.length === 0) {
        container.innerHTML = `<div class="p-6 text-center text-xs text-slate-500 italic">No conversations found. Search above to start chatting with anyone!</div>`;
        return;
    }

    container.innerHTML = activeThreads.map(th => {
        const hasMessages = th.messages && th.messages.length > 0;
        const lastMsg = hasMessages ? th.messages[th.messages.length - 1].text : 'Click to start conversation';
        const lastTime = hasMessages ? th.messages[th.messages.length - 1].time : '';
        
        // Check live directory cache for freshest avatar/name
        const liveUser = (window.cachedDirectoryList || []).find(d => d.uid === th.id);
        const avatarSrc = (liveUser && liveUser.avatar) ? liveUser.avatar : (th.avatar || 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100');
        const displayName = (liveUser && (liveUser.name || liveUser.firstName)) ? (liveUser.name || `${liveUser.firstName} ${liveUser.lastName || ''}`) : th.name;

        return `
            <div onclick="openChatThread('${th.id}')" class="p-3.5 flex items-center justify-between hover:bg-slate-50 cursor-pointer transition ${window.activeChatThreadId === th.id ? 'bg-slate-50' : ''}">
                <div class="flex items-center gap-3 truncate">
                    <img src="${avatarSrc}" class="w-10 h-10 rounded-full object-cover shrink-0 border border-slate-200">
                    <div class="truncate">
                        <h3 class="text-xs font-black text-slate-900 truncate">${displayName}</h3>
                        <p class="text-[11px] text-slate-500 mt-0.5 truncate">${lastMsg}</p>
                    </div>
                </div>
                <span class="text-[9px] text-slate-400 shrink-0 ml-2">${lastTime}</span>
            </div>
        `;
    }).join('');
};

window.openChatThread = function(id) {
    window.activeChatThreadId = id;
    let th = (window.chatsThreads || []).find(t => t.id === id);

    // Grab freshest profile info from the cached directory if available
    const liveUser = (window.cachedDirectoryList || []).find(d => d.uid === id);
    const liveName = liveUser ? (liveUser.name || `${liveUser.firstName || ''} ${liveUser.lastName || ''}`.trim() || liveUser.nickname) : null;
    const liveAvatar = liveUser ? liveUser.avatar : null;

    if (!th) {
        let targetUser = liveUser;
        if (!targetUser && window.friendsList) {
            targetUser = window.friendsList.find(f => f.uid === id);
        }
        if (targetUser) {
            const displayName = targetUser.name || `${targetUser.firstName || ''} ${targetUser.lastName || ''}`.trim() || 'Player';
            th = {
                id: targetUser.uid,
                name: liveName || displayName,
                avatar: liveAvatar || targetUser.avatar || 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100',
                messages: []
            };
            window.chatsThreads = window.chatsThreads || [];
            window.chatsThreads.push(th);
        } else {
            return;
        }
    } else {
        if (liveName) th.name = liveName;
        if (liveAvatar) th.avatar = liveAvatar;
    }

    const searchInput = document.getElementById('chats-search-input');
    if (searchInput) searchInput.value = '';

    document.getElementById('no-chat-selected')?.classList.add('hidden');
    
    const activeBox = document.getElementById('active-chat-box');
    if (activeBox) {
        activeBox.classList.remove('hidden');
        activeBox.classList.add('flex', 'flex-col', 'h-full', 'overflow-hidden');
    }

    const nameEl = document.getElementById('active-chat-name');
    const avatarEl = document.getElementById('active-chat-avatar');
    if (nameEl) nameEl.innerText = th.name;
    if (avatarEl) avatarEl.src = th.avatar || 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100';

    // Mark unread messages as read when opening thread and update sender copy
    window.markThreadAsReadLocally(th);

    // Listen to partner typing status
    window.initTypingListener(id);

    window.renderActiveChatMessages();
    window.renderChatsList();
};

window.markThreadAsReadLocally = async function(th) {
    if (!window.currentUser || !th || !th.messages) return;
    const myUid = window.currentUser.uid;
    let updated = false;

    th.messages.forEach(m => {
        if (m.senderUid !== myUid && !m.isRead) {
            m.isRead = true;
            updated = true;
        }
    });

    if (updated) {
        try {
            // Trim messages array to keep document size well under 1MB
            th.messages = th.messages.slice(-100);

            await setDoc(doc(db, 'artifacts', appId, 'directory', myUid), { chats: window.chatsThreads }, { merge: true });

            // Instantly update sender's copy in Firestore so checkmarks turn blue on their screen
            const senderDocRef = doc(db, 'artifacts', appId, 'directory', th.id);
            const senderSnap = await getDoc(senderDocRef);
            if (senderSnap.exists()) {
                let senderThreads = senderSnap.data().chats || [];
                let modified = false;
                senderThreads.forEach(st => {
                    if (st.id === myUid && st.messages) {
                        st.messages.forEach(sm => {
                            if (!sm.isRead) {
                                sm.isRead = true;
                                modified = true;
                            }
                        });
                        st.messages = st.messages.slice(-100);
                    }
                });
                if (modified) {
                    await setDoc(senderDocRef, { chats: senderThreads }, { merge: true });
                }
            }
        } catch (err) {
            console.error("Error updating read status:", err);
        }
    }
};

window.initTypingListener = function(partnerUid) {
    if (typingUnsubscribe) typingUnsubscribe();

    // Matches partner typing on the iOS/Web side: document ID is partnerUid_myUid
    const typingRef = doc(db, 'artifacts', appId, 'typing', `${partnerUid}_${window.currentUser.uid}`);
    typingUnsubscribe = onSnapshot(typingRef, (snap) => {
        const subTitleEl = document.getElementById('active-chat-subtitle');
        if (!subTitleEl) return;

        if (snap.exists() && snap.data().isTyping === true) {
            const partnerName = document.getElementById('active-chat-name')?.innerText || 'They';
            subTitleEl.innerText = `${partnerName} is typing...`;
            subTitleEl.classList.remove('hidden');
        } else {
            subTitleEl.innerText = "";
            subTitleEl.classList.add('hidden');
        }
    });
};

window.handleChatInputKeypress = function() {
    if (!window.currentUser || !window.activeChatThreadId) return;

    // Document ID format: myUid_partnerUid
    const typingRef = doc(db, 'artifacts', appId, 'typing', `${window.currentUser.uid}_${window.activeChatThreadId}`);
    setDoc(typingRef, { isTyping: true, timestamp: serverTimestamp() }, { merge: true });

    if (typingTimeout) clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        setDoc(typingRef, { isTyping: false }, { merge: true });
    }, 2000);
};

window.startChatWithPlayer = function(uid, name, avatar) {
    let th = (window.chatsThreads || []).find(t => t.id === uid);
    if (!th) {
        th = {
            id: uid,
            name: name,
            avatar: avatar || 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100',
            messages: []
        };
        window.chatsThreads = window.chatsThreads || [];
        window.chatsThreads.push(th);
    }
    window.openChatThread(uid);
};

window.renderActiveChatMessages = function() {
    const th = (window.chatsThreads || []).find(t => t.id === window.activeChatThreadId);
    if (!th) return;
    const container = document.getElementById('active-chat-messages');
    if (!container) return;

    container.classList.add('flex-1', 'overflow-y-auto', 'p-4');
    
    if (!th.messages || th.messages.length === 0) {
        container.innerHTML = `
            <div class="flex flex-col items-center justify-center h-full text-slate-500 space-y-2">
                <i class="fa-solid fa-comments text-3xl opacity-40"></i>
                <p class="text-xs font-semibold">No chat history. Say hello!</p>
            </div>
        `;
        return;
    }

    const myUid = window.currentUser?.uid;
    const myName = window.userProfile?.name || window.userProfile?.firstName || window.currentUser?.displayName || 'Enzo';

    // Get live directory avatar for partner if available
    const livePartner = (window.cachedDirectoryList || []).find(d => d.uid === th.id);
    const partnerAvatar = livePartner?.avatar || th.avatar || 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100';

    container.innerHTML = th.messages.map(m => {
        const isMe = (m.senderUid && m.senderUid === myUid) || 
                     (m.sender && m.sender.toLowerCase() === myName.toLowerCase());

        const avatarUrl = isMe 
            ? (window.userProfile?.avatar || window.currentUser?.photoURL || 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100')
            : (partnerAvatar);
            
        const senderDisplayName = isMe ? 'You' : th.name;
        const checkColor = m.isRead === true ? 'text-blue-500' : 'text-slate-400';

        if (isMe) {
            return `
                <div class="flex items-end justify-end gap-2 my-2">
                    <div class="bg-[#14cc80] text-slate-900 px-4 py-2.5 rounded-2xl rounded-tr-sm max-w-md shadow-sm text-xs relative">
                        <p class="pr-14 pb-3 break-words font-normal">${m.text}</p>
                        <div class="absolute bottom-1 right-2.5 flex items-center gap-1 select-none">
                            <span class="text-[9px] text-slate-700 font-medium">${m.time}</span>
                            <span class="text-[11px] ${checkColor} font-bold tracking-tighter">✓✓</span>
                        </div>
                    </div>
                </div>
            `;
        } else {
            return `
                <div class="flex items-end gap-2 my-2">
                    <img src="${avatarUrl}" class="w-7 h-7 rounded-full object-cover shrink-0 mb-1 border border-slate-200">
                    <div class="bg-white border border-slate-200 text-slate-900 px-4 py-2.5 rounded-2xl rounded-tl-sm max-w-md shadow-sm text-xs relative">
                        <p class="text-[10px] font-bold text-emerald-600 mb-0.5">${senderDisplayName}</p>
                        <p class="pr-12 pb-3 break-words font-normal">${m.text}</p>
                        <div class="absolute bottom-1 right-2.5 flex items-center gap-1 select-none">
                            <span class="text-[9px] text-slate-400 font-medium">${m.time}</span>
                        </div>
                    </div>
                </div>
            `;
        }
    }).join('');
    container.scrollTop = container.scrollHeight;
};

window.handleSendActiveChatMessage = async function(e) {
    e.preventDefault();
    const input = document.getElementById('active-chat-input');
    if (!input) return;
    const text = input.value.trim();
    if (!text || !window.activeChatThreadId || !window.currentUser) return;

    let th = window.chatsThreads.find(t => t.id === window.activeChatThreadId);
    if (!th) {
        let targetUser = (window.cachedDirectoryList || []).find(d => d.uid === window.activeChatThreadId);
        const displayName = targetUser?.name || `${targetUser?.firstName || ''} ${targetUser?.lastName || ''}`.trim() || 'Player';
        th = {
            id: window.activeChatThreadId,
            name: displayName,
            avatar: targetUser?.avatar || 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100',
            messages: []
        };
        window.chatsThreads.push(th);
    }

    const senderName = window.userProfile?.name || window.userProfile?.firstName || window.currentUser?.displayName || 'Player';
    const senderAvatar = window.userProfile?.avatar || window.currentUser?.photoURL || '';

    const newMessage = {
        id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9),
        senderUid: window.currentUser.uid,
        sender: senderName,
        text: text,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        avatar: senderAvatar,
        isRead: false
    };

    th.messages.push(newMessage);
    
    // Trim messages to keep the last 100 messages (protecting against the 1MB document limit)
    th.messages = th.messages.slice(-100);

    input.value = '';

    window.renderActiveChatMessages();
    window.renderChatsList();

    try {
        await setDoc(doc(db, 'artifacts', appId, 'directory', window.currentUser.uid), { chats: window.chatsThreads }, { merge: true });

        const recipientDocRef = doc(db, 'artifacts', appId, 'directory', th.id);
        const recipientSnap = await getDoc(recipientDocRef);
        let recipientThreads = recipientSnap.exists() ? (recipientSnap.data().chats || []) : [];
        
        let recipientThread = recipientThreads.find(t => t.id === window.currentUser.uid);

        if (recipientThread) {
            if (!recipientThread.messages) recipientThread.messages = [];
            recipientThread.messages.push(newMessage);
            recipientThread.messages = recipientThread.messages.slice(-100);
        } else {
            recipientThreads.push({
                id: window.currentUser.uid,
                name: senderName,
                avatar: senderAvatar,
                messages: [newMessage]
            });
        }
        await setDoc(recipientDocRef, { chats: recipientThreads }, { merge: true });

        await addDoc(collection(db, 'artifacts', appId, 'notifications'), {
            recipientUid: th.id,
            senderUid: window.currentUser.uid,
            type: "chat_message",
            title: senderName,
            body: text,
            read: false,
            timestamp: serverTimestamp()
        });
    } catch (err) {
        console.error("Error saving chat or sending notification:", err);
    }
};

// Auto-initialize chat listener once user profile / auth is verified
document.addEventListener('DOMContentLoaded', () => {
    const checkUserInterval = setInterval(() => {
        if (window.currentUser) {
            clearInterval(checkUserInterval);
            window.initChatListener();
        }
    }, 500);
});