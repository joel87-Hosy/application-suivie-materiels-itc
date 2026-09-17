const fs = require('node:fs');
const path = require('node:path');
const { jsPDF } = require('../.tools/report-libs/jspdf.js');
require('../.tools/report-libs/autotable.js').applyPlugin(jsPDF);

const outputDir = path.resolve('documents');
const output = path.join(outputDir, 'Guide_utilisation_controle_stocks_gestionnaire.pdf');
fs.mkdirSync(outputDir, { recursive: true });

const doc = new jsPDF({ unit: 'mm', format: 'a4' });
const page = () => ({ width: doc.internal.pageSize.getWidth(), height: doc.internal.pageSize.getHeight() });
const palette = { navy: [21, 43, 82], blue: [37, 99, 235], green: [22, 163, 74], amber: [217, 119, 6], red: [220, 38, 38], slate: [71, 85, 105], light: [241, 245, 249] };
let y = 22;

function footer() {
  const { width, height } = page();
  doc.setDrawColor(...palette.blue); doc.line(14, height - 13, width - 14, height - 13);
  doc.setTextColor(...palette.slate); doc.setFontSize(8);
  doc.text('ITC Gestion Matériels — Guide du compte Gestionnaire', 14, height - 8);
  doc.text(`Page ${doc.getNumberOfPages()}`, width - 14, height - 8, { align: 'right' });
}
function header(title, subtitle) {
  const { width } = page();
  doc.setFillColor(...palette.navy); doc.rect(0, 0, width, 17, 'F');
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text(title, 14, 11);
  doc.setTextColor(...palette.slate); doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.text(subtitle, 14, 23);
  y = 31;
}
function ensure(height = 15) {
  const { height: pageHeight } = page();
  if (y + height < pageHeight - 17) return;
  footer(); doc.addPage(); header('Guide — Contrôle des stocks', 'Compte Gestionnaire');
}
function title(text) {
  ensure(13); doc.setTextColor(...palette.navy); doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.text(text, 14, y); y += 7;
}
function text(textValue, options = {}) {
  const { size = 10, color = palette.slate, indent = 14, leading = 4.8, bold = false } = options;
  doc.setTextColor(...color); doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size);
  const lines = doc.splitTextToSize(textValue, 182 - (indent - 14)); ensure(lines.length * leading + 4);
  doc.text(lines, indent, y); y += lines.length * leading + 3;
}
function bullets(items) {
  items.forEach(item => { ensure(9); doc.setFillColor(...palette.blue); doc.circle(16, y - 1.2, 1, 'F'); text(item, { indent: 20 }); });
}
function note(label, content, color = palette.blue) {
  const lines = doc.splitTextToSize(content, 168); const height = lines.length * 4.6 + 11; ensure(height);
  doc.setFillColor(...palette.light); doc.roundedRect(14, y, 182, height, 3, 3, 'F');
  doc.setFillColor(...color); doc.roundedRect(14, y, 4, height, 3, 3, 'F');
  doc.setTextColor(...color); doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.text(label.toUpperCase(), 23, y + 6);
  doc.setTextColor(...palette.slate); doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text(lines, 23, y + 11);
  y += height + 5;
}
function numbered(steps) {
  steps.forEach((item, index) => { ensure(10); doc.setFillColor(...palette.navy); doc.circle(18, y - 1.5, 3, 'F'); doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.text(String(index + 1), 18, y + 1, { align: 'center' }); text(item, { indent: 25 }); });
}

doc.setFillColor(...palette.navy); doc.rect(0, 0, 210, 297, 'F');
doc.setFillColor(...palette.blue); doc.circle(180, 48, 35, 'F'); doc.setFillColor(...palette.green); doc.circle(29, 249, 22, 'F');
doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(25); doc.text('Guide d’utilisation', 22, 76);
doc.setFontSize(20); doc.text('Contrôle des stocks', 22, 87);
doc.setFontSize(15); doc.setTextColor(191, 219, 254); doc.text('Compte Gestionnaire', 22, 100);
doc.setDrawColor(191, 219, 254); doc.line(22, 110, 118, 110);
doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(255, 255, 255);
doc.text(doc.splitTextToSize('Procédures de consultation, entrée, validation des demandes, sortie, retour et traçabilité du matériel.', 145), 22, 128);
doc.setFontSize(9); doc.setTextColor(203, 213, 225); doc.text('Version opérationnelle — 17 septembre 2026', 22, 270);
footer(); doc.addPage();

header('Guide — Contrôle des stocks', '1. Objectif et accès');
title('Votre rôle de gestionnaire');
text('Le gestionnaire assure la disponibilité et la traçabilité du matériel dans les stocks qui lui sont attribués. Il consulte les quantités, enregistre les entrées, traite les demandes transmises par la coordination, valide les sorties et réintègre les retours conformes.');
note('Périmètre', 'Vous ne devez agir que sur les opérateurs et les stocks visibles dans votre compte. Si un stock n’apparaît pas, demandez une mise à jour de vos droits au superviseur.', palette.amber);
title('Accéder aux outils');
doc.autoTable({ startY: y, margin: { left: 14, right: 14 }, theme: 'grid', head: [['Menu', 'Utilisation']], body: [
  ['Stocks dédiés', 'Consulter les articles et quantités par opérateur, repérer les ruptures et organiser les articles par type.'],
  ['Entrée Stock', 'Réceptionner un matériel et ajouter sa quantité au stock existant.'],
  ['Commandes', 'Ouvrir les bons signés par la coordination et préparer leur validation.'],
  ['Sortie Bon Physique', 'Déduire un matériel remis sur la base d’un bon physique.'],
  ['Bons de Sortie / Flux Matériels', 'Contrôler les sorties, l’historique et les mouvements par matériel.'],
  ['Gestion des Retours', 'Valider la réintégration du matériel retourné conforme.'],
] , styles: { fontSize: 8.5, cellPadding: 2.5, textColor: palette.slate }, headStyles: { fillColor: palette.navy, textColor: 255 } });
y = doc.lastAutoTable.finalY + 8;
title('Lire l’écran d’un stock');
bullets(['Références : nombre de désignations enregistrées pour l’opérateur.', 'Unités en stock : somme des quantités disponibles.', 'Alertes rupture : articles dont la quantité est inférieure à 5 unités.', 'Types de matériel : catégories utilisées pour organiser la consultation.', 'Les graphiques présentent la répartition par type, le niveau de criticité et les articles les plus stockés.']);
note('Réflexe quotidien', 'Consultez les alertes rupture avant de valider une sortie importante ou de confirmer une demande au gestionnaire.', palette.red);

footer(); doc.addPage(); header('Guide — Contrôle des stocks', '2. Workflow opérationnel');
title('Circuit d’un mouvement de stock');
const flow = [
  { label: '1', title: 'Demande', body: 'Le technicien saisit le matériel et la quantité.' },
  { label: '2', title: 'Coordination', body: 'Le coordinateur vérifie, ajuste si nécessaire et signe.' },
  { label: '3', title: 'Gestionnaire', body: 'Vous contrôlez le bon, le stock et validez la sortie.' },
  { label: '4', title: 'Traçabilité', body: 'Le stock, les rapports et les notifications sont mis à jour.' },
];
flow.forEach((step, index) => { ensure(24); doc.setFillColor(...(index === 2 ? palette.green : palette.blue)); doc.roundedRect(14, y, 182, 20, 3, 3, 'F'); doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.text(step.label + '. ' + step.title, 20, y + 7); doc.setFont('helvetica','normal'); doc.setFontSize(8.5); doc.text(step.body, 20, y + 13); y += 23; });
title('Demande ajustée par la coordination');
text('Avant de vous être transmise, la coordination peut augmenter ou diminuer une quantité, retirer une ligne ou ajouter un matériel disponible. L’écran de validation gestionnaire affiche alors un encadré « Demande ajustée » avec le demande initiale et le matériel validé.');
bullets(['Vérifiez cet encadré avant de signer.', 'Contrôlez les quantités finales avec le stock réellement disponible.', 'Le technicien est informé lorsque son bon a été ajusté et signé.', 'L’ajustement conserve l’auteur, la date, les lignes avant modification et les lignes validées.']);
note('Règle de validation', 'Ne validez jamais une sortie si le stock affiché ne couvre pas la quantité finale. Corrigez le bon avec la coordination avant validation.', palette.red);
title('Préparer et valider une commande');
numbered(['Ouvrez « Commandes », puis sélectionnez le bon en attente qui vous est attribué.', 'Lisez le code de référence, le motif, les opérateurs et les éventuels ajustements de la coordination.', 'Vérifiez chaque article, sa quantité et l’état du stock.', 'Saisissez votre signature électronique puis choisissez « Valider la sortie et débiter le stock ».', 'Contrôlez le message de confirmation : le stock diminue, le bon passe à livré et le technicien est notifié.']);

footer(); doc.addPage(); header('Guide — Contrôle des stocks', '3. Entrées, sorties et retours');
title('Enregistrer une entrée de stock');
numbered(['Ouvrez « Entrée Stock ».', 'Choisissez l’opérateur, le type de matériel, la désignation et la quantité reçue.', 'Renseignez les informations demandées par le formulaire puis confirmez l’entrée.', 'Si le matériel existe déjà pour le même opérateur, l’application ajoute la quantité à la référence existante : elle ne crée pas de doublon.', 'Vérifiez la nouvelle quantité dans « Stocks dédiés ».']);
note('Contrôle à effectuer', 'Avant confirmation, comparez la désignation, l’opérateur et la quantité avec le bon de livraison ou la facture. Une erreur d’opérateur fausse les rapports.', palette.amber);
title('Sortie sur bon physique');
numbered(['Ouvrez « Sortie Bon Physique » et sélectionnez les stocks dédiés concernés.', 'Renseignez le destinataire, l’émetteur, le service émetteur (B2B, DEP ou MAIN), le motif et la date du bon.', 'Cochez les matériels réellement remis et indiquez leurs quantités.', 'Vérifiez que chaque quantité est disponible, puis validez la sortie.', 'Conservez le PDF. Son code contient le service, le motif, la date et un identifiant.']);
title('Retour de matériel');
text('Dans « Gestion des Retours », contrôlez l’état du matériel. Pour un retour marqué NEUF, la validation réintègre la quantité au stock. Le retour devient validé et une trace est créée. Ne réintégrez pas un matériel défectueux comme s’il était neuf.');
title('Modifier, déplacer ou supprimer une référence');
bullets(['Modifier : à utiliser uniquement pour corriger une quantité constatée et vérifiée.', 'Déplacer : change le type de classement de l’article sans confondre les opérateurs.', 'Supprimer : à réserver aux références créées par erreur ou définitivement obsolètes ; vérifiez qu’aucun mouvement en cours ne dépend de cette référence.']);

footer(); doc.addPage(); header('Guide — Contrôle des stocks', '4. Suivi, alertes et bonnes pratiques');
title('Contrôler la traçabilité');
text('Les écrans « Bons de Sortie » et « Flux Matériels » servent à vérifier les mouvements par matériel. Comparez les entrées, les sorties, le solde calculé et le stock actuel. Les rapports PDF et Excel doivent être exportés après les opérations importantes ou à la fin de la période de contrôle.');
title('Notifications');
bullets(['Bon à valider : une demande signée par la coordination attend votre contrôle.', 'Matériel disponible : le technicien est informé après validation de la sortie.', 'Audit : le superviseur reçoit une trace des opérations de sortie, retour et entrée.', 'Bip lorsque l’application est ouverte : il accompagne l’arrivée d’une nouvelle notification non lue.', 'Notification système lorsque l’application est fermée : chaque utilisateur doit l’activer dans « Mon profil », si le déploiement Firebase est terminé.']);
title('Checklist avant de terminer votre journée');
numbered(['Consulter les alertes de rupture sur chaque stock dédié.', 'Traiter ou signaler les commandes en attente.', 'Vérifier les sorties physiques enregistrées et leurs codes de référence.', 'Valider les retours conformes et isoler les matériels non conformes.', 'Contrôler les mouvements dans « Flux Matériels » puis exporter le rapport nécessaire.']);
note('En cas d’écart', 'Ne compensez pas une différence par une sortie fictive. Vérifiez le bon, l’opérateur, les quantités et les retours. Prévenez ensuite le superviseur avec la référence concernée.', palette.red);
title('Récapitulatif');
text('Le gestionnaire est le dernier contrôle avant la diminution réelle du stock. La qualité des données dépend de trois vérifications : bon correct, matériel correct et quantité disponible. Toute opération doit pouvoir être retrouvée dans les bons, les flux et les rapports.');
footer();

fs.writeFileSync(output, Buffer.from(doc.output('arraybuffer')));
console.log(output);
