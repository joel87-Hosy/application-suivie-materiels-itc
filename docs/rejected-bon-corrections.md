# Retour des bons refusés

Appliquer `supabase/migrations/202609230005_rejected_bon_corrections.sql`, puis publier le site (`npm.cmd run build`). Ce changement ne nécessite pas de modification d'une Edge Function.

Le validateur choisit le gestionnaire dédié aussi bien pour accepter que pour refuser. Le refus exige un motif et notifie le gestionnaire dans Commandes. Celui-ci dispose de « Corriger et renvoyer » pour modifier les matériels, quantités, destinataire, motif et service, puis expliquer la correction. Seul le gestionnaire affecté, actif et de la même entreprise peut soumettre la correction.

Le bon revient au statut « EN ATTENTE VALIDATEUR ». Le stock reste inchangé jusqu'à une nouvelle validation suivie de la sortie physique. Chaque correction conserve le refus, la version précédente avec ses signatures, les articles corrigés, l'auteur et la date dans le bon et l'audit. Les signatures précédentes ne sont pas réutilisées pour signer les nouvelles quantités.

Appliquer ensuite `202609230006_legacy_rejected_bons.sql` pour rattacher les anciens refus sans affectation lorsqu'un unique gestionnaire actif couvre leurs stocks. Cette reprise est auditée, notifiée et réexécutable sans doublon. Les affectations ambiguës restent à résoudre par l'administrateur.

L'onglet Commandes se recharge à l'ouverture et propose un bouton Actualiser. Il distingue les rejets à corriger, l'historique des rejets corrigés (y compris les bons à nouveau en validation ou déjà livrés), et les commandes validées à préparer. Aucun rechargement périodique n'est ajouté.
