# Sous-stocks du bureau 02

Appliquer dans Supabase `supabase/migrations/202609240004_bureau02_substocks.sql` après les migrations existantes du circuit de validation et des transferts régionaux, puis publier le site (`npm.cmd run build`). La migration est transactionnelle et réexécutable. Elle ne modifie pas les quantités existantes et ne change pas les affectations.

Le gestionnaire actif affecté à ITC-B02 dispose, dans chacun de ses stocks dédiés (notamment ITC-B02 et MOOV), de **Stock-production**, **Stock-déploiement** et **Stock-maintenance**. Les stocks régionaux accessibles uniquement pour les transferts ne deviennent pas des stocks dédiés du bureau 02.

Cliquer sur une carte de stock du tableau de bord ouvre les quantités et les articles de chaque sous-stock. Le reliquat non classé est indiqué **À répartir**. Déplier un article permet de saisir les quantités totales souhaitées dans les trois sous-stocks. Leur somme ne peut pas dépasser le stock global ; une modification concurrente impose une actualisation. Cette réorganisation est auditée et ne crée ni entrée ni sortie.

Les nouvelles réceptions du bureau 02 exigent un sous-stock destinataire. Le stock et son mouvement de réception sont enregistrés dans une seule transaction. Un identifiant d’opération empêche un double crédit lors d’un nouvel essai après une réponse perdue.

Les transferts et corrections débitent automatiquement **production, puis déploiement, puis maintenance** ; s’il reste une quantité à prélever, elle est prise dans **À répartir**. Les débits de sous-stocks sont audités. Un transfert entrant reste à répartir dans le stock destinataire : il ne copie pas la répartition du stock source. Une augmentation par correction de stock augmente également la part à répartir ; une diminution suit le même ordre de débit. Les bons et validations continuent d’utiliser la quantité globale de l’article.

Le modèle conserve une fiche article unique par grand stock, avec une répartition `subStocks` dans cette fiche. Les totaux de stock, les demandes, les bons et le flux de matériel continuent donc à compter chaque quantité une seule fois.

## Choix explicite lors des sorties

Appliquer ensuite `202609240005_explicit_substock_issues.sql`. Dans le formulaire de sortie, les stocks cochés affichent leurs matériels par sous-stock avec les disponibilités et une quantité à saisir. Le brouillon et la demande conservent ces choix. Lors de la remise physique du bon validé, le gestionnaire confirme ou répartit les quantités dans une fenêtre de choix. Le serveur impose les mêmes matériels et quantités que le bon validé et refuse un sous-stock insuffisant, sans prélever dans un autre. Les anciens bons sans sous-stock sont traités par cette même fenêtre. Les lignes du bon de sortie enregistré conservent les sous-stocks effectivement débités.
