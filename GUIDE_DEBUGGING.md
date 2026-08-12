# 🛠️ Guide Pratique de Debugging - Flux Matériels

## 🎯 Checklist Debugging Rapide

### 1️⃣ Vérifier les Données dans Console
```javascript
// Afficher tout appData
console.log("appData:", appData);

// Vérifier sorties
console.log("Sorties:", appData.sorties);
appData.sorties.forEach(s => {
  console.log(`${s.id}: ${s.op} → ${s.tech}, items: ${getSortieItems(s).length}`);
});

// Vérifier demandes
console.log("Demandes:", appData.demandes);
appData.demandes.forEach(d => {
  console.log(`${d.id}: ${d.demandeurName}, status: ${d.status}`);
});

// Vérifier stock
console.log("Stock:", appData.stock);
const itcStock = appData.stock.filter(s => 
  normalizeOperatorKey(s.op) === "ITC-B01"
);
console.log("Stock ITC-B01:", itcStock);

// Vérifier archives
console.log("Archives:", appData.consumptionArchives);
```

### 2️⃣ Tester les Fonctions Clés
```javascript
// Test getSortieItems avec 2 formats
const sortieAvecItems = appData.sorties[0];
console.log("Items (format new):", getSortieItems(sortieAvecItems));

// Test normalizeOperatorKey
console.log("ITC normalisé:", normalizeOperatorKey("ITC"));           // → "ITC-B01"
console.log("ITC-B02 normalisé:", normalizeOperatorKey("ITC-B02"));   // → "ITC-B02"
console.log("OCI normalisé:", normalizeOperatorKey("OCI"));           // → "OCI"
console.log("ORANGE normalisé:", normalizeOperatorKey("ORANGE"));     // → "OCI"

// Test getSortieTimestamp
const dateText = "12/12/2024 14:35:22";
const ts = getSortieTimestamp(dateText);
console.log(`Timestamp de "${dateText}":`, ts);
console.log("Date:", new Date(ts).toLocaleString());

// Test getManagedOpsNormalized
const gest = appData.users.find(u => u.role === "Gestionnaire");
console.log("Gestionnaire:", gest.name);
console.log("Opérateurs gérés:", getManagedOpsNormalized(gest));
```

### 3️⃣ Filtrer les Données Correctement
```javascript
// ✅ CORRECT : Sorties du mois courant
const now = new Date();
const currentMonth = now.getMonth();
const currentYear = now.getFullYear();

const sortiesMois = appData.sorties.filter(s => {
  const ts = getSortieTimestamp(s.date);
  const dt = new Date(ts);
  return dt.getMonth() === currentMonth && dt.getFullYear() === currentYear;
});
console.log(`Sorties du mois: ${sortiesMois.length}`);

// ✅ CORRECT : Demandes en attente pour gestionnaire
const currentUser = { role: "Gestionnaire", id: 2, managedOps: ["ITC-B01", "MTN"] };
const allowedOps = new Set(getManagedOpsNormalized(currentUser));

const mesCommandes = appData.demandes.filter(d => 
  d.status === "EN ATTENTE GESTIONNAIRE" && 
  allowedOps.has(normalizeOperatorKey(d.op))
);
console.log(`Mes commandes: ${mesCommandes.length}`);

// ✅ CORRECT : Calcul consommation par opérateur
const consumptionByOp = {};
appData.sorties.forEach(s => {
  const op = normalizeOperatorKey(s.op);
  const items = getSortieItems(s);
  const total = items.reduce((sum, i) => sum + (i.qty || 0), 0);
  consumptionByOp[op] = (consumptionByOp[op] || 0) + total;
});
console.log("Consommation par opérateur:", consumptionByOp);
```

---

## 🔴 Problèmes Courants et Solutions

### Problème 1 : "Sorties ne s'affichent pas"
```javascript
// ❌ MAUVAIS
appData.sorties.forEach(s => {
  const qty = s.items.reduce(...); // CRASH si items undefined
});

// ✅ BON
appData.sorties.forEach(s => {
  const items = getSortieItems(s); // Gère items ET logs
  const qty = items.reduce((sum, i) => sum + (i.qty || 0), 0);
});
```

### Problème 2 : "Dates ne s'affichent pas correctement"
```javascript
// ❌ MAUVAIS : Comparer strings directement
if (d.date === "10/12/2024") { } // Peut échouer avec HH:MM:SS

// ✅ BON : Parser les timestamps
const ts = getSortieTimestamp(d.date);
const dt = new Date(ts);
if (dt.getDate() === 10 && dt.getMonth() === 11 && dt.getFullYear() === 2024) { }
```

### Problème 3 : "Opérateur non reconnu"
```javascript
// ❌ MAUVAIS : Comparaisons en dur
if (s.op === "ITC") { } // Perd les "ITC-B01" / "ITC-B02"

// ✅ BON : Normaliser d'abord
const opNorm = normalizeOperatorKey(s.op);
if (opNorm === "ITC-B01") { }
```

### Problème 4 : "Gestionnaire voit tout"
```javascript
// ❌ MAUVAIS : Pas de filtrage
const toutesLesCommandes = appData.demandes;

// ✅ BON : Filtrer par rôle ET managedOps
if (currentUser.role === "Gestionnaire") {
  const allowedOps = new Set(getManagedOpsNormalized(currentUser));
  const mesCommandes = appData.demandes.filter(d =>
    allowedOps.has(normalizeOperatorKey(d.op))
  );
}
```

### Problème 5 : "Archive consommation manquante"
```javascript
// ❌ MAUVAIS : Accéder directement
const archive = appData.consumptionArchives.find(a => a.key === "2024-11");
if (!archive) { } // Null ?

// ✅ BON : S'assurer qu'elle existe
ensureMonthlyConsumptionArchive(); // Crée si manquante
const archive = appData.consumptionArchives.find(a => a.key === "2024-11");
```

---

## 📊 Scénarios de Test

### Scénario 1 : Créer une nouvelle sortie
```javascript
// 1. Créer la sortie
const newSortie = {
  id: "SORTIE-" + Date.now(),
  ref: "BON TEST N°1",
  op: "ITC-B01",
  tech: "TEST TECH",
  items: [
    { label: "CÂBLE FO 2MM", qty: 10 },
    { label: "PATCHCORD SC", qty: 5 }
  ],
  date: new Date().toLocaleString(),
  createdBy: currentUser.name
};

// 2. Ajouter à appData
appData.sorties.unshift(newSortie);

// 3. Sauvegarder
save();

// 4. Vérifier
console.log("Sortie créée:", newSortie.id);
console.log("Items extraits:", getSortieItems(newSortie));
```

### Scénario 2 : Traiter une demande technicien
```javascript
// 1. Technicien crée demande
const techDemande = {
  id: "T-" + Date.now().toString().slice(-4),
  technicienId: 8,
  technicienNom: "TECH TERRAIN",
  equipe: "ÉQUIPE FIBRE",
  objectif: "CHANTIER SITE X",
  besoin: "10X CONNECTEUR, 2X BOÎTIER",
  statut: "EN ATTENTE COORDINATION"
};
appData.techDemandes.unshift(techDemande);
save();

// 2. Coordinatrice convertit en bon
const bonDeSortie = {
  id: "BS-" + Date.now().toString().slice(-4),
  demandeurOriginalId: techDemande.technicienId,
  demandeurName: techDemande.technicienNom,
  op: "ITC-B01",
  items: [
    { label: "CONNECTEUR SC", qty: 10 },
    { label: "BOÎTIER DISTRIBUTION", qty: 2 }
  ],
  motif: techDemande.objectif,
  status: "EN ATTENTE GESTIONNAIRE",
  date: new Date().toLocaleDateString()
};
appData.demandes.unshift(bonDeSortie);
save();

// 3. Gestionnaire valide
const bon = appData.demandes.find(d => d.id === bonDeSortie.id);
bon.status = "PRET";
save();

// 4. Technicien reçoit matériel
bon.status = "LIVREE";
bon.dateLivraison = new Date().toLocaleDateString();

// Créer rapport sortie
const rapport = {
  id: "SORTIE-" + Date.now(),
  ref: bon.id,
  op: bon.op,
  tech: bon.demandeurName,
  items: bon.items,
  date: new Date().toLocaleString(),
  createdBy: "GESTIONNAIRE"
};
appData.sorties.unshift(rapport);
save();

console.log("✅ Flux complet terminé");
```

### Scénario 3 : Exporter données mensuelles
```javascript
// 1. Récupérer sorties du mois
const now = new Date();
const month = now.getMonth();
const year = now.getFullYear();

const sortiesMois = appData.sorties.filter(s => {
  const ts = getSortieTimestamp(s.date);
  const dt = new Date(ts);
  return dt.getMonth() === month && dt.getFullYear() === year;
});

// 2. Calculer statistiques par opérateur
const stats = {};
sortiesMois.forEach(s => {
  const op = normalizeOperatorKey(s.op);
  if (!stats[op]) {
    stats[op] = { sorties: 0, items: 0, total_qty: 0 };
  }
  stats[op].sorties++;
  const items = getSortieItems(s);
  stats[op].items += items.length;
  stats[op].total_qty += items.reduce((sum, i) => sum + (i.qty || 0), 0);
});

console.log("Statistiques du mois:", stats);

// 3. Exporter en CSV
const csvLines = ["Opérateur,Sorties,Articles,Quantités"];
Object.entries(stats).forEach(([op, data]) => {
  csvLines.push(`${op},${data.sorties},${data.items},${data.total_qty}`);
});
const csv = csvLines.join("\n");
console.log(csv);
```

---

## 🔍 Points d'Inspection Clés

### Dans la Console, Chercher:
```javascript
// 1. Intégrité des données
console.assert(Array.isArray(appData.sorties), "sorties must be array");
console.assert(Array.isArray(appData.demandes), "demandes must be array");
console.assert(Array.isArray(appData.stock), "stock must be array");

// 2. Présence des champs obligatoires
appData.sorties.forEach(s => {
  if (!s.id || !s.op || !s.date) {
    console.warn("⚠️ Sortie incomplète:", s);
  }
});

// 3. Cohérence des statuts
const validStatuses = ["EN ATTENTE GESTIONNAIRE", "PRET", "LIVREE", "PREPAREE"];
appData.demandes.forEach(d => {
  if (!validStatuses.includes(d.status)) {
    console.warn("⚠️ Statut invalide:", d.id, d.status);
  }
});

// 4. Vérifier les dates
appData.sorties.forEach(s => {
  const ts = getSortieTimestamp(s.date);
  if (ts === 0) {
    console.warn("⚠️ Date invalide pour sortie:", s.id, s.date);
  }
});

// 5. Vérifier les items
appData.demandes.forEach(d => {
  const items = getSortieItems(d);
  if (items.length === 0) {
    console.warn("⚠️ Demande sans items:", d.id);
  }
});
```

---

## 📈 Traces de Logs à Chercher

Quand quelque chose ne marche pas, chercher ces logs:

```javascript
// ✅ Logs de succès
console.log("✅ Sortie créée:", id);
console.log("✅ Demande traitée:", id);
console.log("✅ Données sauvegardées");

// ⚠️ Logs d'attention
console.warn("⚠️ Stock insuffisant pour:", label);
console.warn("⚠️ Date invalide:", dateText);
console.warn("⚠️ Opérateur non reconnu:", op);

// 🔴 Erreurs
console.error("🔴 Sortie non trouvée:", id);
console.error("🔴 Accès refusé:", user.role);
```

---

## 🚀 Commandes Utiles Rapides

```javascript
// Copier appData complète
copy(JSON.stringify(appData, null, 2));

// Exporter en JSON
const blob = new Blob(
  [JSON.stringify(appData, null, 2)],
  { type: "application/json" }
);
const url = URL.createObjectURL(blob);
const a = document.createElement("a");
a.href = url;
a.download = "appdata_" + Date.now() + ".json";
a.click();

// Nettoyer un mois d'archives
appData.consumptionArchives = appData.consumptionArchives
  .filter(a => a.key !== "2024-11");
save();

// Compter les bons par statut
["EN ATTENTE GESTIONNAIRE", "PRET", "LIVREE"].forEach(status => {
  const count = (appData.demandes || [])
    .filter(d => d.status === status).length;
  console.log(`${status}: ${count}`);
});
```

---

## 📌 Mémo des Fonctions Essentielles

| Fonction | Entrée | Sortie | Utilité |
|----------|--------|--------|---------|
| `getSortieItems(sortie)` | Objet sortie | [{label, qty}] | Extraire items |
| `getSortieTimestamp(dateText)` | "jj/mm/aaaa HH:MM:SS" | Number | Parser date |
| `normalizeOperatorKey(op)` | "ITC"/"OCI"/etc | "ITC-B01"/"OCI" | Normaliser opérateur |
| `getManagedOpsNormalized(user)` | User object | ["ITC-B01", "MTN"] | Opérateurs gérés |
| `ensureMonthlyConsumptionArchive()` | - | - | Créer archive mois |
| `addNotification(userId, message)` | (1, "msg") | - | Ajouter notification |
| `save()` | - | - | Sauvegarder Firebase |

Bon debugging! 🎯
