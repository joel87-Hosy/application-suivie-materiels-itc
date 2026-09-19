# Notifications lorsque l'application est fermée

La fonction envoie une notification système lorsqu'un bon est transmis au coordinateur, au gestionnaire ou au technicien. Le navigateur et le mode silencieux restent prioritaires : une page web ne peut pas forcer un bip désactivé par le système.

1. Dans Firebase Console, activez **Cloud Messaging API (V1)** pour `itc-erp`.
2. Dans **Paramètres du projet > Cloud Messaging > Certificats push Web**, créez une paire de clés et copiez la clé publique VAPID.
3. Placez-la dans `assets/push-config.js`.
4. Dans `functions/`, exécutez `npm install`, puis depuis la racine : `firebase deploy --only functions,database --project itc-erp`.
5. Déployez le site. Chaque utilisateur ouvre **Mon profil** et active les notifications sur chaque appareil.

Sur iPhone/iPad, l'application doit être ajoutée à l'écran d'accueil et l'utilisateur doit autoriser les notifications. Le son dépend aussi du réglage Notifications de l'appareil.
