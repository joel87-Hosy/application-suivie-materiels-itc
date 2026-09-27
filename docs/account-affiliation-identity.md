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
cette correction.

## Fiche sans profil unique après la première correction

Appliquer ensuite `202609260006_verified_affiliation_identity.sql`. L'ancienne
résolution mélangeait les identifiants Auth et les numéros métier historiques,
et ne cherchait pas le compte par son email Auth. La nouvelle résolution utilise
l'email Auth lorsqu'il correspond à un profil de la même entreprise. Un UID Auth
unique prime aussi sur les numéros métier qui peuvent se répéter. Un désaccord
entre un UID Auth et un email Auth reste bloquant.

La synchronisation des fiches utilise la même résolution, afin de ne pas modifier
un autre technicien partageant un ancien numéro. Le rôle, les identifiants
historiques, les accès aux stocks et l'état actif/suspendu sont conservés. Aucune
nouvelle identité ni aucun profil manquant ne sont créés automatiquement.

Cette correction est uniquement SQL : après application, réessayer le bouton
« Bureaux et services » existant. Aucune nouvelle publication de l'application
ou de la fonction `company-users` n'est nécessaire si la version précédente est
déjà en ligne.

Si le problème persiste, exécuter `scripts/diagnose_arx_affiliation.sql` dans
l'éditeur SQL Supabase. Ce diagnostic est en lecture seule : il distingue compte
Auth absent, profil applicatif manquant, entreprise différente et identifiants
contradictoires. Il ne lit aucun mot de passe ni jeton. L'état du compte distant
doit être vérifié avec ce résultat avant une éventuelle réparation de données.

## Coordinateur incompatible avec le rattachement

Le message « Coordinateur actif de la même entreprise, bureau et service requis »
signifie qu'un des correspondants sélectionnés ne satisfait pas ces conditions,
ou que son ancien identifiant ne correspond pas au profil serveur. Il ne signifie
pas qu'il faut modifier le rôle Technicien du compte ARX.

La migration `202609270001_affiliation_contacts.sql` ajoute la lecture des
coordinateurs et validateurs depuis leurs profils serveur, réservée au responsable
de l'entreprise. Le formulaire utilise leurs identifiants canoniques et filtre :

- Coordinateurs : même entreprise, compte actif, au moins un bureau et un service
  communs avec les choix du formulaire.
- Validateurs : même entreprise, compte actif et au moins un bureau commun ; leur
  service ne limite pas la validation.

Une sélection existante incompatible reste visible et bloque l'enregistrement
jusqu'à sa correction explicite. Elle n'est pas supprimée silencieusement, car une
liste vide rétablit le circuit habituel sans restriction nominative. Les messages
serveur précisent désormais le nom du correspondant et le motif du refus.

Pour activer cette correction, appliquer la migration après les précédentes,
puis publier `npm.cmd run build` (cache PWA v57). Choisir d'abord les bureaux et
services d'ARX, puis ses correspondants. Si aucun coordinateur compatible
n'apparaît, le responsable doit d'abord compléter les bureaux et services du
coordinateur voulu, ou choisir un autre coordinateur compatible. Le bouton
« Actualiser les correspondants » recharge leurs profils serveur.

ARX est un prestataire d'ITC : son compte conserve le rôle `Technicien` et
l'entreprise ITC. Le nom du prestataire ou de l'équipe n'intervient pas dans
les autorisations de rattachement. Les tests couvrent l'affectation de ses bureaux,
services, coordinateurs et validateurs par le responsable ITC.
