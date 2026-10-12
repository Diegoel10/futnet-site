// js/chat.js: Handles WhatsApp-style messaging threads, directory user search, real-time chat sync, read receipts, and typing indicators
import { db, appId } from './firebase-config.js';
import { doc, setDoc, getDoc, collection, getDocs, addDoc, serverTimestamp, onSnapshot, query as fsQuery, orderBy, limit, runTransaction } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { renderWhatsApp, typingBubbleHtml, msOf, nameColor, reportTyping, stopTyping, uploadMedia, addAttachButton, showUploadProgress, hideUploadProgress, mediaErrorText, MEDIA_LABEL } from './wa-chat.js';

const STOCK = 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100';   // old placeholder: never shown or saved
// A player's real profile photo: live player list first (always current), then what the chat saved.
function photoOf(uid, name, saved) {
    const live = (window.cachedDirectoryList || []).find(d => d.uid === uid) || (window.directoryList || []).find(d => d.uid === uid);
    if (live && (live.avatar || live.photoURL)) return live.avatar || live.photoURL;
    if (window.resolvePlayerAvatar) return window.resolvePlayerAvatar({ uid, name, avatar: saved && saved !== STOCK ? saved : '' });
    return saved && saved !== STOCK ? saved : 'https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg';
}
window.chatPhotoOf = photoOf;
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

window.activeChatThreadId = null;
window.chatsThreads = [];
let chatUnsubscribe = null;
let typingUnsubscribe = null;
let typingTimeout = null;
window.chatsTab = 'chats';

// WhatsApp-style filter chips: All · Unread · Groups ('chats' = All, 'community' = Groups, kept for older links)
window.setChatsTab = function(tab) {
    window.chatsTab = tab === 'community' ? 'community' : (tab === 'unread' ? 'unread' : 'all');
    window.renderChatsList();
};

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

// ---- Community chats in the list: last message + unread count (read marks are kept on this device)
const commLast = {};          // communityId -> latest messages (newest first)
const commUnsubs = {};
const READ_KEY = (cid) => `futnet_commread_${cid}`;
const lastReadOf = (cid) => { try { return parseInt(localStorage.getItem(READ_KEY(cid)) || '0', 10) || 0; } catch (e) { return 0; } };
function markCommunityRead(cid) { try { localStorage.setItem(READ_KEY(cid), String(Date.now())); } catch (e) { /* private mode */ } }
window.markCommunityChatRead = markCommunityRead;

function watchCommunityChats() {
    (window.communityChatThreads || []).forEach(t => {
        const cid = t.communityId || String(t.id).slice(10);
        if (!cid || commUnsubs[cid]) return;
        commUnsubs[cid] = onSnapshot(
            fsQuery(collection(db, 'artifacts', appId, 'communities', cid, 'messages'), orderBy('createdAt', 'desc'), limit(30)),
            (snap) => {
                commLast[cid] = snap.docs.map(d => ({ ...d.data(), id: d.id }));
                if (window.activeChatThreadId === 'community:' + cid) markCommunityRead(cid);
                window.renderChatsList();
            }, () => {});
    });
}

const fmtListTime = (ms) => {
    if (!ms) return '';
    const d = new Date(ms), now = new Date();
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const y = new Date(); y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return 'Yesterday';
    if ((now - d) / 86400000 < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
    return d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric', year: '2-digit' });
};
const mediaIcon = (m) => m && !m.deleted && m.media && m.media.url
    ? (m.media.type === 'video' ? '<i class="fa-solid fa-video mr-1"></i>' : '<i class="fa-solid fa-camera mr-1"></i>') : '';
const previewText = (m) => {
    if (m && m.deleted === true) return '🚫 This message was deleted';
    const t = String(m?.text || '');
    if (m && m.media && (t === '📷 Photo' || t === '🎥 Video')) return m.media.type === 'video' ? 'Video' : 'Photo';
    return t;
};

/** One row per conversation (private + community), newest first. */
function buildChatRows() {
    const myUid = window.currentUser?.uid;
    const rows = [];
    (window.chatsThreads || []).forEach(th => {
        const msgs = th.messages || [];
        if (!msgs.length) return;
        const last = msgs[msgs.length - 1];
        const live = (window.cachedDirectoryList || []).find(d => d.uid === th.id);
        rows.push({
            id: th.id, isGroup: false,
            name: (live && (live.name || `${live.firstName || ''} ${live.lastName || ''}`.trim())) || th.name || 'Player',
            avatar: photoOf(th.id, th.name, th.avatar),
            last, lastMine: last.senderUid === myUid, ms: msOf(last),
            unread: msgs.filter(m => m.senderUid !== myUid && m.isRead !== true).length
        });
    });
    (window.communityChatThreads || []).forEach(t => {
        const cid = t.communityId || String(t.id).slice(10);
        const list = commLast[cid] || [];
        const last = list[0] || null;
        const readAt = lastReadOf(cid);
        rows.push({
            id: t.id, isGroup: true, name: t.name || 'Community', avatar: t.avatar || '',
            last, lastMine: last && last.senderUid === myUid, ms: last ? msOf(last) : 0,
            unread: list.filter(m => m.senderUid !== myUid && msOf(m) > readAt).length
        });
    });
    return rows.sort((a, b) => b.ms - a.ms);
}

function chatRowHtml(r) {
    const selected = window.activeChatThreadId === r.id;
    const time = fmtListTime(r.ms);
    let preview = '';
    if (r.last) {
        const ticks = r.lastMine && !r.isGroup
            ? `<span class="${r.last.isRead ? 'text-[#53BDEB]' : 'text-[#8696A0]'} font-bold tracking-[-3px] mr-1.5">✓✓</span>` : '';
        const who = r.isGroup && !r.lastMine && r.last.sender
            ? `<span style="color:${nameColor(r.last.senderUid || r.last.sender)}">${esc(String(r.last.sender).split(' ')[0])}:</span> `
            : (r.isGroup && r.lastMine ? 'You: ' : '');
        preview = `${ticks}${who}${mediaIcon(r.last)}${esc(previewText(r.last))}`;
    } else {
        preview = r.isGroup ? '<span class="italic">Community chat · Say hello 👋</span>' : '';
    }
    const fallback = 'https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg';
    return `
        <div onclick="openChatThread('${esc(r.id)}')" class="flex items-center gap-3 px-3 py-2.5 cursor-pointer transition ${selected ? 'bg-[#2A3942]' : 'hover:bg-[#202C33]'}">
            <img src="${esc(r.avatar || fallback)}" onerror="this.src='${fallback}'" class="w-12 h-12 rounded-full object-cover shrink-0 bg-[#202C33]">
            <div class="flex-1 min-w-0 border-b border-white/5 pb-2.5 -mb-2.5">
                <div class="flex items-baseline justify-between gap-2">
                    <span class="text-[15px] font-semibold text-[#E9EDEF] truncate">${r.isGroup ? '<i class="fa-solid fa-people-group text-[11px] text-[#8696A0] mr-1.5"></i>' : ''}${esc(r.name)}</span>
                    <span class="text-[11px] shrink-0 ${r.unread ? 'text-[#25D366] font-semibold' : 'text-[#8696A0]'}">${esc(time)}</span>
                </div>
                <div class="flex items-center justify-between gap-2 mt-0.5">
                    <span class="text-[13px] text-[#8696A0] truncate">${preview}</span>
                    ${r.unread ? `<span class="shrink-0 min-w-[20px] h-5 px-1.5 rounded-full bg-[#25D366] text-[#0B141A] text-[11px] font-bold flex items-center justify-center">${r.unread > 99 ? '99+' : r.unread}</span>` : ''}
                </div>
            </div>
        </div>`;
}

// Turns the old "Chats / Community Chats" tabs into WhatsApp's look: chips + rounded search, dark list.
function styleChatsPanel() {
    const a = document.getElementById('chats-tab-btn-chats');
    const bar = a && a.parentElement;
    if (bar && !document.getElementById('wa-chat-chips')) {
        bar.style.display = 'none';
        const chips = document.createElement('div');
        chips.id = 'wa-chat-chips';
        chips.className = 'flex gap-2 px-3 py-2 overflow-x-auto';
        bar.parentElement.insertBefore(chips, bar.nextSibling);
    }
    const chips = document.getElementById('wa-chat-chips');
    if (chips) {
        const cur = window.chatsTab === 'community' ? 'community' : (window.chatsTab === 'unread' ? 'unread' : 'all');
        const totalUnread = buildChatRows().reduce((n, r) => n + (r.unread ? 1 : 0), 0);
        const chip = (key, label) => `<button onclick="setChatsTab('${key}')" class="shrink-0 px-3.5 py-1.5 rounded-full text-[13px] font-semibold transition ${cur === key ? 'bg-[#103529] text-[#25D366]' : 'bg-[#202C33] text-[#8696A0] hover:text-[#E9EDEF]'}">${label}</button>`;
        chips.innerHTML = chip('all', 'All') + chip('unread', `Unread${totalUnread ? ' ' + totalUnread : ''}`) + chip('community', 'Groups');
    }
    const search = document.getElementById('chats-search-input');
    if (search && !search.dataset.waStyled) {
        search.dataset.waStyled = '1';
        search.placeholder = 'Search or start a new chat';
        search.style.cssText = 'background-color:#202C33 !important;color:#E9EDEF !important;border:0;border-radius:9999px;padding:9px 16px;';
    }
    const list = document.getElementById('chats-threads-container');
    if (list) list.style.background = '#111B21';
}

/** Red dot on Chats = how many conversations have unread messages (private + community). */
function updateChatsBadge() {
    const n = buildChatRows().filter(r => r.unread > 0).length;
    if (window.setNavBadge) window.setNavBadge('chats', n);
}

window.renderChatsList = async function() {
    const query = (document.getElementById('chats-search-input')?.value || '').toLowerCase().trim();
    const container = document.getElementById('chats-threads-container');
    if (!container) return;

    if (!window.cachedDirectoryList) {
        try {
            const snap = await getDocs(collection(db, 'artifacts', appId, 'directory'));
            window.cachedDirectoryList = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
        } catch (e) {
            window.cachedDirectoryList = [];
        }
    }
    watchCommunityChats();
    styleChatsPanel();
    updateChatsBadge();

    let rows = buildChatRows();
    if (window.chatsTab === 'unread') rows = rows.filter(r => r.unread);
    if (window.chatsTab === 'community') rows = rows.filter(r => r.isGroup);
    if (query) rows = rows.filter(r => r.name.toLowerCase().includes(query));

    // Searching also finds people on FutNet you haven't chatted with yet.
    let people = '';
    if (query) {
        const have = new Set(rows.map(r => r.id));
        const found = (window.cachedDirectoryList || []).filter(u => {
            if (!u.uid || u.uid === window.currentUser?.uid || have.has(u.uid)) return false;
            const full = (u.name || `${u.firstName || ''} ${u.lastName || ''}`).toLowerCase();
            return full.includes(query) || (u.nickname || '').toLowerCase().includes(query);
        }).slice(0, 25);
        if (found.length) {
            people = `<div class="px-4 pt-4 pb-1 text-[13px] font-semibold text-[#25D366]">Start a new chat</div>` + found.map(u => {
                const n = u.name || `${u.firstName || ''} ${u.lastName || ''}`.trim() || 'Player';
                return `<div onclick="startChatWithPlayer('${esc(u.uid)}')" class="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-[#202C33]">
                    <img src="${esc(u.avatar || 'https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg')}" onerror="this.src='https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg'" class="w-12 h-12 rounded-full object-cover shrink-0">
                    <div class="min-w-0"><div class="text-[15px] font-semibold text-[#E9EDEF] truncate">${esc(n)}</div>
                    <div class="text-[13px] text-[#8696A0] truncate">${esc(u.position || 'Player')}</div></div></div>`;
            }).join('');
        }
    }

    if (!rows.length && !people) {
        const empty = window.chatsTab === 'unread' ? 'No unread chats 🎉'
            : window.chatsTab === 'community' ? 'No community chats yet. Join a community to chat with its members.'
            : (query ? 'No chats or players found.' : 'No chats yet. Search above to start chatting with anyone!');
        container.innerHTML = `<div class="p-8 text-center text-sm text-[#8696A0]">${empty}</div>`;
        return;
    }
    container.innerHTML = rows.map(chatRowHtml).join('') + people;
};

window.openChatThread = function(id) {
    if (String(id).startsWith('community:')) {
        markCommunityRead(String(id).slice(10));
        window.openCommunityChatThread(id);
        return;
    }
    if (window.chatsTab === 'community') window.setChatsTab('all');
    if (window.stopCommunityChat) window.stopCommunityChat();
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
                avatar: liveAvatar || targetUser.avatar || '',
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
    if (avatarEl) avatarEl.src = photoOf(th.id, th.name, th.avatar);

    // Mark unread messages as read when opening thread and update sender copy
    window.markThreadAsReadLocally(th);

    // Listen to partner typing status
    window._dmPartnerTyping = '';
    window.initTypingListener(id);

    window._forceChatBottom = true;
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
        // Marked read on the LIVE copies of both chat lists (never from this page's copy, so a
        // message that arrives at the same moment from the app is never lost).
        const partner = th.id;
        const markRead = (threads, threadId, isTheirs) => {
            let changed = false;
            (threads || []).forEach(t => {
                if (t.id !== threadId) return;
                (t.messages || []).forEach(m => {
                    if (isTheirs(m) && m.isRead !== true) { m.isRead = true; changed = true; }
                });
            });
            return changed;
        };
        try {
            const myRef = doc(db, 'artifacts', appId, 'directory', myUid);
            const theirRef = doc(db, 'artifacts', appId, 'directory', partner);
            await runTransaction(db, async (tx) => {
                const mine = await tx.get(myRef);
                const theirs = await tx.get(theirRef);
                const myThreads = mine.exists() ? (mine.data().chats || []) : [];
                const theirThreads = theirs.exists() ? (theirs.data().chats || []) : [];
                // my copy: their messages to me are now read
                if (markRead(myThreads, partner, m => m.senderUid !== myUid)) tx.set(myRef, { chats: myThreads }, { merge: true });
                // their copy: blue ticks on what they sent me
                if (theirs.exists() && markRead(theirThreads, myUid, m => m.senderUid === partner)) tx.set(theirRef, { chats: theirThreads }, { merge: true });
            });
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

        const d = snap.exists() ? snap.data() : null;
        // Old "typing" flags that were never switched off are ignored after 10 seconds.
        const t = d && d.timestamp && d.timestamp.toMillis ? d.timestamp.toMillis() : Date.now();
        const typing = !!(d && d.isTyping === true && Date.now() - t < 10000);
        const partnerName = document.getElementById('active-chat-name')?.innerText || 'They';
        window._dmPartnerTyping = typing ? partnerName : '';
        if (typing) {
            subTitleEl.innerText = 'typing…';
            subTitleEl.classList.remove('hidden');
        } else {
            subTitleEl.innerText = "";
            subTitleEl.classList.add('hidden');
        }
        const box = document.getElementById('dm-typing-bubble');
        if (box) {
            const atBottom = isNearBottom();
            box.innerHTML = typingBubbleHtml(typing ? [partnerName] : []);
            if (atBottom) scrollChatToBottom();
        }
    });
};

window.handleChatInputKeypress = function() {
    if (!window.currentUser || !window.activeChatThreadId) return;
    if (String(window.activeChatThreadId).startsWith('community:')) { reportTyping(String(window.activeChatThreadId)); return; }

    // Document ID format: myUid_partnerUid
    const typingRef = doc(db, 'artifacts', appId, 'typing', `${window.currentUser.uid}_${window.activeChatThreadId}`);
    setDoc(typingRef, { isTyping: true, timestamp: serverTimestamp() }, { merge: true });

    if (typingTimeout) clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        setDoc(typingRef, { isTyping: false }, { merge: true });
    }, 2000);
};

window.startChatWithPlayer = function(uid, name, avatar) {
    const u = (window.cachedDirectoryList || []).find(d => d.uid === uid);
    if (!name && u) name = u.name || `${u.firstName || ''} ${u.lastName || ''}`.trim() || 'Player';
    if (!avatar && u) avatar = u.avatar;
    const si = document.getElementById('chats-search-input'); if (si) si.value = '';
    let th = (window.chatsThreads || []).find(t => t.id === uid);
    if (!th) {
        th = {
            id: uid,
            name: name,
            avatar: avatar || '',
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

    container.classList.add('flex-1', 'overflow-y-auto', 'wa-wall');
    container.classList.remove('space-y-3');

    if (!th.messages || th.messages.length === 0) {
        container.innerHTML = `
            <div class="flex flex-col items-center justify-center h-full text-slate-400 space-y-2">
                <i class="fa-solid fa-comments text-3xl opacity-40"></i>
                <p class="text-xs font-semibold">No messages yet. Say hello! 👋</p>
            </div>
        `;
        return;
    }

    const myUid = window.currentUser?.uid;
    const myName = window.userProfile?.name || window.userProfile?.firstName || window.currentUser?.displayName || '';
    const list = th.messages.map(m => {
        const mine = (m.senderUid && m.senderUid === myUid) || (!m.senderUid && myName && m.sender && m.sender.toLowerCase() === myName.toLowerCase());
        return { id: m.id, uid: mine ? myUid : th.id, name: mine ? 'You' : th.name, text: m.text, ms: msOf(m), time: m.time, isRead: m.isRead === true, media: m.media,
            deleted: m.deleted === true, edited: m.edited === true, reactions: m.reactions };
    });
    const atBottom = isNearBottom();
    container.classList.add('wa-wall');
    container.classList.remove('space-y-3', 'p-4');
    container.classList.add('py-2');
    container.innerHTML = renderWhatsApp(list, { myUid, group: false, ticks: true, scope: { kind: 'dm', id: th.id } })
        + `<div id="dm-typing-bubble">${typingBubbleHtml(window._dmPartnerTyping ? [window._dmPartnerTyping] : [])}</div>`;
    if (atBottom || window._forceChatBottom) scrollChatToBottom();
    window._forceChatBottom = false;
};

function isNearBottom() {
    const c = document.getElementById('active-chat-messages');
    return !c || c.scrollHeight - c.scrollTop - c.clientHeight < 120;
}
function scrollChatToBottom() {
    const c = document.getElementById('active-chat-messages');
    if (c) c.scrollTop = c.scrollHeight;
}
window.scrollChatToBottom = scrollChatToBottom;
window.isChatNearBottom = isNearBottom;


window.handleSendActiveChatMessage = async function(e) {
    e.preventDefault();
    const input = document.getElementById('active-chat-input');
    if (!input) return;
    const text = input.value.trim();
    if (!text || !window.activeChatThreadId || !window.currentUser) return;
    input.value = '';
    await sendToActiveChat(text, null);
};

// 📎 A photo or video was picked in the open chat (private or community).
async function sendChatFile(file) {
    const tid = String(window.activeChatThreadId || '');
    if (!tid || !window.currentUser) return;
    const isCommunity = tid.startsWith('community:');
    const folder = isCommunity
        ? `community/${tid.slice(10)}`
        : `chat/${[window.currentUser.uid, tid].sort().join('_')}`;
    const kind = String(file.type).startsWith('video/') ? 'video' : 'image';
    const input = document.getElementById('active-chat-input');
    const caption = input ? input.value.trim() : '';
    try {
        showUploadProgress(kind === 'video' ? 'Sending video…' : 'Sending photo…', 0);
        const media = await uploadMedia(file, folder, (p) => showUploadProgress(kind === 'video' ? 'Sending video…' : 'Sending photo…', p));
        if (input) input.value = '';
        await sendToActiveChat(caption || MEDIA_LABEL[kind], media);
    } catch (err) {
        console.error('media upload failed', err);
        if (window.showToast) window.showToast(mediaErrorText(err), 'error');
    } finally {
        hideUploadProgress();
    }
}

// The 📎 button next to the message box (added once).
function ensureChatAttach() {
    addAttachButton(document.getElementById('active-chat-input'), sendChatFile);
}
document.addEventListener('DOMContentLoaded', ensureChatAttach);
setTimeout(ensureChatAttach, 1500);

async function sendToActiveChat(text, media) {
    ensureChatAttach();
    if (String(window.activeChatThreadId).startsWith('community:')) {
        stopTyping(String(window.activeChatThreadId));
        window._forceChatBottom = true;
        window.sendCommunityChatMessage(text, media);
        return;
    }

    let th = window.chatsThreads.find(t => t.id === window.activeChatThreadId);
    if (!th) {
        let targetUser = (window.cachedDirectoryList || []).find(d => d.uid === window.activeChatThreadId);
        const displayName = targetUser?.name || `${targetUser?.firstName || ''} ${targetUser?.lastName || ''}`.trim() || 'Player';
        th = {
            id: window.activeChatThreadId,
            name: displayName,
            avatar: targetUser?.avatar || '',
            messages: []
        };
        window.chatsThreads.push(th);
    }

    const senderName = window.userProfile?.name || window.userProfile?.firstName || window.currentUser?.displayName || 'Player';
    const rawAvatar = window.userProfile?.avatar || window.currentUser?.photoURL || '';
    // Only short web links are copied into messages (big saved photos would fill the chat record).
    const senderAvatar = /^https?:\/\//i.test(rawAvatar) && rawAvatar.length < 400 ? rawAvatar : '';

    const newMessage = {
        id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9),
        senderUid: window.currentUser.uid,
        sender: senderName,
        text: text,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        avatar: senderAvatar,
        isRead: false
    };
    if (media) newMessage.media = media;

    th.messages.push(newMessage);
    
    // Trim messages to keep the last 100 messages (protecting against the 1MB document limit)
    th.messages = th.messages.slice(-100);

    if (typingTimeout) clearTimeout(typingTimeout);
    setDoc(doc(db, 'artifacts', appId, 'typing', `${window.currentUser.uid}_${th.id}`), { isTyping: false }, { merge: true }).catch(() => {});

    window._forceChatBottom = true;
    window.renderActiveChatMessages();
    window.renderChatsList();

    // Saved on the LIVE copies of both chat lists in one step (same as the apps). Before, this page
    // re-saved its own copy of the whole list, which could erase a message that had just arrived.
    const myUid = window.currentUser.uid;
    const partnerName = th.name || 'Player';
    const partnerAvatar = /^https?:\/\//i.test(th.avatar || '') && String(th.avatar).length < 400 && th.avatar !== STOCK ? th.avatar : '';
    const addTo = (threads, threadId, name, avatar) => {
        let t = threads.find(x => x.id === threadId);
        if (!t) { t = { id: threadId, name, avatar, messages: [] }; threads.push(t); }
        t.messages = Array.isArray(t.messages) ? t.messages : [];
        if (!t.messages.some(m => m.id === newMessage.id)) t.messages.push(newMessage);
        t.messages = t.messages.slice(-100);   // keeps the record well under Firestore's size limit
    };
    try {
        const myRef = doc(db, 'artifacts', appId, 'directory', myUid);
        const theirRef = doc(db, 'artifacts', appId, 'directory', th.id);
        await runTransaction(db, async (tx) => {
            const mine = await tx.get(myRef);
            const theirs = await tx.get(theirRef);
            const myThreads = mine.exists() ? (mine.data().chats || []) : [];
            const theirThreads = theirs.exists() ? (theirs.data().chats || []) : [];
            addTo(myThreads, th.id, partnerName, partnerAvatar);
            addTo(theirThreads, myUid, senderName, senderAvatar);
            tx.set(myRef, { chats: myThreads }, { merge: true });
            tx.set(theirRef, { chats: theirThreads }, { merge: true });
        });
        // The push notification is sent by the server (onChatMessage) as soon as this saves.
    } catch (err) {
        console.error("Error saving chat:", err);
        if (window.showToast) window.showToast('Message not sent. Check your connection and try again.', 'error');
    }
};

// Starts the live chat listener as soon as someone is signed in (and restarts it for a different account),
// so new messages and the red dot on Chats show up live on every page, not only on the Chats tab.
let chatListenerUid = null;
setInterval(() => {
    const uid = window.currentUser?.uid || null;
    if (uid === chatListenerUid) return;
    chatListenerUid = uid;
    if (uid) window.initChatListener();
    else { if (chatUnsubscribe) chatUnsubscribe(); chatUnsubscribe = null; window.chatsThreads = []; updateChatsBadge(); }
}, 700);
