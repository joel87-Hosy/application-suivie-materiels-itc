const {onValueCreated} = require("firebase-functions/v2/database");
const {initializeApp} = require("firebase-admin/app");
const {getDatabase} = require("firebase-admin/database");
const {getMessaging} = require("firebase-admin/messaging");
initializeApp();
exports.cableOffcuts = require('./cable-offcuts').cableOffcuts;
const titleFor = message => /BON A VALIDER/i.test(message) ? "Bon à valider" : /DEMANDE A SIGNER/i.test(message) ? "Bon à signer" : /MATERIEL EST DISPONIBLE/i.test(message) ? "Matériel disponible" : "ITC Gestion Matériels";
exports.sendNotificationPush = onValueCreated("/itc_data/notifications/{notificationId}", async event => {
  const notification = event.data.val(); if (!notification || !Number.isFinite(Number(notification.userId))) return;
  const users = (await getDatabase().ref("itc_data/users").once("value")).val() || {};
  const recipient = Object.values(users).find(user => Number(user?.id) === Number(notification.userId)); if (!recipient?.uid) return;
  const devices = (await getDatabase().ref("push_subscriptions/" + recipient.uid).once("value")).val() || {};
  const entries = Object.entries(devices).filter(([, device]) => device?.token && (!notification.company_id || device.company_id === notification.company_id)); if (!entries.length) return;
  const message = String(notification.message || "Nouvelle notification ITC.").slice(0, 500);
  const responses = [];
  for (let start = 0; start < entries.length; start += 500) {
    const batch = entries.slice(start, start + 500);
    const result = await getMessaging().sendEachForMulticast({tokens:batch.map(([,device]) => device.token),data:{title:titleFor(message),body:message,notificationId:event.params.notificationId,url:"/index.html"},webpush:{headers:{Urgency:"high"}}});
    responses.push(...result.responses.map((response, index) => ({response, entry: batch[index]})));
  }
  const invalid = new Set(["messaging/registration-token-not-registered", "messaging/invalid-registration-token"]);
  await Promise.all(responses.map(({response,entry}) => response.success || !invalid.has(response.error?.code) ? null : getDatabase().ref("push_subscriptions/" + recipient.uid + "/" + entry[0]).remove()).filter(Boolean));
});
