# 🔄 Flux Matériels - Diagramme Complet d'Interaction

## 1️⃣ ACTEURS ET RÔLES

### 🧑‍💼 Superviseur (ID: 1)
- **Permissions**: Tous les opérateurs, tous les rapports
- **Vue**: Tous les bons, toutes les sorties
- **Actions**: Audit, modifications, consultations

### 🏪 Gestionnaire (ID: 2, 9)
- **Permissions**: Opérateurs gérés seulement
- **Vue**: `appData.demandes` filtrés par `managedOps`
- **Actions**: 
  - Valider commandes (`status = "PRET"`)
  - Vérifier stock
  - Préparer sorties

### 👩‍💼 Coordinatrice (ID: 7)
- **Permissions**: Création de commandes, traitement demandes
- **Vue**: `appData.techDemandes`, `appData.demandes`
- **Actions**:
  - Convertir demandes tech → bons de sortie
  - Créer commandes directes
  - Assigner gestionnaires

### 🔧 Technicien (ID: 8)
- **Permissions**: Ses propres demandes
- **Vue**: `appData.demandes` filtrés par `demandeurOriginalId`
- **Actions**:
  - Soumettre demande via `techDemandes`
  - Télécharger bons PDF
  - Retourner matériel

---

## 2️⃣ FLUX COMPLET D'UNE SORTIE

```
┌─────────────────────────────────────────────────────────────────┐
│                     FLUX MATÉRIELS COMPLET                       │
└─────────────────────────────────────────────────────────────────┘

1️⃣ TECHNICIEN DEMANDE MATÉRIEL
   ├─ Remplit: nom, équipe, besoin, site
   ├─ Crée: techDemande { id: "T-...", status: "EN ATTENTE COORDINATION" }
   ├─ Enregistre: appData.techDemandes.unshift(techDemande)
   └─ Notification: Coordinatrice alertée

2️⃣ COORDINATRICE TRAITE DEMANDE
   ├─ Lit: techDemande depuis appData.techDemandes
   ├─ Sélectionne gestionnaire (optionnel)
   ├─ Crée: demande {
   │    id: "BS-...",
   │    demandeurOriginalId: techDemande.technicienId,
   │    items: [...],
   │    status: "EN ATTENTE GESTIONNAIRE"
   │  }
   ├─ Enregistre: appData.demandes.unshift(demande)
   ├─ Mise à jour: techDemande.statut = "VALIDÉ"
   ├─ Notifications: 
   │    • Technicien: "Votre bon BS-0001 est prêt"
   │    • Gestionnaire: "Nouvelle commande BS-0001"
   └─ Sauvegarde: save()

3️⃣ GESTIONNAIRE VALIDE COMMANDE
   ├─ Lit: appData.demandes (filtrés par managedOps)
   ├─ Contrôle: Stock disponible pour items[]
   ├─ Vérifie: qty_demandée ≤ qty_stock
   ├─ Si OK:
   │    ├─ Mise à jour: demande.status = "PRET"
   │    └─ Notification: Technicien alerté
   ├─ Si NOK:
   │    └─ Alerte: "Stock insuffisant pour [label]"
   └─ Sauvegarde: save()

4️⃣ TECHNICIEN TÉLÉCHARGE BON (PDF)
   ├─ Lit: demande (id = BS-0001, status = "PRET")
   ├─ Fonction: downloadPDF("BS-0001")
   ├─ Génère: PDF avec items[], motif, etc.
   └─ Télécharge: document PDF

5️⃣ GESTIONNAIRE PRÉSERVE MATÉRIEL
   ├─ Sélectionne: demande.status = "PRET"
   ├─ Physique: Mise en réserve du matériel au magasin
   ├─ Mise à jour: demande.status = "PREPAREE"
   └─ Enregistrement interne (pas sauvegardé d'habitude)

6️⃣ SORTIE PHYSIQUE (SCANNER/DÉLIVRANCE)
   ├─ Gestionnaire scanne QR: handleScanSuccess("BS-0001")
   ├─ Vérifie: demande.status = "PRET" ou "EN ATTENTE GESTIONNAIRE"
   ├─ Fonction: finalSortie("BS-0001")
   │    ├─ Contrôle stock pour chaque item
   │    ├─ Décrémente: appData.stock[i].qty -= demande.items[i].qty
   │    ├─ Mise à jour: demande.status = "LIVREE"
   │    ├─ Fixe: demande.dateLivraison = new Date().toLocaleDateString()
   │    ├─ Crée rapport sortie: sorties.unshift({...})
   │    └─ Notifications: Technicien + Superviseur (audit)
   └─ Sauvegarde: save()

7️⃣ ARCHIVES MENSUELLES (AUTO-EXÉCUTION)
   ├─ Déclencheur: ensureMonthlyConsumptionArchive() à chaque chargement
   ├─ Créé: Archive { key: "2024-11", operatorStats: {...} }
   ├─ Accumule: Données du mois écoulé
   ├─ Contient:
   │    ├─ Consommations par opérateur
   │    ├─ Sorties par article
   │    ├─ Stockage pour rapports historiques
   │    └─ Archivage complet du mois
   └─ Enregistrement: appData.consumptionArchives.push(archive)

8️⃣ RAPPORTS ET CONSULTATION
   ├─ renderRapportsSorties(): Affiche toutes sorties (avec édition)
   ├─ renderArchivesConsommations(): Affiche archives mensuelles
   ├─ renderStatsConsommation(): Stats mois courant
   └─ Export: PDF/Excel des rapports
```

---

## 3️⃣ POINTS D'ENTRÉE DE DONNÉES

```javascript
// ✅ POINT 1 : Demande technicien
appData.techDemandes = [
  {
    id, technicienId, technicienNom, equipe, besoin, objectif, 
    statut: "EN ATTENTE COORDINATION"
  }
]

// ✅ POINT 2 : Commande directe (coordinatrice)
appData.demandes = [
  {
    id, demandeurOriginalId, demandeurName, op, items,
    motif, status: "EN ATTENTE GESTIONNAIRE"
  }
]

// ✅ POINT 3 : Retour de matériel
appData.retours = [
  {
    id, techName, label, qty, etat, motif, date,
    status: "EN ATTENTE"
  }
]

// ✅ POINT 4 : Réception stock
appData.stock = [
  {
    op, label, qty, type
  }
]
```

---

## 4️⃣ TRANSFORMATIONS DE DONNÉES

```javascript
// TRANSFORMATION 1 : techDemande → demande
techDemande {
  technicienId: 8,
  technicienNom: "TECH TERRAIN",
  equipe: "ÉQUIPE FIBRE",
  besoin: "10X CONNECTEUR",
  objectif: "CHANTIER SITE X"
}
         ↓ (Coordinatrice)
demande {
  demandeurOriginalId: 8,
  demandeurName: "TECH TERRAIN",
  prestataire: "ITC / ÉQUIPE FIBRE",
  items: [{label: "CONNECTEUR SC", qty: 10}],
  motif: "CHANTIER SITE X"
}

// TRANSFORMATION 2 : demande → sortie (LIVREE)
demande (LIVREE) {
  id: "BS-0001",
  items: [{label: "CÂBLE FO 2MM", qty: 10}],
  op: "ITC-B01",
  demandeurName: "TECH TERRAIN"
}
         ↓ (Finalisation)
sortie {
  id: "SORTIE-1704067260000",
  ref: "BS-0001",
  op: "ITC-B01",
  tech: "TECH TERRAIN",
  items: [{label: "CÂBLE FO 2MM", qty: 10}],
  date: "01/01/2024 10:30:45"
}

// TRANSFORMATION 3 : sorties → archive consommation
sorties (mois écoulé) [50 sorties]
         ↓ (Fin du mois)
consumptionArchive {
  key: "2024-11",
  operatorStats: {
    "ITC-B01": {
      sortantsByDesignation: {
        "CABLE_FO_2MM": 150
      }
    }
  }
}
```

---

## 5️⃣ ACCÈS AUX DONNÉES PAR RÔLE

### 📊 Superviseur (Vue Complète)
```javascript
// Accès TOTAL
const toutSorties = appData.sorties;           // Toutes sorties
const toutDemandes = appData.demandes;         // Toutes demandes
const toutStock = appData.stock;               // Tout stock
const toutArchives = appData.consumptionArchives; // Archives

// Pas de filtrage par opérateur
// Peut modifier tout
```

### 🏪 Gestionnaire (Vue Restreinte)
```javascript
// Étape 1 : Récupérer les opérateurs gérés
const managedOps = getManagedOpsNormalized(currentUser);
const allowedOps = new Set(managedOps); // ["ITC-B01", "MTN"]

// Étape 2 : Filtrer demandes
const mesDemandes = appData.demandes.filter(d =>
  d.status === "EN ATTENTE GESTIONNAIRE" &&
  allowedOps.has(normalizeOperatorKey(d.op))
);

// Étape 3 : Filtrer stock
const monStock = appData.stock.filter(s =>
  allowedOps.has(normalizeOperatorKey(s.op))
);

// Étape 4 : Filtrer sorties (pour audit)
const mesSorties = appData.sorties.filter(s =>
  allowedOps.has(normalizeOperatorKey(s.op))
);
```

### 👩‍💼 Coordinatrice (Vue Spécialisée)
```javascript
// Accès aux demandes des techniciens
const techDemandes = appData.techDemandes;

// Accès aux bons (pour assignation)
const bonsPrêts = appData.demandes.filter(d =>
  d.status === "EN ATTENTE GESTIONNAIRE"
);

// Pas de filtrage par opérateur (crée partout)
```

### 🔧 Technicien (Vue Personnelle)
```javascript
// Accès à SES demandes seulement
const mesDemandes = appData.demandes.filter(d =>
  d.demandeurOriginalId === currentUser.id &&
  ["EN ATTENTE GESTIONNAIRE", "PRET", "LIVREE"].includes(d.status)
);

// Ses retours
const mesRetours = appData.retours.filter(r =>
  r.techName === currentUser.name
);
```

---

## 6️⃣ CRITÈRES DE VALIDATION

### ✅ Validation Demande → PRET
```javascript
// CONDITIONS À VÉRIFIER
const demande = appData.demandes.find(d => d.id === "BS-0001");

// Vérifier stock pour chaque item
let stockOK = true;
demande.items.forEach(item => {
  const stock = appData.stock.find(s =>
    s.label === item.label && s.op === demande.op
  );
  if (!stock || stock.qty < item.qty) {
    stockOK = false; // ❌ REFUSER
  }
});

if (stockOK) {
  demande.status = "PRET"; // ✅ APPROUVER
} else {
  alert("STOCK INSUFFISANT"); // 🔴 REJETER
}
```

### ✅ Validation Sortie Physique
```javascript
// Avant finalSortie()
const demande = appData.demandes.find(d => d.id === "BS-0001");

// Vérifier:
// 1. Status == "PRET" ou "EN ATTENTE GESTIONNAIRE"
if (!["PRET", "EN ATTENTE GESTIONNAIRE"].includes(demande.status)) {
  alert("❌ Mauvais statut"); return;
}

// 2. Stock ENCORE DISPONIBLE (peut avoir été utilisé ailleurs)
demande.items.forEach(item => {
  const stock = appData.stock.find(s =>
    s.label === item.label && s.op === demande.op
  );
  if (stock.qty < item.qty) {
    alert("❌ STOCK RUPTURE"); return;
  }
});

// 3. OK → Procéder à finalSortie()
demande.status = "LIVREE";
demande.items.forEach(item => {
  const s = appData.stock.find(st =>
    st.label === item.label && st.op === demande.op
  );
  s.qty -= item.qty; // Décrémente stock
});
```

---

## 7️⃣ NOTIFICATIONS CRITIQUES

```javascript
// NOTIFICATION 1: Technicien envoie demande
→ Coordinatrice reçoit: "BESOIN : TECH TERRAIN (ÉQUIPE FIBRE)"
  Destinataire: currentUser.id = 7 (Coordinatrice)

// NOTIFICATION 2: Coordinatrice crée bon
→ Technicien reçoit: "VOTRE BON BS-0001 EST PRÊT. TÉLÉCHARGEZ LE PDF."
  Destinataire: demande.demandeurOriginalId = 8 (Technicien)
→ Gestionnaire reçoit: "NOUVELLE COMMANDE À TRAITER : BS-0001"
  Destinataire: assignedGestionnaireId (ou ID 2 par défaut)

// NOTIFICATION 3: Gestionnaire valide
→ Technicien reçoit: "MATÉRIEL RÉSERVÉ POUR BS-0001"
  (Implicite dans PRET)

// NOTIFICATION 4: Sortie physique validée
→ Superviseur reçoit: "AUDIT : SORTIE VALIDÉE (BS-0001)"
  Destinataire: ID 1 (Superviseur)
→ Technicien reçoit: "VOTRE MATÉRIEL EST DISPONIBLE (BS-0001)."
  Destinataire: demande.demandeurOriginalId

// NOTIFICATION 5: Modification stock
→ Superviseur reçoit: "ALERTE MODIFICATION STOCK : L'article X..."
  Destinataire: ID 1 (Superviseur)
```

---

## 8️⃣ DÉPENDANCES DE DONNÉES

```
appData.stock
    ↓
    ├─→ renderCockpit() [alertes rupture]
    ├─→ finalSortie() [vérification avant sortie]
    └─→ addDirectRow() [datalist suggestions]

appData.demandes
    ↓
    ├─→ renderDemandesGestionnaire() [commandes en attente]
    ├─→ renderTechMesDemandes() [mes bons]
    ├─→ renderLivraisonForm() [bons prêts]
    ├─→ handleScanSuccess() [lookup par ID]
    └─→ buildConsumptionSnapshot() [stats du mois]

appData.techDemandes
    ↓
    └─→ renderCoordFluxTech() [demandes en attente coordination]

appData.sorties
    ↓
    ├─→ renderRapportsSorties() [affichage rapports]
    ├─→ buildConsumptionSnapshot() [accumulation]
    └─→ ensureMonthlyConsumptionArchive() [création archive]

appData.notifications
    ↓
    └─→ renderNotifications() [journal des événements]

appData.consumptionArchives
    ↓
    └─→ renderArchivesConsommations() [affichage archives]
```

---

## 9️⃣ POINTS CRITIQUES DE SYNCHRONISATION

### ⏰ Moment 1 : Chargement des données
```javascript
// Firebase listener
db.ref("itc_data").on("value", snapshot => {
  const newData = snapshot.val();
  appData = newData;
  ensureMonthlyConsumptionArchive(); // ← CRITIQUE
  renderUI();
  save(); // Écrire localStorage
});
```

### ⏰ Moment 2 : Fin du mois
```javascript
// À 00:00 du 1er du mois suivant
function verifierReinitialisationQuotidienne() {
  const today = new Date();
  if (appData.derniereDateScan === today.toLocaleDateString()) {
    return; // Déjà fait
  }
  
  // Nouveau jour → créer archive si mois changé
  ensureMonthlyConsumptionArchive();
}
```

### ⏰ Moment 3 : Scan QR
```javascript
function handleScanSuccess(id) {
  // 1. Vérifier date (si minuit passé)
  verifierReinitialisationQuotidienne();
  
  // 2. Ajouter à scansDuJour
  appData.scansDuJour.unshift({...});
  
  // 3. Sauvegarder
  save();
}
```

---

## 🔟 RÉSUMÉ FLUX CLÉS

| Phase | Fonction | Entrée | Sortie | appData Affecté |
|-------|----------|--------|--------|-----------------|
| Demande | `handleTechSubmit()` | Formulaire | techDemande | `techDemandes` |
| Traitement | `submitCmd()` | techDemande + items | demande | `demandes` |
| Validation | `prepSortie()` | demande.id | status=PRET | `demandes.status` |
| Sortie | `finalSortie()` | demande.id | sortie créée | `sorties`, `stock` |
| Archive | `ensureMonthlyConsumptionArchive()` | - | archive créée | `consumptionArchives` |
| Export | `exportRapport()` | mois sélectionné | PDF/Excel | (lecture seule) |

---

## 🏆 Bon à Savoir

- ✅ **Migr automatique**: `getSortieItems()` gère `items[]` ET `logs[]`
- ✅ **Archives auto**: `ensureMonthlyConsumptionArchive()` appelée chaque sync
- ✅ **Notifications auto**: Chaque action importante crée notification
- ✅ **Audit trail**: Superviseur voit toutes modifications avec qui/quand
- ⚠️ **Pas d'annulation**: Sortie LIVREE ne peut pas être annulée
- ⚠️ **Stock irréversible**: Une fois décrémenté, ne revient qu'à réception
- ⚠️ **Date critique**: Nécessaire pour archivage mensuel

---

## 📌 Quick Reference Statuts

```
DEMANDE:
  EN ATTENTE GESTIONNAIRE → PRET → LIVREE
  
TECHNICIAN REQUEST:
  EN ATTENTE COORDINATION → VALIDÉ
  
RETOUR:
  EN ATTENTE → (Superviseur valide)
```

Voilà! 🎯 Vous avez maintenant la vue complète du Flux Matériels!
