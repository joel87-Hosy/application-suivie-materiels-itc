# Notifications par onglet

Les pastilles comptent uniquement les notifications non lues du compte et de l'entreprise connectés. La consultation d'un onglet marque seulement ses notifications comme lues. Les notifications arrivées après l'ouverture restent non lues. Une pastille à zéro est masquée ; une nouvelle notification la fait réapparaître lors de la prochaine synchronisation des données.

| Compte | Onglets destinataires |
| --- | --- |
| Gestionnaire | Commandes, Gestion des retours, Transferts de matériel, Entrée Stock |
| Coordinateur / Coordinatrice / Superviseur Terrain | Flux Tech, Bons signés |
| Technicien | Mes Bons |
| Validateur / Validatrice | Validation des bons |
| Superviseur / Super administrateur | Journal d'audit |

`assets/notification-tabs.js` centralise le classement et les compteurs. Le champ optionnel `section` désigne explicitement un onglet. Pour les notifications existantes sans ce champ, le rôle du destinataire et le message permettent le classement. Les copies destinées au superviseur restent dans son journal d'audit.

Les onglets de saisie et les rapports ne marquent plus toutes les notifications du compte comme lues. Les vues asynchrones de validation et de transfert ne marquent leurs notifications qu'après un chargement réussi. Aucun minuteur de rechargement de page n'est ajouté.

Dans l'espace Contrôle des stocks, l'onglet Notifications utilise son historique d'événements et la préférence de lecture propre au compte et au stock. Son indicateur est masqué à zéro. L'ouverture de cet onglet enregistre la date du dernier événement affiché ; les événements postérieurs restent non lus.

Publier le front pour activer ces changements ; aucune migration SQL supplémentaire n'est nécessaire.
