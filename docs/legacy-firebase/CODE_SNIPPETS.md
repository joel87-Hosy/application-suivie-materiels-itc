# 🔧 Code Snippets - Flux Matériels

## 1️⃣ EXTRAIRE ET MANIPULER LES DONNÉES

### Obtenir tous les items d'une sortie (format nouveau et ancien)
```javascript
// ✅ SÛRE : Gère les deux formats
function getItemsFromSortie(sortie) {
  return getSortieItems(sortie);
}

// Utilisation
const sortie = appData.sorties[0];
const items = getItemsFromSortie(sortie);
console.log(items); // [{label: "...", qty: ...}]
```

### Obtenir toutes les sorties du mois courant
```javascript
function getSortiesOfCurrentMonth() {
  const now = new Date();
  return appData.sorties.filter(s => {
    const ts = getSortieTimestamp(s.date);
    const dt = new Date(ts);
    return dt.getMonth() === now.getMonth() && 
           dt.getFullYear() === now.getFullYear();
  });
}

// Utilisation
const sorties = getSortiesOfCurrentMonth();
console.log(`Sorties du mois: ${sorties.length}`);
```

### Obtenir toutes les demandes d'un technicien
```javascript
function getDemandesTofTechnicien(technicienId) {
  return (appData.demandes || []).filter(d =>
    d.demandeurOriginalId === technicienId
  );
}

// Utilisation
const mesCommandes = getDemandesTofTechnicien(8); // Technicien ID 8
console.log(`Mes commandes: ${mesCommandes.length}`);
```

### Obtenir le stock pour un opérateur
```javascript
function getStockForOperator(op) {
  const normalizedOp = normalizeOperatorKey(op);
  return appData.stock.filter(s =>
    normalizeOperatorKey(s.op) === normalizedOp
  );
}

// Utilisation
const stockITC = getStockForOperator("ITC");
console.log("Stock ITC:", stockITC);
```

### Obtenir les demandes en attente de validation
```javascript
function getDemandesEnAttente() {
  return (appData.demandes || []).filter(d =>
    d.status === "EN ATTENTE GESTIONNAIRE"
  );
}

// Utilisation
const enAttente = getDemandesEnAttente();
console.log(`Commandes à traiter: ${enAttente.length}`);
```

---

## 2️⃣ VALIDER AVANT D'AGIR

### Vérifier si le stock est suffisant
```javascript
function checkStockSufficient(demande) {
  const requiredItems = getSortieItems(demande);
  
  for (let item of requiredItems) {
    const stock = appData.stock.find(s =>
      s.label === item.label && 
      normalizeOperatorKey(s.op) === normalizeOperatorKey(demande.op)
    );
    
    if (!stock || stock.qty < item.qty) {
      return {
        ok: false,
        message: `Stock insuffisant pour "${item.label}" (besoin: ${item.qty}, dispo: ${stock?.qty || 0})`
      };
    }
  }
  
  return { ok: true };
}

// Utilisation
const demande = appData.demandes[0];
const check = checkStockSufficient(demande);
if (!check.ok) {
  console.error("❌ " + check.message);
} else {
  console.log("✅ Stock OK");
}
```

### Vérifier si une date est valide
```javascript
function isDateValid(dateText) {
  const ts = getSortieTimestamp(dateText);
  return ts !== 0; // 0 = parse échoué
}

// Utilisation
if (isDateValid("12/12/2024 14:35:22")) {
  console.log("✅ Date valide");
} else {
  console.log("❌ Date invalide");
}
```

### Vérifier si un gestionnaire peut voir une commande
```javascript
function canGestionnaireSeeDemande(gestionnaire, demande) {
  if (gestionnaire.role !== "Gestionnaire") {
    return false; // Pas un gestionnaire
  }
  
  const allowedOps = new Set(getManagedOpsNormalized(gestionnaire));
  return allowedOps.has(normalizeOperatorKey(demande.op));
}

// Utilisation
const gestionnaire = appData.users.find(u => u.id === 2);
const demande = appData.demandes[0];
if (canGestionnaireSeeDemande(gestionnaire, demande)) {
  console.log("✅ Gestionnaire peut voir cette commande");
} else {
  console.log("❌ Accès refusé");
}
```

---

## 3️⃣ CRÉER ET MODIFIER LES DONNÉES

### Créer une nouvelle demande (simpler une submission formulaire)
```javascript
function createDemande(options) {
  const demande = {
    id: "BS-" + Date.now().toString().slice(-4),
    demandeurOriginalId: options.technicienId || currentUser.id,
    demandeurName: options.technicienName || currentUser.name,
    op: normalizeOperatorKey(options.op),
    items: options.items || [], // [{label, qty}, ...]
    motif: (options.motif || "").toUpperCase(),
    status: "EN ATTENTE GESTIONNAIRE",
    date: new Date().toLocaleDateString(),
    assignedGestionnaireId: options.gestionnaireId || null,
    assignedGestionnaireName: options.gestionnaireName || ""
  };
  
  appData.demandes.unshift(demande);
  save();
  
  return demande;
}

// Utilisation
const newDemande = createDemande({
  technicienId: 8,
  technicienName: "TECH TERRAIN",
  op: "ITC-B01",
  items: [
    { label: "CÂBLE FO 2MM", qty: 10 },
    { label: "PATCHCORD SC", qty: 5 }
  ],
  motif: "CHANTIER ABOBO",
  gestionnaireId: 2
});

console.log("Demande créée:", newDemande.id);
```

### Créer une sortie à partir d'une demande LIVREE
```javascript
function createSortieFromDemande(demande) {
  if (demande.status !== "LIVREE") {
    console.warn("⚠️ Demande n'est pas LIVREE");
    return null;
  }
  
  const sortie = {
    id: "SORTIE-" + Date.now(),
    ref: demande.id,
    op: demande.op,
    tech: demande.demandeurName,
    items: getSortieItems(demande), // Items du bon
    date: new Date().toLocaleString(),
    createdBy: currentUser.name
  };
  
  appData.sorties.unshift(sortie);
  save();
  
  return sortie;
}

// Utilisation
const demande = appData.demandes.find(d => d.id === "BS-0001");
if (demande && demande.status === "LIVREE") {
  const sortie = createSortieFromDemande(demande);
  console.log("Sortie créée:", sortie.id);
}
```

### Mettre à jour le statut d'une demande
```javascript
function updateDemandeStatus(demandeId, newStatus) {
  const validStatuses = ["EN ATTENTE GESTIONNAIRE", "PRET", "LIVREE", "PREPAREE"];
  
  if (!validStatuses.includes(newStatus)) {
    console.error("❌ Statut invalide:", newStatus);
    return false;
  }
  
  const demande = appData.demandes.find(d => d.id === demandeId);
  if (!demande) {
    console.error("❌ Demande non trouvée:", demandeId);
    return false;
  }
  
  demande.status = newStatus;
  
  if (newStatus === "LIVREE") {
    demande.dateLivraison = new Date().toLocaleDateString();
  }
  
  save();
  return true;
}

// Utilisation
if (updateDemandeStatus("BS-0001", "PRET")) {
  console.log("✅ Statut mis à jour");
} else {
  console.log("❌ Erreur");
}
```

### Décrémenter le stock pour une sortie
```javascript
function decrementStock(demande) {
  const items = getSortieItems(demande);
  
  for (let item of items) {
    const stock = appData.stock.find(s =>
      s.label === item.label && 
      normalizeOperatorKey(s.op) === normalizeOperatorKey(demande.op)
    );
    
    if (stock) {
      stock.qty -= item.qty;
      if (stock.qty < 0) stock.qty = 0; // Sécurité
    }
  }
  
  save();
}

// Utilisation
const demande = appData.demandes.find(d => d.id === "BS-0001");
decrementStock(demande);
console.log("✅ Stock décrémenté");
```

---

## 4️⃣ ANALYSER LES DONNÉES

### Calculer la consommation par opérateur
```javascript
function analyzeConsumptionByOperator(startDate, endDate) {
  const consumption = {};
  
  appData.sorties.forEach(s => {
    const ts = getSortieTimestamp(s.date);
    if (ts < new Date(startDate).getTime() || ts > new Date(endDate).getTime()) {
      return; // Hors période
    }
    
    const op = normalizeOperatorKey(s.op);
    const items = getSortieItems(s);
    const totalQty = items.reduce((sum, i) => sum + (i.qty || 0), 0);
    
    consumption[op] = (consumption[op] || 0) + totalQty;
  });
  
  return consumption;
}

// Utilisation
const consumption = analyzeConsumptionByOperator("2024-01-01", "2024-12-31");
console.log("Consommation 2024:", consumption);
// { "ITC-B01": 150, "OCI": 80, ... }
```

### Calculer la consommation par article
```javascript
function analyzeConsumptionByArticle(op) {
  const byArticle = {};
  const normalizedOp = normalizeOperatorKey(op);
  
  appData.sorties.forEach(s => {
    if (normalizeOperatorKey(s.op) !== normalizedOp) return;
    
    const items = getSortieItems(s);
    items.forEach(item => {
      byArticle[item.label] = (byArticle[item.label] || 0) + (item.qty || 0);
    });
  });
  
  return byArticle;
}

// Utilisation
const articles = analyzeConsumptionByArticle("ITC-B01");
console.log("Articles sortis de ITC-B01:", articles);
// { "CÂBLE FO 2MM": 150, "PATCHCORD SC": 80, ... }
```

### Compter les bons par statut
```javascript
function countDemandesByStatus() {
  const counts = {
    "EN ATTENTE GESTIONNAIRE": 0,
    "PRET": 0,
    "LIVREE": 0,
    "PREPAREE": 0
  };
  
  appData.demandes.forEach(d => {
    if (d.status in counts) {
      counts[d.status]++;
    }
  });
  
  return counts;
}

// Utilisation
const counts = countDemandesByStatus();
console.log("Bons par statut:", counts);
// { "EN ATTENTE GESTIONNAIRE": 5, "PRET": 2, "LIVREE": 15, "PREPAREE": 0 }
```

### Identifier le stock faible
```javascript
function identifyLowStock(threshold = 5) {
  const lowStock = {};
  
  appData.stock.forEach(s => {
    if (s.qty < threshold) {
      const op = normalizeOperatorKey(s.op);
      if (!lowStock[op]) lowStock[op] = [];
      lowStock[op].push({
        label: s.label,
        qty: s.qty,
        needed: threshold - s.qty
      });
    }
  });
  
  return lowStock;
}

// Utilisation
const low = identifyLowStock(10);
console.log("Stock faible:", low);
// { "ITC-B01": [{label: "CÂBLE FO", qty: 3, needed: 7}] }
```

---

## 5️⃣ EXPORTER ET FORMATER LES DONNÉES

### Exporter demandes en CSV
```javascript
function exportDemandesAsCSV() {
  const lines = ["ID,Technicien,Opérateur,Motif,Statut,Date"];
  
  appData.demandes.forEach(d => {
    lines.push([
      d.id,
      d.demandeurName,
      d.op,
      d.motif,
      d.status,
      d.date
    ].map(v => `"${v || ""}"`).join(","));
  });
  
  return lines.join("\n");
}

// Utilisation
const csv = exportDemandesAsCSV();
console.log(csv);
// Ou sauvegarder : saveAsFile(csv, "demandes.csv", "text/csv")
```

### Exporter sorties par mois
```javascript
function exportSortiesByMonth(month, year) {
  const sorties = appData.sorties.filter(s => {
    const ts = getSortieTimestamp(s.date);
    const dt = new Date(ts);
    return dt.getMonth() === month && dt.getFullYear() === year;
  });
  
  const data = sorties.map(s => ({
    id: s.id,
    ref: s.ref,
    op: s.op,
    tech: s.tech,
    itemsCount: getSortieItems(s).length,
    date: s.date,
    createdBy: s.createdBy
  }));
  
  return JSON.stringify(data, null, 2);
}

// Utilisation
const json = exportSortiesByMonth(11, 2024); // Décembre 2024
console.log(json);
```

### Formater les items pour affichage
```javascript
function formatItemsForDisplay(items) {
  return items
    .map(i => `${i.label} (${i.qty} U)`)
    .join(" | ");
}

// Utilisation
const items = [{label: "CÂBLE FO", qty: 10}, {label: "PATCHCORD", qty: 5}];
console.log(formatItemsForDisplay(items));
// "CÂBLE FO (10 U) | PATCHCORD (5 U)"
```

---

## 6️⃣ SYNCHRONISER AVEC FIREBASE

### Sauvegarder les modifications
```javascript
// Cette fonction est déjà définie dans le code
// Elle synchronise appData avec Firebase et localStorage

function save() {
  // 1. Écrire à Firebase (mise à jour temps réel)
  db.ref("itc_data").set(appData);
  
  // 2. Écrire à localStorage (sauvegarde locale)
  localStorage.setItem("appData", JSON.stringify(appData));
  
  console.log("✅ Données sauvegardées");
}

// Utilisation après toute modification
appData.demandes.push(newDemande);
save(); // ← IMPORTANT : toujours appeler save()
```

### Recharger depuis Firebase
```javascript
async function reloadFromFirebase() {
  try {
    const snapshot = await db.ref("itc_data").once("value");
    appData = snapshot.val() || appData;
    console.log("✅ Données rechargées");
  } catch (error) {
    console.error("❌ Erreur chargement:", error);
  }
}

// Utilisation
await reloadFromFirebase();
```

---

## 7️⃣ HELPER FUNCTIONS INTÉGRÉES

### Normaliser un opérateur (déjà implémentée)
```javascript
// Disponible dans le code
normalizeOperatorKey("ITC");              // → "ITC-B01"
normalizeOperatorKey("OCI");              // → "OCI"
normalizeOperatorKey("ORANGE");           // → "OCI"
```

### Parser une date (déjà implémentée)
```javascript
// Disponible dans le code
getSortieTimestamp("12/12/2024 14:35:22"); // → timestamp (ms)
```

### Extraire les items (déjà implémentée)
```javascript
// Disponible dans le code
getSortieItems(sortie); // → [{label, qty}, ...]
// Gère items[] ET logs[] (legacy)
```

### Ajouter une notification (déjà implémentée)
```javascript
// Disponible dans le code
addNotification(userId, message);
```

---

## 📌 PATTERN DE CODAGE SÛRE

### ✅ TOUJOURS :
```javascript
// 1. Vérifier que le tableau existe
const demandes = appData.demandes || [];

// 2. Normaliser les opérateurs
const op = normalizeOperatorKey(s.op);

// 3. Utiliser getSortieItems() pour les items
const items = getSortieItems(sortie);

// 4. Parser les dates correctement
const ts = getSortieTimestamp(dateText);

// 5. Sauvegarder après modification
appData.demandes.push(newItem);
save(); // ← CRITIQUE
```

### ❌ JAMAIS :
```javascript
// 1. Accéder directement aux items
s.items.forEach(...); // CRASH si items undefined

// 2. Comparer opérateurs en dur
if (s.op === "ITC") { } // Perd "ITC-B01", "ITC-B02"

// 3. Comparer dates comme strings
if (d.date === "10/12/2024") { } // Échoue si HH:MM:SS présent

// 4. Oublier save()
appData.demandes.push(...); // Perdu après rechargement

// 5. Accéder sans vérifier
if (demandes.find(d => d.id === id)) // NullPointerException possible
```

Voilà! 🎯 Vous avez maintenant tous les snippets pour manipuler les données du Flux Matériels!
