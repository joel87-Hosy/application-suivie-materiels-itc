const fs = require('node:fs');
const path = require('node:path');
const {jsPDF} = require('../.tools/report-libs/jspdf.js');
require('../.tools/report-libs/autotable.js').applyPlugin(jsPDF);

const target = path.resolve('documents', 'Guide_onglet_controle_des_stocks_gestionnaire.pdf');
fs.mkdirSync(path.dirname(target), {recursive:true});
const doc = new jsPDF({unit:'mm',format:'a4'});
const C = {navy:[16,37,63], teal:[13,118,110], blue:[37,99,235], amber:[217,119,6], red:[185,28,28], slate:[51,65,85], pale:[240,253,250]};
let y = 30;
const page = () => doc.internal.pageSize;
function footer(){const p=page();doc.setDrawColor(...C.teal);doc.line(14,p.getHeight()-13,p.getWidth()-14,p.getHeight()-13);doc.setFontSize(8);doc.setTextColor(...C.slate);doc.text('ITC Gestion Matériels — Onglet Contrôle des stocks',14,p.getHeight()-8);doc.text(`Page ${doc.getNumberOfPages()}`,p.getWidth()-14,p.getHeight()-8,{align:'right'});}
function head(subtitle){const p=page();doc.setFillColor(...C.navy);doc.rect(0,0,p.getWidth(),17,'F');doc.setFont('helvetica','bold');doc.setFontSize(12);doc.setTextColor(255,255,255);doc.text('CONTRÔLE DES STOCKS — GESTIONNAIRE',14,11);doc.setFont('helvetica','normal');doc.setFontSize(9);doc.setTextColor(...C.slate);doc.text(subtitle,14,23);y=31;}
function room(h=14){if(y+h<page().getHeight()-17)return;footer();doc.addPage();head('Guide d’utilisation');}
function h(t){room(12);doc.setFont('helvetica','bold');doc.setFontSize(13);doc.setTextColor(...C.navy);doc.text(t,14,y);y+=7;}
function p(t,style={}){const size=style.size||9.8,indent=style.indent||14,leading=style.leading||4.7;doc.setFont('helvetica',style.bold?'bold':'normal');doc.setFontSize(size);doc.setTextColor(...(style.color||C.slate));const lines=doc.splitTextToSize(t,196-indent);room(lines.length*leading+4);doc.text(lines,indent,y);y+=lines.length*leading+3;}
function steps(values){values.forEach((v,i)=>{room(10);doc.setFillColor(...C.teal);doc.circle(18,y-1.4,3,'F');doc.setFont('helvetica','bold');doc.setFontSize(8);doc.setTextColor(255,255,255);doc.text(String(i+1),18,y+1,{align:'center'});p(v,{indent:25});});}
function info(title,body,color=C.teal){const lines=doc.splitTextToSize(body,167),height=lines.length*4.5+11;room(height);doc.setFillColor(...C.pale);doc.roundedRect(14,y,182,height,3,3,'F');doc.setFillColor(...color);doc.roundedRect(14,y,4,height,3,3,'F');doc.setFont('helvetica','bold');doc.setFontSize(9);doc.setTextColor(...color);doc.text(title.toUpperCase(),23,y+6);doc.setFont('helvetica','normal');doc.setTextColor(...C.slate);doc.text(lines,23,y+11);y+=height+5;}

doc.setFillColor(...C.navy);doc.rect(0,0,210,297,'F');doc.setFillColor(...C.teal);doc.circle(173,47,34,'F');doc.setFillColor(...C.blue);doc.circle(32,246,23,'F');doc.setTextColor(255,255,255);doc.setFont('helvetica','bold');doc.setFontSize(25);doc.text('Guide d’utilisation',22,74);doc.setFontSize(19);doc.text('Contrôle des stocks',22,86);doc.setTextColor(153,246,228);doc.setFontSize(14);doc.text('Compte Gestionnaire',22,99);doc.setDrawColor(153,246,228);doc.line(22,109,120,109);doc.setFont('helvetica','normal');doc.setTextColor(255,255,255);doc.setFontSize(11);doc.text(doc.splitTextToSize('Mode d’emploi de l’onglet visible dans le menu latéral, pour participer aux contrôles et inventaires de vos stocks.',148),22,128);doc.setFontSize(9);doc.setTextColor(203,213,225);doc.text('Document opérationnel — 17 septembre 2026',22,270);footer();doc.addPage();

head('1. À quoi sert cet onglet ?');
h('Votre rôle dans le contrôle');
p('L’onglet « Contrôle des stocks » ne remplace pas les opérations quotidiennes d’entrée et de sortie. Il sert à vérifier les quantités, réaliser un comptage contradictoire avec le contrôleur, signaler des observations et suivre les écarts jusqu’à leur régularisation.');
info('À retenir','Le gestionnaire saisit son comptage et ses observations. Le contrôleur organise l’inventaire et vérifie les écarts. Le superviseur approuve la décision et applique une éventuelle régularisation.',C.amber);
h('Accéder à l’onglet');
steps(['Dans le menu latéral, cliquez sur « Contrôle des stocks », comme sur la capture.', 'En haut de l’écran, choisissez le stock qui vous a été attribué. Si aucun stock n’est proposé, demandez au superviseur de renseigner vos accès stock.', 'Utilisez les onglets internes : Tableau de bord, Stocks et matériels, Flux de stocks, Inventaires, Anomalies et régularisations, Plans d’action, Rapports et archives, Notifications.', 'Utilisez les filtres de recherche et de date pour limiter l’affichage au matériel ou à la période voulue.']);
h('Lire le tableau de bord');
doc.autoTable({startY:y,margin:{left:14,right:14},theme:'grid',head:[['Indicateur','Ce qu’il signifie']],body:[['Matériels suivis','Références présentes dans le stock sélectionné.'],['Inventaires en cours','Inventaires non clôturés ; vérifiez s’ils attendent votre comptage.'],['Anomalies ouvertes','Écarts ou problèmes toujours à traiter.'],['Actions en retard','Actions correctives dont l’échéance est dépassée.'],['À approuver','Inventaires transmis au superviseur.'],['Anomalies critiques','Situations à signaler sans délai.']],styles:{fontSize:8.5,cellPadding:2.4,textColor:C.slate},headStyles:{fillColor:C.navy,textColor:255}});y=doc.lastAutoTable.finalY+8;
info('Attention','Le tableau de bord du gestionnaire est une vue de suivi. Il ne permet pas de modifier librement le stock théorique.',C.red);

footer();doc.addPage();head('2. Consulter et préparer un inventaire');
h('Stocks et matériels');
p('Cet onglet affiche le stock théorique : désignation, catégorie, quantité, dernier comptage et écart observé lors du dernier inventaire clôturé. Ouvrez « Fiche » pour consulter les détails du matériel. Utilisez cette vue pour préparer physiquement les articles à compter.');
h('Flux de stocks');
p('Consultez les entrées, sorties, retours, transferts et régularisations. Rapprochez les mouvements avec les bons et justificatifs. Un flux incohérent doit être documenté dans une observation ou signalé au contrôleur.');
h('Quand un inventaire est lancé');
steps(['Le contrôleur crée l’inventaire puis le démarre. Le stock concerné est gelé : les modifications opérationnelles sont suspendues pendant le contrôle.', 'Ouvrez « Inventaires », puis la fiche de l’inventaire en cours.', 'Comptez physiquement chaque article. Saisissez votre quantité dans la colonne « Comptage gestionnaire ». Pendant le comptage, la quantité théorique est masquée pour garantir un comptage indépendant.', 'Enregistrez votre comptage. Ajoutez vos observations, votre accord ou votre désaccord dans le champ prévu.', 'Vérifiez que toutes les lignes ont été comptées avant la transmission au superviseur.']);
info('Comptage contradictoire','Votre quantité et celle du contrôleur sont séparées. Elles ne doivent pas être copiées l’une sur l’autre. L’écart est étudié seulement après la phase de comptage.',C.teal);
h('Ce que vous pouvez faire');
doc.autoTable({startY:y,margin:{left:14,right:14},theme:'grid',head:[['Action','Gestionnaire']],body:[['Consulter stocks, flux, dossiers et rapports','Oui'],['Saisir le comptage gestionnaire','Oui, pendant l’inventaire en cours'],['Ajouter observations, accord ou désaccord','Oui'],['Créer ou démarrer un inventaire','Non — contrôleur'],['Soumettre l’inventaire au superviseur','Non — contrôleur'],['Appliquer une régularisation de quantité','Non — superviseur']],styles:{fontSize:8.4,cellPadding:2.3,textColor:C.slate},headStyles:{fillColor:C.navy,textColor:255}});y=doc.lastAutoTable.finalY+7;

footer();doc.addPage();head('3. Anomalies, actions et clôture');
h('Après le comptage');
p('Lorsque le contrôleur soumet l’inventaire, les écarts peuvent générer des anomalies. Consultez l’onglet « Anomalies et régularisations » pour identifier les matériels concernés, la gravité, la description et les preuves demandées.');
steps(['Répondez à toute demande d’observation du gestionnaire : cause possible, référence de bon, retour non enregistré, transfert ou erreur de rangement.', 'Ajoutez les informations vérifiables : numéro de bon, date, personne ayant reçu le matériel ou emplacement constaté.', 'Suivez les « Plans d’action » jusqu’au statut « À vérifier » ou « Clôturé ». Respectez les échéances.', 'Le superviseur prend la décision motivée. S’il approuve une régularisation, il applique la correction puis clôture l’inventaire et libère le stock.']);
info('Stock gelé','N’essayez pas de corriger une quantité dans les écrans opérationnels pendant un inventaire gelé. Terminez le comptage et documentez l’écart ; la régularisation suit la décision du superviseur.',C.red);
h('Rapports et notifications');
p('Dans « Rapports et archives », exportez la synthèse CSV ou imprimez/enregistrez la vue en PDF. Dans « Notifications », consultez les événements du stock, leurs auteurs et dates, puis marquez-les comme lus lorsque le suivi est effectué.');
h('Checklist du gestionnaire');
steps(['Choisir le bon stock avant toute lecture ou saisie.', 'Compter physiquement, sans consulter la quantité théorique pendant le comptage.', 'Enregistrer une quantité pour chaque ligne et ajouter une observation en cas d’écart.', 'Joindre ou citer les références des bons et preuves disponibles.', 'Ne pas valider ni régulariser un écart soi-même : transmettre au contrôleur et au superviseur.']);
info('Bon réflexe','Un écart n’est pas une faute à masquer. Une explication claire et une preuve permettent de corriger le stock de manière traçable.',C.teal);
footer();
fs.writeFileSync(target,Buffer.from(doc.output('arraybuffer')));
console.log(target);
