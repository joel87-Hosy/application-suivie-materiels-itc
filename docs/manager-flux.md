# Flux matériels du gestionnaire

Les compteurs affichent le nombre d’opérations et la quantité totale de matériel correspondante, pour la période choisie. Un bon contenant plusieurs lignes du même matériel, y compris sur plusieurs stocks autorisés, compte une seule sortie pour ce matériel. Les détails conservent les quantités par stock, dates et références.

Les entrées proviennent de `stockMovements` de type `in` (réceptions), hors transferts. Les nouvelles réceptions Supabase enregistrent leur mouvement dans la même sauvegarde que la quantité du stock. Les sorties proviennent de `sorties`, hors transferts, et des demandes livrées anciennes sans sortie associée. Les demandes en attente de validation ou de remise ne comptent pas. Les demandes livrées ne sont jamais des entrées.

Le filtre porte sur le jour, la semaine du lundi au dimanche, le mois ou l’année contenant la date choisie (heure locale du navigateur). Le mois courant est sélectionné par défaut. La quantité « Stock actuel » est celle disponible aujourd’hui dans les stocks affectés. PDF et Excel suivent le filtre sélectionné.

Les anciennes archives mensuelles agrégées ne permettent pas de reconstruire un nombre exact d’opérations ou des dates : elles ne sont pas transformées en mouvements fictifs. Les anciennes entrées Supabase qui n’ont pas de mouvement enregistré ne peuvent donc pas être reconstituées automatiquement. Les anciens mouvements sans identifiant d’auteur restent visibles dans les stocks affectés ; lorsque l’auteur est renseigné, seuls ceux du gestionnaire sont retenus.

Publier le build statique ; aucune migration SQL n’est nécessaire pour ce changement.
