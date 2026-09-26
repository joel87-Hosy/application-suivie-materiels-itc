# Rattachement des comptes migrés

Un compte technicien est déjà autorisé à recevoir des bureaux, services et
correspondants. Le message « Affectation réservée au responsable de cette
entreprise » pouvait néanmoins apparaître si sa fiche utilisait son UUID
Supabase alors que son profil conservait aussi un ancien identifiant Firebase.
L'ancien contrôle confondait un compte introuvable avec un responsable non autorisé.

La migration `202609260005_account_affiliation_identity.sql` accepte les deux
identifiants. Le formulaire utilise désormais la clé de la fiche affichée ; le
serveur retrouve un profil unique de la même entreprise, en utilisant aussi
l'identifiant métier historique lorsque nécessaire. Les liaisons ambiguës
restent refusées. La mise à jour synchronise le profil, la fiche et le journal.

Une régression reproduit ce cas avec un technicien `arx-group@itc.ci` : refus avant
correction, puis enregistrement des rattachements par son responsable après
correction. Cette fixture ne constitue pas une lecture du compte distant.
Le rôle Technicien et les accès aux stocks sont conservés. Seuls un responsable
de l'entreprise ou un super-administrateur peuvent modifier les rattachements.

Appliquer la migration après `202609260004_multiple_affiliations_choices.sql`,
puis publier le résultat de `npm.cmd run build` et actualiser l'application.
Aucune modification de la fonction Edge `company-users` n'est nécessaire pour
cette correction. Si le refus persiste, vérifier le rôle actif et l'entreprise
du responsable connecté ainsi que la liaison de la fiche au profil authentifié.
