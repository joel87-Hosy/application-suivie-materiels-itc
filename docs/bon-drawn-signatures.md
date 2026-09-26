# Quatre signatures sur les bons

Le PDF comporte, dans cet ordre, les zones **Technicien**, **Coordinateur**, **Validateur**, **Gestionnaire**. Chaque zone affiche le nom enregistré, la date de signature et le dessin lorsqu’il existe. Une zone sans signature indique « Signature non renseignée » ; elle n’est pas tamponnée automatiquement comme validée. Les anciens noms signés restent affichés, sans dessin inventé.

À l’envoi du technicien, à la transmission du coordinateur (y compris les commandes directes), à la décision du validateur, à la confirmation d’un renouvellement et à la remise par le gestionnaire, une fenêtre permet de confirmer le nom et de dessiner au doigt ou à la souris. Le dessin est facultatif. Les boutons **Effacer le dessin** et **Annuler** sont disponibles. La déconnexion ferme la fenêtre sans enregistrer une nouvelle signature.

Les images PNG sont conservées dans `app_records.payload.bonSignatures`, avec le nom, l’identifiant du compte signataire et l’horodatage serveur. La base contrôle le rôle et l’affectation avant de signer. Les signatures du validateur et du gestionnaire sont enregistrées dans la même transaction que leur décision ou la remise physique. La sortie reprend les quatre signatures de la demande. Un double envoi après livraison ne remplace pas la signature du gestionnaire et ne débite pas de nouveau le stock.

Lors d’une correction d’un bon refusé, les signatures précédentes sont archivées dans `correctionHistory.before` et retirées de la version courante. Lors d’un renouvellement, la nouvelle signature du validateur et la précédente sont conservées dans `bonRenewals`. Les contrôles de validité de 24 heures continuent à s’appliquer.

Déploiement : appliquer `supabase/migrations/202609260001_bon_drawn_signatures.sql` après les migrations précédentes, puis publier le front. Cette migration n’a pas été appliquée automatiquement à la base distante.

Tests : `node tools/test_bon_signatures.cjs`, `node tools/test_bon_signatures_browser.cjs`, `node tools/test_bon_scanner_browser.cjs`, `node tools/test_bon_reference_integration.js`, `npm.cmd test`, `npm.cmd run build`. Les tests Chrome/PDF utilisent Chrome et les bibliothèques locales de `.tools/report-libs`.
