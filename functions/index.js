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
        sound: payload.sound || "",
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
    sound: n.sound || "",
  };
  // Money in: custom "cha-ching" sound (the file ships inside the apps; falls back to the normal sound).
  const special = n.sound === "cha_ching";

  const res = await admin.messaging().sendEachForMulticast({
    tokens,
    notification: { title: n.title || "FutNet", body: n.body || "" },
    data,
    android: special ? { notification: { channelId: "futnet_money", sound: "cha_ching" } } : undefined,
    apns: {
      payload: {
        aps: {
          sound: special ? "cha_ching.wav" : "default",
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
// Sign-in hint: after a wrong email + password, tell the login screen if this email signed up with
// Google or Apple (and never set a password), so it can say "Continue with Google" instead of
// "wrong password". It only ever answers "google", "apple" or nothing: it never says whether an
// email + password account exists.
// ---------------------------------------------------------------------------

const hintCalls = new Map();   // per server instance: ip -> recent call times (simple abuse limit)
exports.signInHint = onCall(async (request) => {
  const ip = String((request.rawRequest && (request.rawRequest.headers["x-forwarded-for"] || request.rawRequest.ip)) || "?").split(",")[0].trim();
  const now = Date.now();
  const recent = (hintCalls.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  if (recent.length >= 20) return { provider: "" };
  recent.push(now);
  hintCalls.set(ip, recent);
  if (hintCalls.size > 5000) hintCalls.clear();

  const email = String((request.data && request.data.email) || "").trim().toLowerCase();
  if (!email || email.length > 200 || !email.includes("@")) return { provider: "" };
  try {
    const user = await admin.auth().getUserByEmail(email);
    const ids = (user.providerData || []).map((p) => p.providerId);
    if (ids.includes("password")) return { provider: "" };
    if (ids.includes("google.com")) return { provider: "google" };
    if (ids.includes("apple.com")) return { provider: "apple" };
    return { provider: "" };
  } catch (e) {
    return { provider: "" };   // no account, or anything else: say nothing
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
// 7b. Community group chat: WhatsApp-style push to every member except the sender
//     ("Sunday Futsal" / "Diego: see you at 7")
// ---------------------------------------------------------------------------

async function onCommunityChat(event) {
  const m = (event.data && event.data.data()) || {};
  const { communityId, msgId } = event.params;
  const by = m.senderUid || m.senderId || m.uid || "";
  if (!by) return;
  const { all, community } = await communityMembers(communityId);
  const who = (m.sender || m.senderName || m.name || (await nameOf(by))).split(" ")[0];
  let text = clip(m.text, 120);
  if (m.media && m.media.type) {
    const icon = m.media.type === "video" ? "🎥" : "📷";
    const isLabel = text === "📷 Photo" || text === "🎥 Video" || !text;
    text = isLabel ? `${icon} ${m.media.type === "video" ? "Video" : "Photo"}` : `${icon} ${text}`;
  }
  await notify(all, {
    type: "chat_community",
    senderUid: by,
    communityId,
    chatId: `community_${communityId}`,   // groups the pushes in one stack on the lock screen
    title: community.name || "Community chat",
    body: `${who}: ${text || "New message"}`,
  }, { exclude: [by], key: `cchat_${communityId}_${msgId}` });
}

exports.onCommunityChatMessage = onDocumentCreated(`${BASE}/communities/{communityId}/messages/{msgId}`, onCommunityChat);
// Older app versions saved group messages here.
exports.onCommunityChatMessageOld = onDocumentCreated(`${BASE}/communities/{communityId}/chat/{msgId}`, onCommunityChat);

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
    sound: cents > 0 ? "cha_ching" : "",
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
// ---------------------------------------------------------------------------
// 11. Money + waitlist (same rules as the website: money-rules.js)
//   a) Must-pay games: nobody keeps a spot without paying, whatever app or link they used
//   b) Late cancels with "refund if the spot gets filled": refunded when someone takes the spot
//   c) Game cancelled (deleted): everyone's credit back, unless the organizer turned that off
//   d) Waitlist: when a spot opens, offer it to the next player(s) with a timer (scheduled below)
// ---------------------------------------------------------------------------

const rules = require("./money-rules");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const FV = admin.firestore.FieldValue;
const DEFAULT_TZ = "America/New_York";
const money = (c) => `$${(Math.abs(Number(c) || 0) / 100).toFixed(2)}`;

/** Wall-clock time in a time zone -> ms (games are saved as "2026-10-20" + "7:00 PM", local time). */
function tzOffsetMs(t, tz) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(t));
  const g = (k) => Number((parts.find((p) => p.type === k) || {}).value);
  return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - t;
}
function startOf(game) {
  const tz = game.timeZone || DEFAULT_TZ;
  return rules.startMsOf(game, (y, mo, d, h, mi) => {
    const guess = Date.UTC(y, mo, d, h, mi);
    let t = guess - tzOffsetMs(guess, tz);
    t = guess - tzOffsetMs(t, tz);
    return t;
  });
}

const credRef = (cid, uid) => col("communities").doc(cid).collection("credits").doc(String(uid));
const ledgerCol = (cid) => col("communities").doc(cid).collection("creditLedger");
const isRealPlayer = (uid) => uid && !uid.startsWith("usr_") && !uid.includes("_guest_");

/** Credit move inside a transaction (reads must already be done: pass the balance read before). */
function writeCredit(tx, cid, uid, name, balanceBefore, amountCents, type, note, game, eventId) {
  const after = balanceBefore + amountCents;
  tx.set(credRef(cid, uid), { uid: String(uid), name: name || "Member", balanceCents: after, updatedAt: FV.serverTimestamp() }, { merge: true });
  tx.set(ledgerCol(cid).doc(), {
    uid: String(uid), name: name || "Member", amountCents, type, note,
    eventId, eventTitle: (game && game.title) || "Game", by: "server", byName: "FutNet",
    balanceAfterCents: after, at: FV.serverTimestamp(),
  });
  return after;
}

// ---- a) must-pay enforcement --------------------------------------------------
async function enforcePayment(eventId, before, after) {
  if (!rules.isCreditGame(after)) return false;
  const beforeIn = new Set(arr(before.attendees).map(uidOf));
  const suspects = arr(after.attendees).filter((a) => {
    const u = uidOf(a);
    return isRealPlayer(u) && !beforeIn.has(u) && u !== after.organizerId && a.role !== "Organizer" &&
      !(Number(a.creditPaidCents) > 0) && a.paid !== "Paid" && a.paid !== "Free" && a.addedByAdmin !== true;
  }).map(uidOf);
  if (!suspects.length) return false;

  const ref = col("eventsList").doc(eventId);
  const removed = [], charged = [];
  await db.runTransaction(async (tx) => {
    removed.length = 0; charged.length = 0;
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const g = snap.data();
    const cid = g.communityId;
    const todo = arr(g.attendees).filter((a) => suspects.includes(uidOf(a)) && !(Number(a.creditPaidCents) > 0) && a.paid !== "Paid" && a.addedByAdmin !== true);
    if (!todo.length) return;
    const balances = {};
    for (const a of todo) {
      const s = await tx.get(credRef(cid, uidOf(a)));
      balances[uidOf(a)] = s.exists ? (Number(s.data().balanceCents) || 0) : 0;
    }
    const attendees = [];
    for (const a of arr(g.attendees)) {
      const u = uidOf(a);
      if (!todo.find((t) => uidOf(t) === u)) { attendees.push(a); continue; }
      const cost = rules.costFor(g, arr(a.guests).length);
      if (balances[u] >= cost) {
        writeCredit(tx, cid, u, a.name, balances[u], -cost, "game", "Game fee", g, eventId);
        attendees.push({ ...a, paid: "Credit", creditPaidCents: cost, creditCommunityId: cid, guests: arr(a.guests).map((x) => ({ ...x, paid: "Credit" })) });
        charged.push({ uid: u, cost });
      } else {
        removed.push({ uid: u, cost, have: balances[u] });
      }
    }
    tx.update(ref, { attendees });
  });
  for (const r of removed) {
    await notify([r.uid], {
      type: "game_payment_needed",
      eventId,
      communityId: after.communityId || "",
      title: "Add credit to join 💳",
      body: `${after.title || "This game"} costs ${money(r.cost)} and you have ${money(r.have)} credit. Send the money to your admin, then join again.`,
    }, { key: `paycheck_${eventId}_${r.uid}_${tenMinuteBucket()}` });
  }
  if (removed.length || charged.length) logger.info(`Payment check ${eventId}: charged ${charged.length}, removed ${removed.length}`);
  return removed.length > 0 || charged.length > 0;
}

// ---- b) refund late cancels once someone takes the spot ------------------------
async function refundFilledSpots(eventId, before, after) {
  const pending = arr(after.pendingRefunds);
  if (!pending.length) return false;
  const beforeIn = new Set(arr(before.attendees).map(uidOf));
  const newcomers = arr(after.attendees).filter((a) => !beforeIn.has(uidOf(a)) && uidOf(a) !== after.organizerId).length;
  if (!newcomers) return false;

  const ref = col("eventsList").doc(eventId);
  const paidBack = [];
  await db.runTransaction(async (tx) => {
    paidBack.length = 0;
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const g = snap.data();
    const inNow = new Set(arr(g.attendees).map(uidOf));
    // Oldest first; never someone who came back to the game themselves
    const list = arr(g.pendingRefunds).filter((p) => p && p.cents > 0 && !inNow.has(String(p.uid)));
    const take = list.slice(0, newcomers);
    if (!take.length) return;
    const bal = {};
    for (const p of take) {
      const k = `${p.cid}|${p.uid}`;
      if (bal[k] === undefined) {
        const s = await tx.get(credRef(p.cid || g.communityId, p.uid));
        bal[k] = s.exists ? (Number(s.data().balanceCents) || 0) : 0;
      }
    }
    for (const p of take) {
      const k = `${p.cid}|${p.uid}`;
      bal[k] = writeCredit(tx, p.cid || g.communityId, p.uid, p.name, bal[k], p.cents, "refund", "Your spot was filled", g, eventId);
      paidBack.push(p);
    }
    const left = arr(g.pendingRefunds).filter((p) => !take.includes(p) && !inNow.has(String(p.uid)));
    tx.update(ref, { pendingRefunds: left });
  });
  for (const p of paidBack) {
    await notify([String(p.uid)], {
      type: "community_credit",
      eventId,
      communityId: p.cid || after.communityId || "",
      sound: "cha_ching",
      title: `${money(p.cents)} refunded 💰`,
      body: `Someone took your spot in ${after.title || "the game"}, so your ${money(p.cents)} is back in your credit.`,
    }, { key: `spotrefund_${eventId}_${p.uid}_${p.at || ""}` });
  }
  return paidBack.length > 0;
}

// ---- c) game cancelled: give back what each player still has paid for this game ---
async function refundCancelledGame(eventId, game) {
  if (!game.communityId || !rules.refundsOnCancel(game)) return;
  const cids = uniq([game.communityId, ...arr(game.attendees).map((a) => a.creditCommunityId), ...arr(game.pendingRefunds).map((p) => p.cid)]);
  for (const cid of cids) {
    // Net paid per player for this game = -(fees + refunds) in the ledger. Refunds the apps already made are counted.
    const ledger = await ledgerCol(cid).where("eventId", "==", eventId).get();
    const net = {};
    ledger.docs.forEach((d) => {
      const l = d.data() || {};
      if (l.type !== "game" && l.type !== "refund") return;
      net[l.uid] = (net[l.uid] || 0) - (Number(l.amountCents) || 0);
    });
    for (const [uid, owed] of Object.entries(net)) {
      if (owed <= 0) continue;
      const name = (arr(game.attendees).find((a) => uidOf(a) === uid) || arr(game.pendingRefunds).find((p) => String(p.uid) === uid) || {}).name;
      await db.runTransaction(async (tx) => {
        const s = await tx.get(credRef(cid, uid));
        writeCredit(tx, cid, uid, name, s.exists ? (Number(s.data().balanceCents) || 0) : 0, owed, "refund", "Game was cancelled", game, eventId);
      });
      await notify([uid], {
        type: "community_credit",
        eventId,
        communityId: cid,
        sound: "cha_ching",
        title: `${money(owed)} refunded 💰`,
        body: `${game.title || "Your game"} was cancelled, so your ${money(owed)} is back in your credit.`,
      }, { key: `cancelrefund_${eventId}_${uid}` });
    }
  }
}

// ---- d0) "Put me in automatically": waiting players who chose it get the open spot right away
//      (fee taken from their credit on must-pay games). Same order as the offers: only players the
//      spot would be offered to now. Not enough credit -> they are asked like everybody else.
async function autoPlace(eventId, after) {
  const now = Date.now();
  const start = startOf(after);
  if (after.isSessionEnded === true || (start && now > start + 3 * 3600000)) return false;
  if (!rules.freeSpotsOf(after) || !rules.waitingUids(after).length) return false;
  const ref = col("eventsList").doc(eventId);
  const placed = [];
  await db.runTransaction(async (tx) => {
    placed.length = 0;
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const g = snap.data();
    const probe = { ...g, spotOffer: g.spotOffer || { round: 1 } };
    const candidates = rules.offerEligible(probe, now, startOf(g))
      .map((u) => arr(g.waitingList).find((w) => uidOf(w) === u))
      .filter((w) => w && w.autoJoin === true);
    if (!candidates.length) return;
    const pay = rules.isCreditGame(g);
    const cid = g.communityId;
    const balances = {};
    if (pay) {
      for (const w of candidates) {
        const s = await tx.get(credRef(cid, uidOf(w)));
        balances[uidOf(w)] = s.exists ? (Number(s.data().balanceCents) || 0) : 0;
      }
    }
    let attendees = arr(g.attendees).slice();
    let waitingList = arr(g.waitingList).slice();
    for (const w of candidates) {
      const u = uidOf(w);
      const heads = 1 + arr(w.guests).length;
      const free = rules.capacityOf(g) - rules.headsOf(attendees);
      if (free < heads) continue;                       // not enough room for them + their guests: ask instead
      const entry = { ...w, status: "confirmed", autoJoined: true, autoJoinedAt: now };
      delete entry.autoJoin;
      if (pay) {
        const cost = rules.costFor(g, arr(w.guests).length);
        if (balances[u] < cost) continue;                // not enough credit: they get asked
        writeCredit(tx, cid, u, w.name, balances[u], -cost, "game", "Game fee (auto-joined from the waitlist)", g, eventId);
        Object.assign(entry, { paid: "Credit", creditPaidCents: cost, creditCommunityId: cid, guests: arr(w.guests).map((x) => ({ ...x, paid: "Credit" })) });
        placed.push({ uid: u, cost });
      } else placed.push({ uid: u, cost: 0 });
      attendees.push(entry);
      waitingList = waitingList.filter((x) => uidOf(x) !== u);
    }
    if (!placed.length) return;
    tx.update(ref, { attendees, waitingList, playersGoing: rules.headsOf(attendees) });
  });
  for (const p of placed) {
    await notify([p.uid], {
      type: "game_auto_joined",
      eventId,
      communityId: after.communityId || "",
      title: "You're in! ⚽",
      body: `A spot opened in ${after.title || "the game"} and we added you automatically${p.cost ? `. ${money(p.cost)} was taken from your credit` : ""}.`,
    }, { key: `autojoin_${eventId}_${p.uid}_${now}` });
  }
  if (placed.length) logger.info(`Auto-joined ${placed.length} player(s) from the waitlist of ${eventId}`);
  return placed.length > 0;
}

// ---- d) waitlist spot offers ----------------------------------------------------
async function updateSpotOffer(eventId, before, after) {
  const now = Date.now();
  const start = startOf(after);
  const ended = after.isSessionEnded === true || (start && now > start + 3 * 3600000);
  const free = rules.freeSpotsOf(after);
  const waiting = rules.waitingUids(after);
  const want = !ended && free > 0 && waiting.length > 0;
  const ref = col("eventsList").doc(eventId);

  if (!want) {
    if (!after.spotOffer) return;
    // Spot taken (or nobody waiting): close the offer, and tell the others who were offered it.
    const offered = rules.offerEligible({ ...before, spotOffer: before.spotOffer || after.spotOffer }, now, start);
    await ref.update({ spotOffer: null });
    const inNow = new Set(arr(after.attendees).map(uidOf));
    const stillWaiting = offered.filter((u) => !inNow.has(u) && waiting.includes(u));
    if (free === 0 && stillWaiting.length) {
      await notify(stillWaiting, {
        type: "game_spot_taken",
        eventId,
        title: "Someone grabbed the spot",
        body: `The open spot in ${after.title || "the game"} was taken. You're still on the waitlist.`,
      }, { key: `spottaken_${eventId}_${(after.spotOffer && after.spotOffer.startedAt) || ""}` });
    }
    return;
  }

  let offer = after.spotOffer;
  const patch = {};
  if (!offer) {
    offer = { round: 1, startedAt: now, expiresAt: rules.offerExpiry(after, now, start), lastCall: false, notified: [] };
    if (offer.expiresAt <= now) { offer.lastCall = true; offer.expiresAt = null; }
    patch.spotOffer = offer;
  }
  const g = { ...after, spotOffer: offer };
  const eligible = rules.offerEligible(g, now, start);
  const fresh = eligible.filter((u) => !arr(offer.notified).includes(u));
  const next = { ...offer, notified: uniq([...arr(offer.notified), ...fresh]) };
  if (!next.lastCall) {
    if (eligible.length >= waiting.length) {
      // Everyone waiting is already invited: nothing to widen. Wake up again only for last call.
      const wake = start ? Math.max(now, start - rules.LAST_CALL_MS) : null;
      if (next.expiresAt !== wake && (wake === null || !next.expiresAt || next.expiresAt > wake)) next.expiresAt = wake;
    } else {
      // More people joined the waitlist after the timer was parked: start ticking again.
      const due = rules.offerExpiry(after, now, start);
      if (!next.expiresAt || next.expiresAt > due) next.expiresAt = due;
    }
  }
  if (!fresh.length && !patch.spotOffer && JSON.stringify(next) === JSON.stringify(offer)) return;
  patch.spotOffer = next;
  await ref.update(patch);

  if (fresh.length) {
    const mins = rules.claimMinutesOf(after);
    const pay = rules.isCreditGame(after) ? ` and pay ${money(rules.feeCentsOf(after))} from your credit` : "";
    const lastCall = patch.spotOffer.lastCall || rules.isLastCall(g, now, start);
    const autoNoFunds = new Set(arr(after.waitingList).filter((w) => w.autoJoin === true).map(uidOf));
    const why = (u) => (autoNoFunds.has(u) && rules.isCreditGame(after) ? "We couldn't add you automatically (not enough credit). " : "");
    const groups = {};
    fresh.forEach((u) => { (groups[why(u)] = groups[why(u)] || []).push(u); });
    for (const [prefix, who] of Object.entries(groups)) await notify(who, {
      type: "game_spot_offer",
      eventId,
      communityId: after.communityId || "",
      title: lastCall ? "Last call: a spot is open! ⚽" : "Someone cancelled! You're up next ⚽",
      body: lastCall
        ? `A spot opened in ${after.title || "the game"}. First to confirm gets it${pay ? pay.replace(" and pay", ", you'll pay") : ""}.`
        : `${prefix}A spot opened in ${after.title || "the game"}. Confirm within ${mins === 60 ? "1 hour" : mins + " minutes"}${pay} to grab it.`,
    }, { key: `spotoffer_${eventId}_${patch.spotOffer.startedAt}_${who.join("_")}`.slice(0, 900) });
  }
}

exports.onGameMoney = onDocumentWritten(`${BASE}/eventsList/{eventId}`, async (event) => {
  const eventId = event.params.eventId;
  const before = event.data.before.exists ? event.data.before.data() : null;
  const after = event.data.after.exists ? event.data.after.data() : null;

  if (before && !after) { await refundCancelledGame(eventId, before); return; }
  if (!after) return;
  const prev = before || {};
  try {
    // A fix writes the game again, and that write runs this function again for the next step.
    if (await enforcePayment(eventId, prev, after)) return;
    await refundFilledSpots(eventId, prev, after);
    if (await autoPlace(eventId, after)) return;      // the roster changed: the next run handles the offer
    await updateSpotOffer(eventId, prev, after);
  } catch (e) {
    logger.error("onGameMoney failed", eventId, e.message);
  }
});

// Every minute: offers whose timer ran out move on to the next player (or to "last call").
exports.advanceSpotOffers = onSchedule({ schedule: "every 1 minutes", timeZone: DEFAULT_TZ }, async () => {
  const now = Date.now();
  const due = await col("eventsList").where("spotOffer.expiresAt", "<=", now).limit(200).get();
  for (const d of due.docs) {
    try {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(d.ref);
        const g = snap.data();
        const o = g && g.spotOffer;
        if (!o || !o.expiresAt || o.expiresAt > now) return;
        const start = startOf(g);
        if (start && now >= start - rules.LAST_CALL_MS) {
          tx.update(d.ref, { spotOffer: { ...o, lastCall: true, expiresAt: null } });
          return;
        }
        const waiting = rules.waitingUids(g).length;
        const round = (Number(o.round) || 1) + 1;
        const covers = rules.freeSpotsOf(g) + round - 1 >= waiting;
        const parked = start ? Math.max(now + 60000, start - rules.LAST_CALL_MS) : null;
        tx.update(d.ref, { spotOffer: { ...o, round, expiresAt: covers ? parked : rules.offerExpiry(g, now, start) } });
      });
    } catch (e) {
      logger.error("advance offer failed", d.id, e.message);
    }
  }
});

// ---------------------------------------------------------------------------
// Names & photos stay in sync everywhere.
// Each player's public card is directory/{uid}. When their name or photo there changes, every
// saved copy is updated: game rosters (going, waitlist, join requests, teams), community member
// records, credit lists, friends lists and chat threads. When someone edits their private profile
// (users/{uid}/profile/data), their public card is updated first, which then updates the copies.
// ---------------------------------------------------------------------------

const crypto = require("crypto");
// Owner accounts (stored as fingerprints so the emails are not in the code).
const OWNER_EMAIL_SHA256 = [
  "0cc4e2724ff40ad5f2b24d4a43d906996652b2d33d242c17c1efb4b7ff90d67b",
  "dc33de30406203e7cdf8490b5ef4b5c7f993bdb2989bc3025bc5e4dd6b129378",
];
const isOwner = (auth) => !!(auth && auth.token && auth.token.email &&
  OWNER_EMAIL_SHA256.includes(crypto.createHash("sha256").update(String(auth.token.email).trim().toLowerCase()).digest("hex")));

const cleanName = (s) => String(s || "").replace(/\s+/g, " ").trim();
/** Name on a directory card: name, else first + last, else nickname. */
const cardName = (d) => cleanName((d && d.name) || `${(d && d.firstName) || ""} ${(d && d.lastName) || ""}`) || cleanName(d && d.nickname);
/** Name from a private profile: first + last (that is what the person typed). */
const profileName = (p) => cleanName(`${(p && p.firstName) || ""} ${(p && p.lastName) || ""}`) || cleanName(p && p.name);
/** Only short web links are copied into rosters (big uploaded photos are looked up from the card). */
const shareableAvatar = (a) => (typeof a === "string" && a.startsWith("http") && a.length <= 500 ? a : "");
const realName = (n) => !!n && !/^(player|someone|member)$/i.test(n);

/** Puts the right name (and photo) on everyone's entries inside a list. ids: Map uid -> {name, avatar}. */
function fixEntries(list, ids) {
  let changed = false;
  for (const e of arr(list)) {
    if (!e || typeof e !== "object") continue;
    const who = ids.get(uidOf(e));
    if (!who) continue;
    if (e.name !== who.name) { e.name = who.name; changed = true; }
    if (who.avatar && "avatar" in e && e.avatar !== who.avatar) { e.avatar = who.avatar; changed = true; }
  }
  return changed;
}
const copyList = (v) => arr(v).map((x) => (x && typeof x === "object" ? { ...x } : x));

/**
 * Updates every saved copy of these people's names/photos in ONE pass over the data.
 * ids: Map uid -> {name, avatar}. Returns how many documents changed.
 */
async function propagateIdentities(ids) {
  for (const [uid, who] of [...ids]) if (!uid || !realName(who.name)) ids.delete(uid);
  if (!ids.size) return 0;
  let changes = 0;

  // 1. Game rosters, waitlists, not-going lists, join requests, teams and the organizer name
  const games = await col("eventsList").get();
  for (const g of games.docs) {
    const d = g.data() || {};
    const patch = {};
    for (const key of ["attendees", "waitingList", "declinedList", "joinRequests"]) {
      const list = copyList(d[key]);
      if (fixEntries(list, ids)) patch[key] = list;
    }
    if (d.teamAssignments && typeof d.teamAssignments === "object") {
      const ta = {};
      let tChanged = false;
      for (const [k, v] of Object.entries(d.teamAssignments)) {
        if (!Array.isArray(v)) { ta[k] = v; continue; }
        const list = copyList(v);
        if (fixEntries(list, ids)) tChanged = true;
        ta[k] = list;
      }
      if (tChanged) patch.teamAssignments = ta;
    }
    const org = ids.get(d.organizerId || "");
    if (org && d.organizer !== org.name) { patch.organizer = org.name; patch.hostName = org.name; }
    if (Object.keys(patch).length) { await g.ref.update(patch); changes++; }
  }

  // 2. Community member records and credit lists
  const communities = await col("communities").get();
  for (const c of communities.docs) {
    for (const sub of ["members", "credits"]) {
      const snaps = ids.size <= 5
        ? (await Promise.all([...ids.keys()].map((u) => c.ref.collection(sub).doc(u).get()))).filter((x) => x.exists)
        : (await c.ref.collection(sub).get()).docs;
      for (const s of snaps) {
        const who = ids.get(s.id);
        if (!who) continue;
        const m = s.data() || {};
        const patch = {};
        if (m.name !== who.name) patch.name = who.name;
        if (sub === "members" && who.avatar && m.avatar !== who.avatar) patch.avatar = who.avatar;
        if (Object.keys(patch).length) { await s.ref.update(patch); changes++; }
      }
    }
  }

  // 3. Friends lists that saved {uid, name, avatar}
  const rels = await db.collectionGroup("relationships").get();
  for (const r of rels.docs) {
    if (!r.ref.path.startsWith(`${BASE}/users/`)) continue;
    const d = r.data() || {};
    const patch = {};
    for (const key of ["friends", "sentRequests", "receivedRequests"]) {
      const list = copyList(d[key]);
      if (fixEntries(list, ids)) patch[key] = list;
    }
    if (Object.keys(patch).length) { await r.ref.update(patch); changes++; }
  }

  // 4. Chat threads (a thread's "id" is the other person's uid)
  const dir = await col("directory").get();
  for (const p of dir.docs) {
    const chats = arr((p.data() || {}).chats);
    let changed = false;
    const next = chats.map((t) => {
      const who = t && t.id !== p.id ? ids.get(t.id) : null;
      if (!who || (t.name === who.name && (!who.avatar || t.avatar === who.avatar))) return t;
      changed = true;
      return { ...t, name: who.name, ...(who.avatar ? { avatar: who.avatar } : {}) };
    });
    if (changed) { await p.ref.update({ chats: next }); changes++; }
  }
  return changes;
}
const propagateIdentity = (uid, name, avatar) => propagateIdentities(new Map([[uid, { name, avatar }]]));

// Profile edited → public card gets the same name/photo (the card change then updates every copy).
exports.onProfileIdentity = onDocumentWritten(`${BASE}/users/{uid}/profile/{docId}`, async (event) => {
  if (event.params.docId !== "data" || !event.data.after.exists) return;
  const before = event.data.before.exists ? event.data.before.data() : {};
  const after = event.data.after.data() || {};
  const name = profileName(after);
  if (!realName(name)) return;
  const nameChanged = profileName(before) !== name;
  const avatarChanged = (before.avatar || "") !== (after.avatar || "");
  if (!nameChanged && !avatarChanged) return;

  const ref = col("directory").doc(event.params.uid);
  const card = (await ref.get()).data() || {};
  const patch = {};
  if (nameChanged && cardName(card) !== name) {
    patch.name = name;
    patch.firstName = cleanName(after.firstName);
    patch.lastName = cleanName(after.lastName);
  }
  if (avatarChanged && after.avatar && card.avatar !== after.avatar) patch.avatar = after.avatar;
  if ("nickname" in after && (card.nickname || "") !== (after.nickname || "")) patch.nickname = after.nickname || "";
  if (Object.keys(patch).length) await ref.set(patch, { merge: true });
});

// Public card changed name or photo → update every saved copy.
exports.onIdentityChanged = onDocumentWritten(`${BASE}/directory/{uid}`, async (event) => {
  if (!event.data.after.exists) return;
  const before = event.data.before.exists ? event.data.before.data() : {};
  const after = event.data.after.data() || {};
  const name = cardName(after);
  const avatar = shareableAvatar(after.avatar);
  if (cardName(before) === name && shareableAvatar(before.avatar) === avatar) return;   // chats, tokens... not a name change
  if (!realName(name)) return;
  const n = await propagateIdentity(event.params.uid, name, avatar);
  if (n) logger.info(`Name/photo synced for ${event.params.uid}: ${n} places updated`);
});

// Owner only: check everyone once. Cards that disagree with the person's own profile are fixed (which
// updates every copy), and a report lists names used by more than one account and cards without an account.
exports.syncAllNames = onCall({ timeoutSeconds: 540, memory: "512MiB" }, async (request) => {
  if (!isOwner(request.auth)) throw new HttpsError("permission-denied", "Only the FutNet owner can run this.");
  const fix = !(request.data && request.data.dryRun);
  const dir = await col("directory").get();
  const fixed = [];
  const everyone = new Map();
  const byName = new Map();
  const ids = [];
  for (const c of dir.docs) {
    ids.push(c.id);
    const card = c.data() || {};
    const prof = (await col("users").doc(c.id).collection("profile").doc("data").get()).data() || {};
    const want = profileName(prof);
    let name = cardName(card);
    if (realName(want) && want !== name) {
      fixed.push({ uid: c.id, from: name || "(empty)", to: want });
      if (fix) await c.ref.set({ name: want, firstName: cleanName(prof.firstName), lastName: cleanName(prof.lastName) }, { merge: true });
      name = want;
    }
    if (realName(name)) everyone.set(c.id, { name, avatar: shareableAvatar(card.avatar) });
    const key = name.toLowerCase();
    if (key) byName.set(key, [...(byName.get(key) || []), { uid: c.id, name }]);
  }

  // Every saved copy (rosters, members, friends, chats) gets the right name, in one pass.
  const updated = fix ? await propagateIdentities(everyone) : 0;

  // Cards with no login account behind them (left over from deleted or test accounts).
  const orphans = [];
  for (let i = 0; i < ids.length; i += 100) {
    const res = await admin.auth().getUsers(ids.slice(i, i + 100).map((uid) => ({ uid })));
    for (const nf of res.notFound) {
      const card = dir.docs.find((d) => d.id === nf.uid);
      orphans.push({ uid: nf.uid, name: cardName(card ? card.data() : {}) || "(no name)" });
    }
  }
  const duplicates = [...byName.values()].filter((l) => l.length > 1);
  logger.info(`syncAllNames: ${dir.size} cards, ${fixed.length} fixed, ${duplicates.length} shared names, ${orphans.length} without account`);
  return { cards: dir.size, fixed, updated, duplicates, orphans, dryRun: !fix };
});

// Owner only: remove public cards that have no login account behind them (they show up in searches).
exports.removeOrphanCards = onCall(async (request) => {
  if (!isOwner(request.auth)) throw new HttpsError("permission-denied", "Only the FutNet owner can run this.");
  const uids = arr(request.data && request.data.uids).map(String).slice(0, 200);
  let removed = 0;
  for (let i = 0; i < uids.length; i += 100) {
    const res = await admin.auth().getUsers(uids.slice(i, i + 100).map((uid) => ({ uid })));
    for (const nf of res.notFound) { await col("directory").doc(nf.uid).delete(); removed++; }
  }
  return { removed };
});
