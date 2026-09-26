# Signatures et validation spéciale

La fenêtre de signature est commune aux techniciens, coordinateurs et
coordinatrices, validateurs et validatrices, et gestionnaires. Elle permet de
dessiner au doigt ou à la souris, ou d'importer un PNG, JPEG ou WebP de 5 Mo
maximum. L'image est redimensionnée en PNG de 640 × 200 sans déformation ; les
images trop détaillées pour la limite serveur sont refusées. Le nom reste
obligatoire. La confirmation avec le nom seul reste disponible.

Le PDF et le résultat de vérification du QR code dans le scanner gestionnaire
affichent les quatre emplacements avec nom, date et image lorsqu'ils sont
renseignés. Les dates de signature et identifiants des signataires sont fixés
par le serveur. Les anciens bons sans image conservent leur signature textuelle.
Une signature non encore effectuée est indiquée comme non renseignée.

## Exception du compte de coordination

Le compte `moovmaintenance@ivoiretechnocom.ci`, dans l'entreprise
`COMP-ITC-LEGACY`, choisit désormais le bureau 01 ou 02, un validateur actif de
ce bureau et le gestionnaire auprès duquel retirer le matériel. Ces champs
apparaissent dans la commande directe et dans la signature d'une demande
technicien. Le serveur reconnaît le compte via Authentication. Le gestionnaire
doit couvrir tous les stocks demandés. Seul le validateur choisi reçoit le bon
et peut décider ; il conserve aussi les renouvellements. Le gestionnaire choisi
ne peut pas être remplacé lors de la validation.

Le compte conserve son bureau d'origine et ses accès aux stocks. Le circuit est
enregistré sur le bon et devient immuable après transmission. Les anciens bons
sans choix nominatif conservent le circuit enregistré (bureau 02 après la
migration initiale `202609260003_special_validation_routing.sql`).

Les bons existants encore en attente de coordination ou de validation, sans
décision enregistrée, sont également réorientés. Les validateurs du bureau 02
reçoivent une notification pour ceux déjà en attente de validation. Les bons
déjà décidés conservent leur circuit et leur historique.

## Affectations multiples

À la création et à la modification des comptes concernés (technicien,
coordination, gestionnaire, validation), plusieurs bureaux et services peuvent
être sélectionnés. Les listes de coordinateurs et validateurs autorisés sont
facultatives : sans sélection, le circuit habituel selon les bureaux/services
s'applique. Pour un technicien, les coordinateurs sélectionnés limitent les
destinataires proposés. Les validateurs autorisés du technicien et de la
coordination se combinent par intersection ; une configuration sans validateur
commun bloque la demande avec un message. L'exception nominative du compte
spécial utilise le choix effectué au moment de sa signature.

Lors d'une demande, le technicien ou coordinateur choisit un bureau et un service
parmi ses affectations. Les correspondants doivent être actifs et appartenir à
la même entreprise. Les affectations historiques simples restent compatibles.
Les accès aux stocks restent gérés séparément. Les valeurs principales
`office`/`serviceAbbreviation` restent disponibles pour les anciens écrans ;
`offices`/`services` et les listes de correspondants portent les choix multiples.

La sauvegarde transactionnelle utilise désormais une mise à jour pour les bons
existants : elle conserve le verrouillage et la comparaison de version, sans
exécuter leurs contrôles de création à nouveau.

## Mise en production

Appliquer les migrations préalables dans l'ordre, notamment
`202609260001_bon_drawn_signatures.sql` et
`202609260002_account_affiliations.sql`, puis
`202609260003_special_validation_routing.sql` et
`202609260004_multiple_affiliations_choices.sql` dans l'éditeur SQL Supabase.
Vérifier l'état de la base avant application, comme décrit dans
[l'architecture](architecture.md#déploiement).
Déployer ensuite la fonction Supabase `company-users`, puis les fichiers produits
par `npm.cmd run build`. La version de cache PWA v54 charge les nouveaux modules.

Tests locaux : `npm.cmd test`, `node tools/test_bon_signatures_browser.cjs` et
`node tools/test_bon_scanner_browser.cjs` et
`node tools/test_account_affiliations_browser.cjs`.
Avec Node 22.17, exécuter la suite avec `NODE_OPTIONS=--experimental-strip-types`
pour les tests qui importent directement les fichiers TypeScript.
