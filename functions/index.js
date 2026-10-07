// FutNet Cloud Functions: every push notification goes through ONE sender
// (sendChatNotification). Everything else just writes a notification record to
// artifacts/{appId}/notifications and the sender pushes it to the person's phones.
//
// Because the triggers below watch the database itself, notifications work no matter
// whether the action happened on the website or in the iOS app.

const { onDocumentCreated, onDocumentUpdated, onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const { logger } = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();
setGlobalOptions({ maxInstances: 20 });

const db = admin.firestore();
const APP_ID = "futnetsite-de7c3";
const BASE = `artifacts/${APP_ID}`;
const col = (name) => db.collection("artifacts").doc(APP_ID).collection(name);

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const uidOf = (p) => (p && (p.uid || p.userId || p.id)) || "";
const arr = (v) => (Array.isArray(v) ? v : []);
const uniq = (list) => [...new Set(list.filter(Boolean))];
const clip = (s, n = 140) => {
  const t = String(s || "").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};
const tenMinuteBucket = () => Math.floor(Date.now() / 600000);

const nameCache = new Map();
async function nameOf(uid) {
  if (!uid) return "Someone";
  if (nameCache.has(uid)) return nameCache.get(uid);
  let name = "Someone";
  try {
    const d = (await col("directory").doc(uid).get()).data() || {};
    name = (d.name || `${d.firstName || ""} ${d.lastName || ""}`.trim() || d.nickname || "Someone").trim();
  } catch (e) {
    logger.warn("name lookup failed", uid, e.message);
  }
  nameCache.set(uid, name);
  return name;
}

/** People on the game: confirmed + waitlist. */
function participants(game) {
  return uniq([...arr(game.attendees), ...arr(game.waitingList)].map(uidOf));
}

/** Members of a community, including its creator/admin. */
async function communityMembers(communityId) {
  if (!communityId) return { all: [], admins: [], community: {} };
  const ref = col("communities").doc(communityId);
  const [cSnap, mSnap] = await Promise.all([ref.get(), ref.collection("members").get()]);
  const community = cSnap.data() || {};
  const owner = community.creatorId || community.adminId || "";
  const all = uniq([owner, ...mSnap.docs.map((d) => d.id)]);
  const admins = uniq([owner, ...mSnap.docs.filter((d) => (d.data() || {}).role === "admin").map((d) => d.id)]);
  return { all, admins, community };
}

/**
 * Writes one notification record per recipient. The sender function pushes each one.
 * `key` makes the record id stable, so the same event never pushes twice
 * (writing to an existing id is an update, which does not trigger a push).
 */
async function notify(recipients, payload, { exclude = [], key = "" } = {}) {
  const skip = new Set(exclude.filter(Boolean));
  const targets = uniq(recipients).filter((u) => !skip.has(u));
  if (!targets.length) return 0;

  for (let i = 0; i < targets.length; i += 400) {
    const batch = db.batch();
    for (const uid of targets.slice(i, i + 400)) {
      const ref = key ? col("notifications").doc(`${key}_${uid}`.slice(0, 1400)) : col("notifications").doc();
      batch.set(ref, {
        recipientUid: uid,
        senderUid: payload.senderUid || "",
        type: payload.type || "general",
        title: payload.title || "FutNet",
        body: payload.body || "",
        eventId: payload.eventId || "",
        communityId: payload.communityId || "",
        chatId: payload.chatId || "",
        read: false,
        source: "server",
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
  }
  return targets.length;
}

/** Which on/off switch in the user's settings a notification type belongs to. */
function categoryOf(type) {
  if (type.startsWith("chat")) return "chat";
  if (type.startsWith("friend")) return "friends";
  if (type.startsWith("community")) return "community";
  if (type === "broadcast") return "invites";
  return "games";
}

// ---------------------------------------------------------------------------
// 1. The sender: pushes every notification record to the recipient's phones
//    (kept under its original name so the deploy updates it in place)
// ---------------------------------------------------------------------------

exports.sendChatNotification = onDocumentCreated(`${BASE}/notifications/{notificationId}`, async (event) => {
  const snap = event.data;
  if (!snap) return;
  const n = snap.data();
  const type = n.type || "general";

  // Chats and friend requests are now detected on the server, so the copies the
  // website/app used to write are removed instead of pushed twice.
  if (n.source !== "server" && (type === "chat_message" || type === "friend_request")) {
    await snap.ref.delete();
    return;
  }

  const recipientUid = n.recipientUid;
  if (!recipientUid) return;

  const dirRef = col("directory").doc(recipientUid);
  const dir = (await dirRef.get()).data();
  if (!dir) {
    logger.info("No directory profile for", recipientUid);
    return;
  }

  // The person turned this kind of notification off: keep it in the in-app list, no push.
  const prefs = dir.notificationPrefs || {};
  if (prefs[categoryOf(type)] === false) {
    await snap.ref.update({ muted: true });
    return;
  }

  // One person can be signed in on several phones.
  let tokens = uniq([dir.fcmToken, dir.fcmToke, ...arr(dir.fcmTokens)]);

  // A phone that is also signed in as the person who did the action (for example a test
  // account used on the same phone) never gets a push about its own action.
  if (n.senderUid && n.senderUid !== recipientUid) {
    const sender = (await col("directory").doc(n.senderUid).get()).data() || {};
    const senderTokens = new Set(uniq([sender.fcmToken, sender.fcmToke, ...arr(sender.fcmTokens)]));
    tokens = tokens.filter((t) => !senderTokens.has(t));
  }
  if (!tokens.length) {
    logger.info("No FCM token for", recipientUid);
    return;
  }

  const data = {
    type,
    notificationId: snap.id,
    senderUid: n.senderUid || "",
    eventId: n.eventId || "",
    communityId: n.communityId || "",
    chatId: n.chatId || "",
  };

  const res = await admin.messaging().sendEachForMulticast({
    tokens,
    notification: { title: n.title || "FutNet", body: n.body || "" },
    data,
    apns: {
      payload: {
        aps: {
          sound: "default",
          // Groups notifications on the lock screen (one stack per chat / per game).
          "thread-id": n.chatId || n.eventId || n.communityId || type,
        },
      },
    },
  });

  // Forget phones that uninstalled the app or signed out.
  const dead = [];
  res.responses.forEach((r, i) => {
    const code = r.error && r.error.code;
    if (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token") {
      dead.push(tokens[i]);
    } else if (r.error) {
      logger.error("Push failed", recipientUid, code, r.error.message);
    }
  });
  if (dead.length) {
    const update = { fcmTokens: admin.firestore.FieldValue.arrayRemove(...dead) };
    if (dead.includes(dir.fcmToken)) update.fcmToken = admin.firestore.FieldValue.delete();
    await dirRef.update(update);
  }

  await snap.ref.update({
    sent: res.successCount > 0,
    sentAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  logger.info(`Pushed ${type} to ${recipientUid}: ${res.successCount}/${tokens.length} devices`);
});

// ---------------------------------------------------------------------------
// 2. Chat messages (website and app both save chats on the directory profile)
// ---------------------------------------------------------------------------

exports.onChatMessage = onDocumentWritten(`${BASE}/directory/{uid}`, async (event) => {
  if (!event.data.after.exists) return;
  const owner = event.params.uid;
  const before = event.data.before.exists ? event.data.before.data() : {};
  const after = event.data.after.data() || {};
  if (!Array.isArray(after.chats)) return;

  // Works for someone's very first chat too (no chats saved before).
  // Old history is never pushed thanks to the 10-minute check below.
  const seen = new Set();
  for (const t of arr(before.chats)) for (const m of arr(t.messages)) if (m && m.id) seen.add(m.id);

  for (const thread of after.chats) {
    const fresh = arr(thread.messages).filter((m) => m && m.id && !seen.has(m.id) && m.senderUid && m.senderUid !== owner);
    if (!fresh.length) continue;

    // Message ids look like "msg_<milliseconds>_xxx": ignore anything older than 10 minutes.
    const last = fresh[fresh.length - 1];
    const ms = Number(String(last.id).split("_")[1]);
    if (ms && Date.now() - ms > 10 * 60 * 1000) continue;

    const from = last.senderUid;
    await notify([owner], {
      type: "chat_message",
      senderUid: from,
      chatId: from,
      title: last.sender || thread.name || (await nameOf(from)),
      body: fresh.length > 1 ? `${fresh.length} new messages` : clip(last.text),
    }, { key: `chat_${last.id}` });
  }
});

// ---------------------------------------------------------------------------
// 3. Friend requests sent and accepted
// ---------------------------------------------------------------------------

// Website: users/{uid}/relationships/data holds friends / sentRequests / receivedRequests
exports.onFriendsChanged = onDocumentWritten(`${BASE}/users/{uid}/relationships/{docId}`, async (event) => {
  if (event.params.docId !== "data" || !event.data.after.exists) return;
  const me = event.params.uid;
  const before = event.data.before.exists ? event.data.before.data() : {};
  const after = event.data.after.data() || {};

  // Someone sent me a request
  const oldReceived = new Set(arr(before.receivedRequests));
  for (const from of arr(after.receivedRequests).filter((u) => !oldReceived.has(u))) {
    await notify([me], {
      type: "friend_request",
      senderUid: from,
      title: "New Friend Request",
      body: `${await nameOf(from)} sent you a friend request on FutNet!`,
    }, { key: `friendreq_${from}` });
  }

  // Someone accepted the request I sent
  const oldFriends = new Set(arr(before.friends).map(uidOf));
  const iSentTo = new Set(arr(before.sentRequests));
  for (const f of arr(after.friends).map(uidOf).filter((u) => u && !oldFriends.has(u) && iSentTo.has(u))) {
    await notify([me], {
      type: "friend_accepted",
      senderUid: f,
      title: "Friend request accepted 🤝",
      body: `${await nameOf(f)} accepted your friend request.`,
    }, { key: `friendacc_${f}` });
  }
});

// iOS roster sheet writes to friendRequests (see note in the chat about syncing this with the website)
exports.onFriendRequestDoc = onDocumentWritten(`${BASE}/friendRequests/{id}`, async (event) => {
  if (!event.data.after.exists) return;
  const before = event.data.before.exists ? event.data.before.data() : null;
  const r = event.data.after.data() || {};
  if (!before && r.status !== "accepted") {
    await notify([r.receiverId], {
      type: "friend_request",
      senderUid: r.senderId,
      title: "New Friend Request",
      body: `${await nameOf(r.senderId)} sent you a friend request on FutNet!`,
    }, { key: `friendreq_${r.senderId}` });
  } else if (before && before.status !== "accepted" && r.status === "accepted") {
    await notify([r.senderId], {
      type: "friend_accepted",
      senderUid: r.receiverId,
      title: "Friend request accepted 🤝",
      body: `${await nameOf(r.receiverId)} accepted your friend request.`,
    }, { key: `friendacc_${r.receiverId}` });
  }
});

// ---------------------------------------------------------------------------
// 4. Games: new community game, joins, edits, cancels, comments, teams, End Event
// ---------------------------------------------------------------------------

const EDIT_FIELDS = ["title", "date", "time", "location", "format", "teamsCount", "fee", "description", "rules"];

function teamMap(game) {
  // uid -> team index, from the website's teamAssignments { "0": [{uid, ...}], ... }
  const out = {};
  const ta = game.teamAssignments || {};
  for (const [idx, list] of Object.entries(ta)) {
    for (const p of arr(list)) {
      if (p && !p.isHostGuest && uidOf(p)) out[uidOf(p)] = idx;
    }
  }
  return out;
}

function teamName(game, idx) {
  const names = game.teamNames || {};
  return names[idx] || (Array.isArray(names) && names[Number(idx)]) || `Team ${Number(idx) + 1}`;
}

const commentAuthor = (c) => (c && (c.uid || c.userId || c.authorId || c.authorUid || c.senderUid || c.senderId || c.createdBy || c.ownerId || c.userUid)) || "";
const commentText = (c) => (c && (c.text || c.comment || c.message || c.body)) || "";
const commentName = (c) => (c && (c.name || c.authorName || c.author || c.senderName)) || "";

async function notifyGameCancelled(game, eventId) {
  await notify(participants(game), {
    type: "game_cancelled",
    senderUid: game.organizerId,
    eventId,
    title: "Game cancelled ❌",
    body: `${game.title || "Your game"} on ${game.date || ""} ${game.time || ""} was cancelled by the organizer.`.replace(/\s+/g, " "),
  }, { exclude: [game.organizerId], key: `cancel_${eventId}` });
}

exports.onGameWritten = onDocumentWritten(`${BASE}/eventsList/{eventId}`, async (event) => {
  const eventId = event.params.eventId;
  const before = event.data.before.exists ? event.data.before.data() : null;
  const after = event.data.after.exists ? event.data.after.data() : null;
  const organizer = (after || before || {}).organizerId || "";

  // New game: tell the community it belongs to
  if (!before && after) {
    if (after.communityId) {
      const { all, community } = await communityMembers(after.communityId);
      const cName = after.communityName || community.name || "your community";
      await notify(all, {
        type: "community_new_game",
        senderUid: organizer,
        eventId,
        communityId: after.communityId,
        title: `New game in ${cName} ⚽`,
        body: `${after.title || "Pick-up game"} · ${after.date || ""} at ${after.time || ""}. Tap to join!`,
      }, { exclude: [organizer], key: `newgame_${eventId}` });
    }
    return;
  }

  // Game deleted
  if (before && !after) {
    await notifyGameCancelled(before, eventId);
    return;
  }

  // Game marked cancelled instead of deleted
  const wasCancelled = (g) => g.isCancelled === true || String(g.status || "").toLowerCase() === "cancelled";
  if (!wasCancelled(before) && wasCancelled(after)) {
    await notifyGameCancelled(after, eventId);
    return;
  }

  const title = after.title || "your game";

  // a) New players on the roster -> tell the organizer
  const beforeIn = new Set(arr(before.attendees).map(uidOf));
  const joined = arr(after.attendees).map(uidOf).filter((u) => u && !beforeIn.has(u) && u !== organizer);
  if (joined.length) {
    const first = await nameOf(joined[0]);
    await notify([organizer], {
      type: "game_join",
      senderUid: joined[0],
      eventId,
      title: "New player joined 🙌",
      body: joined.length === 1 ? `${first} joined ${title}.` : `${first} and ${joined.length - 1} more joined ${title}.`,
    });
  }

  // b) Non-members asking to join a community game -> tell the organizer
  const beforeReq = new Set(arr(before.joinRequests).map(uidOf));
  for (const r of arr(after.joinRequests).filter((x) => uidOf(x) && !beforeReq.has(uidOf(x)))) {
    await notify([organizer], {
      type: "game_join_request",
      senderUid: uidOf(r),
      eventId,
      title: "Join request",
      body: `${r.name || (await nameOf(uidOf(r)))} wants to join ${title}.`,
    }, { key: `gamereq_${eventId}_${uidOf(r)}` });
  }

  // c) Organizer edited the game details -> tell everyone on it
  const changed = EDIT_FIELDS.filter((f) => JSON.stringify(before[f] ?? null) !== JSON.stringify(after[f] ?? null));
  if (changed.length) {
    const whenWhere = ["date", "time", "location"].some((f) => changed.includes(f));
    await notify(participants(after), {
      type: "game_updated",
      senderUid: organizer,
      eventId,
      title: `${title} was updated ✏️`,
      body: whenWhere
        ? `Now ${after.date || ""} at ${after.time || ""} · ${after.location || ""}`.replace(/\s+/g, " ")
        : "The organizer changed the game details. Tap to see what's new.",
    }, { exclude: [organizer], key: `edit_${eventId}_${tenMinuteBucket()}` });
  }

  // d) New comments saved on the game itself
  const oldCount = arr(before.comments).length;
  const newComments = arr(after.comments).slice(oldCount);
  for (const c of newComments) {
    const author = commentAuthor(c);
    await notify(uniq([...participants(after), organizer]), {
      type: "game_comment",
      senderUid: author,
      eventId,
      title: `${commentName(c) || (await nameOf(author))} commented on ${title}`,
      body: clip(commentText(c)),
    }, { exclude: [author] });
  }

  // e) Teams: tell each player when they are put on (or moved to) a team
  const oldTeams = teamMap(before);
  const newTeams = teamMap(after);
  for (const [uid, idx] of Object.entries(newTeams)) {
    if (oldTeams[uid] === idx) continue;
    await notify([uid], {
      type: "team_assigned",
      senderUid: organizer,
      eventId,
      title: "You've been assigned to a team 👕",
      body: `You're on ${teamName(after, idx)} for ${title}.`,
    }, { key: `team_${eventId}_${uid}_${idx}` });
  }

  // f) Admin tapped End Event -> results are ready
  if (!before.isSessionEnded && after.isSessionEnded === true) {
    await notify(uniq([...participants(after), organizer]), {
      type: "session_results",
      senderUid: organizer,
      eventId,
      title: "Session over 🏁",
      body: `Final results for ${title} are in. See who won!`,
    }, { key: `results_${eventId}` });
  }
});

// Comments saved in a sub-collection (if the app stores them that way)
exports.onGameCommentDoc = onDocumentCreated(`${BASE}/eventsList/{eventId}/comments/{commentId}`, async (event) => {
  const c = event.data && event.data.data();
  if (!c) return;
  const eventId = event.params.eventId;
  const game = (await col("eventsList").doc(eventId).get()).data();
  if (!game) return;
  const author = commentAuthor(c);
  await notify(uniq([...participants(game), game.organizerId]), {
    type: "game_comment",
    senderUid: author,
    eventId,
    title: `${commentName(c) || (await nameOf(author))} commented on ${game.title || "your game"}`,
    body: clip(commentText(c)),
  }, { exclude: [author], key: `comment_${event.params.commentId}` });
});

// ---------------------------------------------------------------------------
// 5. Communities: info changed, new member
// ---------------------------------------------------------------------------

const COMMUNITY_FIELDS = ["name", "description", "city", "thumbnail", "rules"];

exports.onCommunityUpdated = onDocumentUpdated(`${BASE}/communities/{communityId}`, async (event) => {
  const before = event.data.before.data() || {};
  const after = event.data.after.data() || {};
  const changed = COMMUNITY_FIELDS.filter((f) => JSON.stringify(before[f] ?? null) !== JSON.stringify(after[f] ?? null));
  if (!changed.length) return;
  const communityId = event.params.communityId;
  const owner = after.creatorId || after.adminId || "";
  const { all } = await communityMembers(communityId);
  const what = changed.includes("thumbnail") && changed.length === 1 ? "a new photo" : "updated info";
  await notify(all, {
    type: "community_updated",
    senderUid: owner,
    communityId,
    title: `${after.name || "Your community"} has ${what}`,
    body: "Tap to see what changed.",
  }, { exclude: [owner], key: `commupd_${communityId}_${tenMinuteBucket()}` });
});

exports.onCommunityMemberAdded = onDocumentCreated(`${BASE}/communities/{communityId}/members/{uid}`, async (event) => {
  const communityId = event.params.communityId;
  const uid = event.params.uid;
  const member = (event.data && event.data.data()) || {};
  const { admins, community } = await communityMembers(communityId);
  const cName = community.name || "your community";

  // Tell the admins
  await notify(admins, {
    type: "community_new_member",
    senderUid: uid,
    communityId,
    title: "New member 🎉",
    body: `${member.name || (await nameOf(uid))} joined ${cName}.`,
  }, { exclude: [uid, member.approvedBy], key: `newmember_${communityId}_${uid}` });   // not the admin who approved them

  // Tell the person, when an admin approved their request
  if (member.approvedBy || member.approvedAt || member.status === "approved" || member.viaRequest === true) {
    await notify([uid], {
      type: "community_request_accepted",
      senderUid: member.approvedBy || community.creatorId || "",
      communityId,
      title: "You're in! ✅",
      body: `Your request to join ${cName} was accepted.`,
    }, { key: `commaccepted_${communityId}` });
  }
});

// ---------------------------------------------------------------------------
// 6. Admin "Notify everyone" about a game (called from the website or the app)
// ---------------------------------------------------------------------------

exports.notifyEveryone = onCall(async (request) => {
  const caller = request.auth && request.auth.uid;
  if (!caller) throw new HttpsError("unauthenticated", "Please sign in.");

  const eventId = String((request.data && request.data.eventId) || "");
  const message = clip((request.data && request.data.message) || "", 160);
  if (!eventId) throw new HttpsError("invalid-argument", "Missing game.");

  const gameRef = col("eventsList").doc(eventId);
  const game = (await gameRef.get()).data();
  if (!game) throw new HttpsError("not-found", "This game no longer exists.");

  // Only the organizer or an admin of the game's community may do this.
  let allowed = game.organizerId === caller;
  if (!allowed && game.communityId) {
    const { admins } = await communityMembers(game.communityId);
    allowed = admins.includes(caller);
  }
  if (!allowed) throw new HttpsError("permission-denied", "Only the organizer or a community admin can do this.");

  // At most once an hour per game, so nobody gets spammed.
  const last = game.lastBroadcastAt && game.lastBroadcastAt.toMillis ? game.lastBroadcastAt.toMillis() : 0;
  if (Date.now() - last < 60 * 60 * 1000) {
    throw new HttpsError("resource-exhausted", "You already notified everyone about this game in the last hour.");
  }

  // Everyone for now (people already on the game are skipped).
  const everyone = (await col("directory").select().get()).docs.map((d) => d.id);
  const sent = await notify(everyone, {
    type: "broadcast",
    senderUid: caller,
    eventId,
    communityId: game.communityId || "",
    title: `Players needed: ${game.title || "pick-up game"} ⚽`,
    body: message || `${game.date || ""} at ${game.time || ""} · ${game.location || ""}. Tap to join!`.replace(/\s+/g, " "),
  }, { exclude: [caller, ...participants(game)], key: `broadcast_${eventId}_${tenMinuteBucket()}` });

  await gameRef.update({ lastBroadcastAt: admin.firestore.FieldValue.serverTimestamp() });
  return { sent };
});

// ---------------------------------------------------------------------------
// 7. Community feed: new posts (tailored to the kind of post) and comments
// ---------------------------------------------------------------------------

/** The message line, tailored to the kind of post. */
function describePost(p) {
  if (p.poll && p.poll.question) return `📊 Poll: ${clip(p.poll.question, 100)}`;
  if (p.media && p.media.type === "video") return p.text ? `🎥 ${clip(p.text, 100)}` : "🎥 Shared a video";
  if (p.mediaUrl || (p.media && p.media.url)) return p.text ? `📸 ${clip(p.text, 100)}` : "📸 Shared a photo";
  return clip(p.text, 120) || "New post";
}

exports.onFeedPostCreated = onDocumentCreated(`${BASE}/communities/{communityId}/feed/{postId}`, async (event) => {
  const p = (event.data && event.data.data()) || {};
  const { communityId, postId } = event.params;
  const author = p.authorId || "";
  const { all, community } = await communityMembers(communityId);
  const who = p.authorName || (await nameOf(author));
  const cName = String(community.name || "your").replace(/\s+community$/i, "");

  await notify(all, {
    type: "community_post",
    senderUid: author,
    communityId,
    title: `${who} posted on ${cName} Community`,
    body: describePost(p),
  }, { exclude: [author], key: `post_${postId}` });
});

exports.onFeedPostUpdated = onDocumentUpdated(`${BASE}/communities/{communityId}/feed/{postId}`, async (event) => {
  const before = event.data.before.data() || {};
  const after = event.data.after.data() || {};
  const { communityId, postId } = event.params;
  const oldCount = arr(before.comments).length;
  const comments = arr(after.comments);
  if (comments.length <= oldCount) return;            // likes, votes, edits: no push

  const author = after.authorId || "";
  const { community } = await communityMembers(communityId);
  const cName = community.name || "your community";

  for (let i = oldCount; i < comments.length; i++) {
    const c = comments[i] || {};
    const by = c.authorId || c.uid || "";
    const who = c.authorName || c.name || (await nameOf(by));
    // The post's author, plus everyone who commented before (so replies reach the conversation).
    const earlier = comments.slice(0, i).map((x) => x.authorId || x.uid);
    const toAuthor = author && author !== by;

    if (toAuthor) {
      await notify([author], {
        type: "community_post_comment",
        senderUid: by,
        communityId,
        title: `${who} commented on your post 💬`,
        body: `${clip(c.text, 120)} · ${cName}`,
      }, { key: `postc_${postId}_${i}` });
    }
    await notify(uniq(earlier), {
      type: "community_post_comment",
      senderUid: by,
      communityId,
      title: `${who} also commented 💬`,
      body: `${clip(c.text, 120)} · ${cName}`,
    }, { exclude: [by, author], key: `postc_${postId}_${i}` });
  }
});

// ---------------------------------------------------------------------------
// 8. Credit added or removed by an admin
// ---------------------------------------------------------------------------

exports.onCreditLedger = onDocumentCreated(`${BASE}/communities/{communityId}/creditLedger/{entryId}`, async (event) => {
  const l = (event.data && event.data.data()) || {};
  const { communityId, entryId } = event.params;
  if (l.type !== "topup" && l.type !== "adjust") return;   // game fees and refunds are covered by the game pushes
  if (!l.uid || l.by === l.uid) return;

  const cents = Math.round(Number(l.amountCents) || 0);
  if (!cents) return;
  const money = `$${(Math.abs(cents) / 100).toFixed(2)}`;
  const balance = `$${((Number(l.balanceAfterCents) || 0) / 100).toFixed(2)}`;
  const { community } = await communityMembers(communityId);
  const who = l.byName || (await nameOf(l.by));
  const cName = community.name || "your community";

  await notify([l.uid], {
    type: "community_credit",
    senderUid: l.by || "",
    communityId,
    title: cents > 0 ? `${money} credit added 💰` : `${money} credit removed`,
    body: `${who} ${cents > 0 ? "added" : "removed"} ${money} ${cents > 0 ? "to" : "from"} your ${cName} credit. Balance: ${balance}.${l.note ? " Note: " + clip(l.note, 60) : ""}`,
  }, { key: `credit_${entryId}` });
});

// ---------------------------------------------------------------------------
// 9. Someone asked to join a community -> tell the admins
// ---------------------------------------------------------------------------

exports.onCommunityJoinRequest = onDocumentCreated(`${BASE}/communities/{communityId}/requests/{uid}`, async (event) => {
  const r = (event.data && event.data.data()) || {};
  const { communityId, uid } = event.params;
  const { admins, community } = await communityMembers(communityId);
  const who = r.name || (await nameOf(uid));

  await notify(admins, {
    type: "community_join_request",
    senderUid: uid,
    communityId,
    title: "New join request 🙋",
    body: `${who} wants to join ${community.name || "your community"}. Tap to review.`,
  }, { exclude: [uid], key: `joinreq_${communityId}_${uid}_${tenMinuteBucket()}` });
});

// ---------------------------------------------------------------------------
// 10. One phone = one account: when a phone signs in to an account, remove it
//     from any other account it was saved on (so test accounts don't get your pushes)
// ---------------------------------------------------------------------------

exports.onPhoneTokenSaved = onDocumentWritten(`${BASE}/directory/{uid}`, async (event) => {
  if (!event.data.after.exists) return;
  const uid = event.params.uid;
  const before = event.data.before.exists ? event.data.before.data() : {};
  const after = event.data.after.data() || {};
  const had = new Set(uniq([before.fcmToken, ...arr(before.fcmTokens)]));
  const added = uniq([after.fcmToken, ...arr(after.fcmTokens)]).filter((t) => !had.has(t));
  if (!added.length) return;

  for (const token of added) {
    const [inList, asMain] = await Promise.all([
      col("directory").where("fcmTokens", "array-contains", token).get(),
      col("directory").where("fcmToken", "==", token).get(),
    ]);
    const others = new Map();
    [...inList.docs, ...asMain.docs].forEach((d) => { if (d.id !== uid) others.set(d.id, d); });
    for (const [otherUid, d] of others) {
      const patch = { fcmTokens: admin.firestore.FieldValue.arrayRemove(token) };
      if ((d.data() || {}).fcmToken === token) patch.fcmToken = admin.firestore.FieldValue.delete();
      await d.ref.update(patch);
      logger.info("Moved phone token from", otherUid, "to", uid);
    }
  }
});