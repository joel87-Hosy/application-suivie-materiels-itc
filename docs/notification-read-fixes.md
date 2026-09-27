# Pastilles après lecture

Deux cas corrigés dans la version du cache PWA v57 :

- Une vue déjà ouverte, réaffichée par `applyServerData`, ne déclenchait pas
  l'enregistrement de lecture. Elle le fait maintenant après son rendu.
- Les nouveaux enregistrements recevaient une clé uniquement dans la requête de
  sauvegarde. Réutiliser le même objet local ou réessayer après une réponse perdue
  pouvait créer une seconde notification. La clé reste maintenant sur l'objet.

La lecture porte sur les notifications présentes au moment de l'affichage,
pas sur celles arrivées pendant l'attente d'une sauvegarde. En cas d'erreur serveur,
la pastille reste visible ; les notifications ne sont pas faussement acquittées.

Publier le résultat de `npm.cmd run build` et vérifier que la migration
`202609230004_notification_read_receipts.sql` est appliquée. Les doublons déjà
enregistrés ne sont pas supprimés : la lecture de leur onglet les acquitte.
Les changements locaux ne constituent pas un déploiement sur le site en ligne.
