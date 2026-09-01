// js/friends.js: Real-time live Firestore syncing for Friends, Player Search Autocomplete, Sent Requests, and Received Requests
import { db, appId } from './firebase-config.js';
import { doc, getDoc, setDoc, onSnapshot, collection, getDocs } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

let friendsUnsubscribe = null;

window.initFriendsLiveListener = function() {
    if (!window.currentUser) return;
    if (friendsUnsubscribe) friendsUnsubscribe();

    const userFriendsRef = doc(db, 'artifacts', appId, 'users', window.currentUser.uid, 'relationships', 'data');

    friendsUnsubscribe = onSnapshot(userFriendsRef, async (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();
            window.friendsList = data.friends || [];
            window.sentRequestsList = data.sentRequests || [];
            window.receivedRequestsList = data.receivedRequests || [];
        } else {
            window.friendsList = [];
            window.sentRequestsList = [];
            window.receivedRequestsList = [];
        }

        const badge = document.getElementById('friends-badge');
        if (badge) {
            const pendingCount = window.receivedRequestsList.length;
            if (pendingCount > 0) {
                badge.innerText = pendingCount;
                badge.classList.remove('hidden');
            } else {
                badge.classList.add('hidden');
            }
        }

        if (window.renderFriends) window.renderFriends();
    }, (error) => {
        console.error("Error listening to friends live:", error);
    });
};

window.renderFriends = async function() {
    const friendsContainer = document.getElementById('my-friends-list');
    const searchInput = document.getElementById('friend-search-input');
    const dropdown = document.getElementById('search-dropdown');
    if (!friendsContainer) return;

    if (!window.cachedDirectoryList) {
        try {
            const snap = await getDocs(collection(db, 'artifacts', appId, 'directory'));
            window.cachedDirectoryList = snap.docs.map(d => d.data());
        } catch (e) {
            window.cachedDirectoryList = [];
        }
    }

    if (searchInput && dropdown) {
        const query = searchInput.value.toLowerCase().trim();
        if (query.length > 0) {
            const matches = window.cachedDirectoryList.filter(u => {
                if (u.uid === window.currentUser?.uid) return false;
                const fullName = (u.name || `${u.firstName || ''} ${u.lastName || ''}`).toLowerCase();
                const nickName = (u.nickname || '').toLowerCase();
                return fullName.includes(query) || nickName.includes(query);
            });

            if (matches.length > 0) {
                dropdown.innerHTML = matches.map(u => {
                    const isAlreadyFriend = (window.friendsList || []).some(f => f.uid === u.uid);
                    const isSent = (window.sentRequestsList || []).includes(u.uid);
                    const isReceived = (window.receivedRequestsList || []).includes(u.uid);
                    const displayName = u.name || `${u.firstName || ''} ${u.lastName || ''}`.trim() || 'Player';

                    return `
                        <div class="p-3 flex items-center justify-between hover:bg-slate-50 transition text-xs">
                            <div class="flex items-center gap-2.5 cursor-pointer" onclick="viewPlayerProfile('${u.uid}', '${displayName.replace(/'/g, "\\'")}')">
                                <img src="${u.avatar || 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100'}" class="w-8 h-8 rounded-full object-cover border border-slate-200">
                                <div>
                                    <div class="font-bold text-slate-900">${displayName} ${u.nickname ? '('+u.nickname+')' : ''}</div>
                                    <div class="text-[10px] text-slate-500">${u.position || 'Player'}</div>
                                </div>
                            </div>
                            ${isAlreadyFriend ? '<span class="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-2 py-1 rounded-lg">Friend</span>' : 
                              isSent ? '<span class="text-[10px] bg-amber-100 text-amber-800 font-bold px-2 py-1 rounded-lg">Request Sent</span>' : 
                              isReceived ? '<span class="text-[10px] bg-blue-100 text-blue-800 font-bold px-2 py-1 rounded-lg">Incoming Request</span>' :
                              `<button onclick="sendFriendRequest('${u.uid}')" class="bg-brand text-slate-950 font-black px-3 py-1.5 rounded-xl text-[10px] shadow">Send Request</button>`}
                        </div>
                    `;
                }).join('');
                dropdown.classList.remove('hidden');
            } else {
                dropdown.innerHTML = `<div class="p-3 text-xs text-slate-500 italic">No players found matching "${query}"</div>`;
                dropdown.classList.remove('hidden');
            }
        } else {
            dropdown.classList.add('hidden');
        }
    }

    const friends = window.friendsList || [];
    const received = window.receivedRequestsList || [];
    const sent = window.sentRequestsList || [];

    friendsContainer.innerHTML = `
        <div class="space-y-6">
            <div class="space-y-3">
                <h3 class="text-xs font-black text-slate-400 uppercase tracking-wider">My Squad (${friends.length})</h3>
                ${friends.length === 0 ? '<p class="text-xs text-slate-500 italic">No friends in your squad yet. Search above to add players!</p>' : ''}
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    ${friends.map(f => {
                        const fName = f.name || `${f.firstName || ''} ${f.lastName || ''}`.trim() || 'Player';
                        return `
                            <div class="bg-[#090d16] border border-slate-800 rounded-2xl p-3 flex items-center justify-between shadow-sm">
                                <div class="flex items-center gap-3 cursor-pointer" onclick="viewPlayerProfile('${f.uid}', '${fName.replace(/'/g, "\\'")}')">
                                    <img src="${f.avatar || 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100'}" class="w-9 h-9 rounded-full object-cover">
                                    <div>
                                        <div class="text-xs font-bold text-white">${fName}</div>
                                        <div class="text-[10px] text-brand">Squad Member</div>
                                    </div>
                                </div>
                                <div class="flex items-center gap-2">
                                    <button onclick="openDirectChat('${f.uid}', '${fName.replace(/'/g, "\\'")}', '${f.avatar || ''}')" class="bg-slate-800 hover:bg-slate-700 text-slate-200 p-2 rounded-xl text-xs transition" title="Message">
                                        <i class="fa-solid fa-comments"></i>
                                    </button>
                                    <button onclick="confirmRemoveFriend('${f.uid}', '${fName.replace(/'/g, "\\'")}')" class="text-red-400 hover:text-red-300 p-2 rounded-xl text-xs transition" title="Remove">
                                        <i class="fa-solid fa-user-minus"></i>
                                    </button>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>

            ${received.length > 0 ? `
                <div class="space-y-3 pt-4 border-t border-slate-800">
                    <h3 class="text-xs font-black text-amber-400 uppercase tracking-wider">Received Requests (${received.length})</h3>
                    <div class="space-y-2">
                        ${received.map(reqUid => {
                            const p = (window.cachedDirectoryList || []).find(d => d.uid === reqUid) || { uid: reqUid, name: 'Player', firstName: 'Player', avatar: 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100' };
                            const pName = p.name || `${p.firstName || ''} ${p.lastName || ''}`.trim() || 'Player';
                            return `
                                <div class="bg-[#090d16] border border-slate-800 rounded-2xl p-3 flex items-center justify-between shadow-sm">
                                    <div class="flex items-center gap-3 cursor-pointer" onclick="viewPlayerProfile('${p.uid}', '${pName.replace(/'/g, "\\'")}')">
                                        <img src="${p.avatar || 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100'}" class="w-8 h-8 rounded-full object-cover">
                                        <div>
                                            <div class="text-xs font-bold text-white">${pName}</div>
                                            <span class="text-[10px] text-amber-400">Incoming Request</span>
                                        </div>
                                    </div>
                                    <div class="flex gap-2">
                                        <button onclick="acceptFriendRequest('${p.uid}')" class="bg-brand text-slate-950 font-black px-3 py-1.5 rounded-xl text-xs shadow">Accept</button>
                                        <button onclick="denyFriendRequest('${p.uid}')" class="bg-red-500/20 text-red-400 border border-red-500/30 px-3 py-1.5 rounded-xl text-xs font-bold">Deny</button>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            ` : ''}

            ${sent.length > 0 ? `
                <div class="space-y-3 pt-4 border-t border-slate-800">
                    <h3 class="text-xs font-black text-slate-400 uppercase tracking-wider">Sent Requests (${sent.length})</h3>
                    <div class="space-y-2">
                        ${sent.map(reqUid => {
                            const p = (window.cachedDirectoryList || []).find(d => d.uid === reqUid) || { uid: reqUid, name: 'Player', firstName: 'Player', avatar: 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100' };
                            const pName = p.name || `${p.firstName || ''} ${p.lastName || ''}`.trim() || 'Player';
                            return `
                                <div class="bg-[#090d16] border border-slate-800 rounded-2xl p-3 flex items-center justify-between shadow-sm opacity-80">
                                    <div class="flex items-center gap-3 cursor-pointer" onclick="viewPlayerProfile('${p.uid}', '${pName.replace(/'/g, "\\'")}')">
                                        <img src="${p.avatar || 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100'}" class="w-8 h-8 rounded-full object-cover">
                                        <div>
                                            <div class="text-xs font-bold text-slate-300">${pName}</div>
                                            <span class="text-[10px] text-slate-500">Request Pending</span>
                                        </div>
                                    </div>
                                    <span class="text-[10px] bg-slate-800 text-slate-400 font-bold px-2.5 py-1 rounded-full">Sent</span>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            ` : ''}
        </div>
    `;
};

window.sendFriendRequest = async function(targetUid) {
    if (!window.currentUser) return;
    try {
        const myUid = window.currentUser.uid;
        if (!window.sentRequestsList.includes(targetUid)) {
            window.sentRequestsList.push(targetUid);
            const myRef = doc(db, 'artifacts', appId, 'users', myUid, 'relationships', 'data');
            await setDoc(myRef, {
                friends: window.friendsList,
                sentRequests: window.sentRequestsList,
                receivedRequests: window.receivedRequestsList
            }, { merge: true });

            const targetRef = doc(db, 'artifacts', appId, 'users', targetUid, 'relationships', 'data');
            const targetSnap = await getDoc(targetRef);
            let targetData = targetSnap.exists() ? targetSnap.data() : { friends: [], sentRequests: [], receivedRequests: [] };
            targetData.receivedRequests = targetData.receivedRequests || [];
            if (!targetData.receivedRequests.includes(myUid)) {
                targetData.receivedRequests.push(myUid);
                await setDoc(targetRef, targetData, { merge: true });
            }

            window.showToast("Friend request sent!");
            const searchInput = document.getElementById('friend-search-input');
            if (searchInput) searchInput.value = '';
            const dropdown = document.getElementById('search-dropdown');
            if (dropdown) dropdown.classList.add('hidden');
            window.renderFriends();
        }
    } catch (e) {
        console.error("Error sending friend request:", e);
        window.showToast("Failed to send request", "error");
    }
};

window.acceptFriendRequest = async function(friendUid) {
    if (!window.currentUser) return;
    try {
        const myUid = window.currentUser.uid;
        window.receivedRequestsList = window.receivedRequestsList.filter(id => id !== friendUid);
        
        const friendProfile = (window.cachedDirectoryList || []).find(d => d.uid === friendUid) || { uid: friendUid, name: 'Player', firstName: 'Player', avatar: '' };
        const friendName = friendProfile.name || `${friendProfile.firstName || ''} ${friendProfile.lastName || ''}`.trim() || 'Player';

        if (!window.friendsList.some(f => f.uid === friendUid)) {
            window.friendsList.push({ uid: friendUid, name: friendName, avatar: friendProfile.avatar });
        }

        const myRef = doc(db, 'artifacts', appId, 'users', myUid, 'relationships', 'data');
        await setDoc(myRef, {
            friends: window.friendsList,
            sentRequests: window.sentRequestsList,
            receivedRequests: window.receivedRequestsList
        }, { merge: true });

        const friendRef = doc(db, 'artifacts', appId, 'users', friendUid, 'relationships', 'data');
        const friendSnap = await getDoc(friendRef);
        if (friendSnap.exists()) {
            let fData = friendSnap.data();
            fData.sentRequests = (fData.sentRequests || []).filter(id => id !== myUid);
            fData.friends = fData.friends || [];
            const myFullName = window.userProfile.name || `${window.userProfile.firstName || ''} ${window.userProfile.lastName || ''}`.trim() || 'Player';
            if (!fData.friends.some(f => f.uid === myUid)) {
                fData.friends.push({ uid: myUid, name: myFullName, avatar: window.userProfile.avatar });
            }
            await setDoc(friendRef, fData, { merge: true });
        }

        window.showToast("Friend request accepted!");
        window.renderFriends();
    } catch (e) {
        console.error("Error accepting friend request:", e);
    }
};

window.denyFriendRequest = async function(friendUid) {
    if (!window.currentUser) return;
    try {
        window.receivedRequestsList = window.receivedRequestsList.filter(id => id !== friendUid);
        const myRef = doc(db, 'artifacts', appId, 'users', window.currentUser.uid, 'relationships', 'data');
        await setDoc(myRef, {
            friends: window.friendsList,
            sentRequests: window.sentRequestsList,
            receivedRequests: window.receivedRequestsList
        }, { merge: true });

        window.showToast("Friend request denied.");
        window.renderFriends();
    } catch (e) {
        console.error("Error denying friend request:", e);
    }
};

window.confirmRemoveFriend = function(uid, name) {
    if (confirm(`Are you sure you want to remove ${name} from your squad?`)) {
        window.removeFriend(uid);
    }
};

window.removeFriend = async function(uid) {
    if (!window.currentUser) return;
    try {
        window.friendsList = window.friendsList.filter(f => f.uid !== uid);
        const myRef = doc(db, 'artifacts', appId, 'users', window.currentUser.uid, 'relationships', 'data');
        await setDoc(myRef, {
            friends: window.friendsList,
            sentRequests: window.sentRequestsList,
            receivedRequests: window.receivedRequestsList
        }, { merge: true });

        const friendRef = doc(db, 'artifacts', appId, 'users', uid, 'relationships', 'data');
        const friendSnap = await getDoc(friendRef);
        if (friendSnap.exists()) {
            let fData = friendSnap.data();
            fData.friends = (fData.friends || []).filter(f => f.uid !== window.currentUser.uid);
            await setDoc(friendRef, fData, { merge: true });
        }

        window.showToast("Removed player from squad.");
        window.renderFriends();
    } catch (e) {
        console.error("Error removing friend:", e);
    }
};

window.openDirectChat = function(uid, name, avatar) {
    window.switchTab('chat');
    if (window.startChatWithPlayer) {
        window.startChatWithPlayer(uid, name, avatar);
    }
};

setTimeout(() => {
    if (window.currentUser && window.initFriendsLiveListener) {
        window.initFriendsLiveListener();
    }
}, 1000);