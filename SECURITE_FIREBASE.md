# Securite Firebase Realtime Database

Firebase a signale que les anciennes regles autorisaient trop largement les utilisateurs connectes.

## Ce qui a ete ajoute

- `database.rules.json` : regles Realtime Database plus strictes.
- `firebase.json` : indique a Firebase quel fichier de regles deployer.
- `auth_profiles/$uid` : table technique utilisee par les regles pour verifier le role, le statut actif et l'entreprise.
- `scripts/sync_security_profiles.js` : synchronise les anciens comptes vers `auth_profiles`.

## Commandes deja executees

```bash
npm.cmd run sync-security-profiles -- --serviceAccount tools/serviceAccountKey.json
```

Resultat obtenu :

```text
Security profiles synced: 15
Profiles skipped: 0
```

## Commande de deploiement des regles

Installer ou executer Firebase Tools, puis lancer :

```bash
npx.cmd firebase-tools deploy --only database
```

Si Firebase demande une connexion :

```bash
npx.cmd firebase-tools login
npx.cmd firebase-tools deploy --only database
```

## Important

Ces regles empechent un simple utilisateur Firebase connecte mais inconnu de lire/ecrire la base.
Elles exigent que l'utilisateur existe dans `auth_profiles` et soit actif.

La prochaine evolution recommandee est de separer physiquement les donnees par entreprise, par exemple :

```text
companies/{companyId}/stock
companies/{companyId}/demandes
companies/{companyId}/sorties
companies/{companyId}/retours
```

Cela permettra d'empecher techniquement une entreprise de lire les donnees d'une autre entreprise au niveau des regles Firebase, pas seulement au niveau de l'interface.
