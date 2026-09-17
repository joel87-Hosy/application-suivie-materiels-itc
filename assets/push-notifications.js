/* Device-specific Web Push subscription. No token is stored in localStorage. */
(function (global) {
  const config = () => global.ITCPushConfig || {};
  const status = (message, error) => { const el = document.getElementById("push-notification-status"); if (el) { el.textContent = message; el.className = error ? "text-sm text-red-700" : "text-sm text-slate-600"; } };
  const messageFor = error => {
    if (error?.code === "PERMISSION_DENIED" || /permission denied/i.test(String(error?.message || ""))) return "Autorisation Firebase manquante : les règles de notifications doivent être déployées par l’administrateur.";
    return error?.message || "Activation impossible.";
  };
  const keyFor = async value => { if (global.crypto?.subtle) { const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)); return [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, "0")).join(""); } return btoa(value).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 180); };
  async function storeToken(token) {
    const user = firebase.auth().currentUser;
    if (!user) throw new Error("Connectez-vous avant d’activer les notifications.");
    // This script is loaded before the application’s module variables. Read the
    // authenticated profile directly instead of relying on window.currentUser.
    const profile = (await firebase.database().ref("auth_profiles/" + user.uid).once("value")).val();
    const companyId = String(profile?.company_id || "").trim();
    if (!companyId) throw new Error("Votre entreprise n’est pas renseignée. Contactez un superviseur.");
    await firebase.database().ref("push_subscriptions/" + user.uid + "/" + await keyFor(token)).set({token, company_id: companyId, updatedAt: new Date().toISOString(), platform: navigator.userAgent.slice(0, 180)});
  }
  async function activate() {
    const vapidKey = String(config().vapidPublicKey || "").trim();
    if (!vapidKey) throw new Error("La clé Web Push Firebase doit d’abord être configurée par l’administrateur.");
    if (!("Notification" in global) || !("serviceWorker" in navigator) || !firebase.messaging) throw new Error("Les notifications système ne sont pas prises en charge par ce navigateur.");
    if (await Notification.requestPermission() !== "granted") throw new Error("Autorisation refusée. Activez les notifications dans les réglages du navigateur.");
    const token = await firebase.messaging().getToken({vapidKey, serviceWorkerRegistration: await navigator.serviceWorker.ready});
    if (!token) throw new Error("L’appareil n’a pas fourni de jeton de notification.");
    await storeToken(token); status("Notifications activées sur cet appareil, même lorsque l’application est fermée.");
  }
  async function refresh() { if (global.Notification?.permission !== "granted" || !String(config().vapidPublicKey || "").trim() || !firebase.messaging || !firebase.auth().currentUser) return; try { const token = await firebase.messaging().getToken({vapidKey:config().vapidPublicKey,serviceWorkerRegistration:await navigator.serviceWorker.ready}); if (token) await storeToken(token); } catch (error) { console.warn("Push subscription refresh failed", error); } }
  global.enablePushNotifications = async button => { if (button) button.disabled = true; status("Activation des notifications…"); try { await activate(); } catch (error) { status(messageFor(error), true); } finally { if (button) button.disabled = false; } };
  global.refreshPushNotifications = refresh;
})(window);
