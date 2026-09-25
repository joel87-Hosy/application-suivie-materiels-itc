# Contrôle des bons au magasin

Appliquer `supabase/migrations/202609250002_bon_validity_scanner.sql` après les migrations précédentes, avant de publier l’application. Le front seul ne peut pas activer les contrôles serveur. Sans la RPC de contrôle, le scanner refuse d’autoriser une remise.

Chaque nouvelle demande reçoit du serveur `bonCreatedAt` et `bonValidUntil` (24 heures exactement). Les dates envoyées par le navigateur ne peuvent pas prolonger cette période. Les anciens bons reprennent leur date enregistrée ; une date absente ou inexploitable impose une confirmation. Les demandes déjà livrées restent livrées.

Les PDF de demandes et de sorties contiennent un QR code versionné avec l’entreprise et l’identifiant stable de la demande. Le statut imprimé ne fait pas autorité : le scanner relit la base et affiche le destinataire, les articles, la création, l’expiration, le gestionnaire, le validateur et l’historique des prolongations. Pour un bon utilisé, il montre la date de remise et le gestionnaire. Les anciens QR contenant un identifiant brut restent acceptés ; les anciens PDF sans QR doivent être téléchargés à nouveau. Une saisie manuelle de l’identifiant reste disponible.

Un bon valide et attribué au magasinier peut être remis après vérification et signature. Le scanner refait une lecture juste avant la confirmation et la transaction serveur recontrôle l’expiration, l’affectation et l’état livré. Les appels répétés n’entraînent pas un second débit. Le circuit Bureau 02 avec sélection des sous-stocks passe par les mêmes protections. Une erreur de réseau ne donne jamais d’autorisation depuis les données locales.

Le gestionnaire affecté peut demander le renouvellement d’un bon expiré déjà validé. Le validateur qui a rendu la décision reçoit une notification et retrouve le bon dans **Validation des bons → Bons expirés à confirmer**. Lui seul, avec les droits sur tous les stocks concernés, peut confirmer 24 heures supplémentaires ou refuser, avec une observation obligatoire. Une confirmation conserve la création et les articles ; son auteur, sa date, son motif et les échéances sont conservés dans `bonRenewals` et dans l’audit. La première validation d’un bon déjà expiré vaut confirmation pour 24 heures. Si le validateur rattaché est désactivé ou n’a plus les droits, l’interface demande de contacter le superviseur.

Les scans du jour restent enregistrés en base, avec l’heure serveur UTC et le dernier résultat du contrôle par bon. Un nouveau contrôle actualise cette ligne, sans doublon. La caméra s’arrête après détection, au changement d’écran ou à la déconnexion.

Tests : `node tools/test_bon_validity.cjs`, `node tools/test_bon_pdf_dates.cjs`, `node tools/test_bon_scanner_browser.cjs` (Chrome et bibliothèques locales dans `.tools/report-libs`), `npm.cmd test`, `npm.cmd run build`.
