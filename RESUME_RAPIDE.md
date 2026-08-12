# 📋 RÉSUMÉ RAPIDE - Flux Matériels

## ✅ Votre Question Résolue!

### Vous aviez demandé :
1. ✅ Comment les données de sorties et demandes sont stockées dans appData
2. ✅ La structure exacte des objets sorties et demandes
3. ✅ Les champs date utilisés
4. ✅ Comment les items sont structurés
5. ✅ Exemples de données réelles
6. ✅ Comment d'autres fonctions accèdent à ces données
7. ✅ Données de test/exemples

---

## 📦 Réponse Directe

### 1️⃣ Structure appData (Stockage)
```javascript
appData = {
  stock: [{op, label, qty, type}],           // ← Matériels
  demandes: [{id, op, items, status, ...}], // ← Bons de sortie
  sorties: [{id, op, items, date, ...}],    // ← Rapports
  techDemandes: [{id, technicienId, ...}],  // ← Demandes brutes
  retours: [{id, label, qty, ...}],         // ← Retours
  notifications: [{userId, message, ...}],  // ← Journal
  consumptionArchives: [{key, stats, ...}], // ← Archives
  users: [{id, name, role, managedOps}]    // ← Utilisateurs
}
```

### 2️⃣ Objet SORTIE (Rapport de Sortie)
```javascript
{
  id: "SORTIE-1704067260000",
  ref: "BON PHYSIQUE N°42",
  op: "ITC-B01",              // Opérateur
  tech: "ROGER AHONON",       // Destinataire
  items: [
    { label: "CÂBLE FO 2MM", qty: 10 },
    { label: "PATCHCORD SC", qty: 5 }
  ],
  date: "01/01/2024 10:30:45",        // toLocaleString()
  createdBy: "GESTIONNAIRE BUREAU 01",
  updatedAt?: "...",                  // Optionnel
  updatedBy?: "..."                   // Optionnel
}
```

### 3️⃣ Objet DEMANDE (Bon de Sortie)
```javascript
{
  id: "BS-0001",
  demandeurOriginalId: 8,
  demandeurName: "TECHNICIEN TERRAIN",
  op: "ITC-B01",
  items: [
    { label: "CONNECTEUR SC", qty: 10 },
    { label: "BOÎTIER", qty: 2 }
  ],
  motif: "CHANTIER ABOBO",
  status: "EN ATTENTE GESTIONNAIRE" | "PRET" | "LIVREE",
  date: "10/12/2024",             // toLocaleDateString()
  dateLivraison?: "11/12/2024",
  assignedGestionnaireId?: 2,
  assignedGestionnaireName?: "GESTIONNAIRE BUREAU 01"
}
```

### 4️⃣ Champs DATE
| Objet | Champ | Format | Usage |
|-------|-------|--------|-------|
| Sortie | `date` | `jj/mm/aaaa HH:MM:SS` | Création |
| Demande | `date` | `jj/mm/aaaa` | Création |
| Archive | `archivedAt` | `jj/mm/aaaa HH:MM:SS` | Archivage |

### 5️⃣ Structure des ITEMS
```javascript
{
  label: "CÂBLE FO 2MM",  // Désignation
  qty: 10                  // Quantité
}
```

### 6️⃣ Exemples Données Réelles (Stock Initial)
```javascript
appData.stock = [
  { op: "ITC-B01", label: "CÂBLE FO 2MM", qty: 40, type: "CONNECTIQUES" },
  { op: "ITC-B01", label: "PATCHCORD SC", qty: 25, type: "CONNECTIQUES" },
  { op: "ITC-B01", label: "RACK 1U", qty: 10, type: "HARDWARE" },
  { op: "ITC-B02", label: "CÂBLE FO 2MM", qty: 50, type: "CONNECTIQUES" },
  { op: "MOOV", label: "SIM MOOV", qty: 120, type: "CONNECTIQUES" }
]
```

### 7️⃣ Fonctions d'Accès aux Données

| Fonction | Entrée | Sortie | Utilité |
|----------|--------|--------|---------|
| `getSortieItems(s)` | Sortie | `[{label, qty}]` | Extrait items (gère format ancien/nouveau) |
| `getSortieTimestamp(date)` | `"jj/mm/aaaa HH:MM:SS"` | Timestamp | Parser date pour comparaison |
| `normalizeOperatorKey(op)` | `"ITC"/"OCI"` | `"ITC-B01"/"OCI"` | Harmoniser opérateurs |
| `getManagedOpsNormalized(user)` | User object | `["ITC-B01", "MTN"]` | Opérateurs gérés par gestionnaire |
| `renderRapportsSorties(container)` | Container DOM | - | Affiche toutes sorties |
| `renderArchivesConsommations(container)` | Container DOM | - | Affiche archives mensuelles |
| `renderStatsConsommation(container)` | Container DOM | - | Affiche stats mois courant |

### 8️⃣ Données de Test

#### Utilisateur Test
```javascript
{
  id: 8,
  name: "TECHNICIEN TERRAIN",
  role: "Technicien",
  email: "tech@itc.ci"
}
```

#### Demande Test
```javascript
{
  id: "BS-TEST-001",
  demandeurOriginalId: 8,
  demandeurName: "TECHNICIEN TERRAIN",
  op: "ITC-B01",
  items: [
    { label: "CÂBLE FO 2MM", qty: 10 },
    { label: "PATCHCORD SC", qty: 5 }
  ],
  motif: "CHANTIER ABOBO TEST",
  status: "EN ATTENTE GESTIONNAIRE",
  date: "10/12/2024"
}
```

---

## 🔄 FLUX COMPLET (8 ÉTAPES)

```
1. TECHNICIEN DEMANDE
   → techDemande { id: "T-...", status: "EN ATTENTE COORDINATION" }
   → appData.techDemandes.push()

2. COORDINATRICE TRAITE
   → demande { id: "BS-...", status: "EN ATTENTE GESTIONNAIRE" }
   → appData.demandes.push()
   → Notification gestionnaire

3. GESTIONNAIRE VALIDE
   → demande.status = "PRET"
   → Vérifie: qty_stock ≥ qty_demandée
   → Notification technicien

4. GESTIONNAIRE RÉSERVE (optionnel)
   → Physiquement au magasin
   → demande.status = "PREPAREE"

5. SCAN QR & SORTIE
   → handleScanSuccess() → finalSortie()
   → Décrémente: appData.stock[].qty -= qty
   → demande.status = "LIVREE"

6. RAPPORT CRÉÉ
   → sortie { items[], date, createdBy, ... }
   → appData.sorties.push()
   → Notification audit

7. FIN DU MOIS
   → ensureMonthlyConsumptionArchive()
   → Accumule sorties du mois
   → appData.consumptionArchives.push()

8. AFFICHAGE
   → renderRapportsSorties() : tous rapports
   → renderArchivesConsommations() : archives
   → renderStatsConsommation() : stats du mois
```

---

## 💡 Ce Qu'il Faut Retenir

### ✅ Data Model
- **Sorties** : Rapports physiques (avec `items[]` ou legacy `logs[]`)
- **Demandes** : Bons de sortie (avec statut et assignation)
- **Stock** : Matériels disponibles par opérateur
- **Archives** : Accumulation mensuelle de données

### ✅ Clés de Succès
- **Normaliser opérateurs** : "ITC" → "ITC-B01"
- **Parser dates** : Format "jj/mm/aaaa HH:MM:SS" → timestamp
- **Extraire items** : `getSortieItems()` gère 2 formats
- **Filtrer par rôle** : Gestionnaire ne voit QUE ses opérateurs
- **Sauvegarder** : Appeler `save()` après chaque modification

### ✅ Bugs à Chercher
| Symptôme | Cause | Fixe |
|----------|-------|------|
| Items vides | Format legacy | `getSortieItems()` |
| Dates invalides | Parse incorrect | `getSortieTimestamp()` |
| Filtre cassé | Op non normalisé | `normalizeOperatorKey()` |
| Archive vide | Pas créée | `ensureMonthlyConsumptionArchive()` |
| Accès refusé | Pas de filtrage | Vérifier `managedOps` |

---

## 🚀 Démarrer le Debugging

### Commande Console Immédiate
```javascript
// 1. Vérifier les données existent
console.log("appData.sorties:", appData.sorties.length);
console.log("appData.demandes:", appData.demandes.length);

// 2. Tester les fonctions clés
const sortie = appData.sorties[0];
console.log("Items extraits:", getSortieItems(sortie));

// 3. Vérifier un problème
const demande = appData.demandes[0];
const check = checkStockSufficient(demande);
console.log(check.ok ? "✅ OK" : "❌ " + check.message);
```

---

## 📂 Documentation Complète Créée

| Fichier | Utilité | Quand le lire |
|---------|---------|---------------|
| STRUCTURE_DONNEES_COMPLETE.md | Référence technique | Pour comprendre tout |
| FLUX_MATERIELS_COMPLET.md | Vue métier | Pour le "pourquoi" |
| GUIDE_DEBUGGING.md | Pratique | Pendant le debugging |
| CODE_SNIPPETS.md | Code réutilisable | Pour coder rapidement |
| DOCUMENTATION_INDEX.md | Guide navigation | Pour trouver ce qu'il faut |

→ **Tous ces fichiers sont dans votre projet!**

---

## ✨ Vous Avez Maintenant

✅ Structure complète d'appData  
✅ Tous les champs de sorties et demandes  
✅ Exemples réels de données  
✅ Tous les formats date utilisés  
✅ Toutes les fonctions d'accès  
✅ Flux complet du matériel  
✅ Code snippets prêts à l'emploi  
✅ Guide de debugging pratique  

**Bon coding! 🚀**
