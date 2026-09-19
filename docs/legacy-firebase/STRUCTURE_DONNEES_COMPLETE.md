# 📊 Structure Complète des Données - Application Gestion Matériels ITC

## 1️⃣ STRUCTURE DE appData (Objet Principal)

```javascript
appData = {
  stock: [],                    // Stock disponible par opérateur
  demandes: [],                 // Bons de sortie/commandes
  techDemandes: [],             // Demandes des techniciens
  sorties: [],                  // Rapports de sorties physiques
  retours: [],                  // Retours de matériel
  notifications: [],            // Journal des événements
  consumptionArchives: [],      // Archives mensuelles des consommations
  lastConsumptionArchiveKey: null, // Clé du dernier archivage
  scansDuJour: [],              // Scans QR du jour
  derniereDateScan: null,       // Dernière date de scan
  users: [],                    // Liste des utilisateurs
  materialTypes: []             // Types de matériel personnalisés
}
```

---

## 2️⃣ STRUCTURE DES SORTIES

### Structure d'un objet `sortie` :
```javascript
{
  id: "SORTIE-1734567890",      // Identifiant unique
  ref: "BON N°123",              // Référence du bon physique
  op: "ITC",                     // Opérateur (ITC, OCI, CIC, MOOV, MTN)
  tech: "NOM RÉCEPTIONNAIRE",    // Destinataire
  
  // Items sortants : structure principale
  items: [
    {
      label: "CÂBLE FO 2MM",    // Désignation du matériel
      qty: 10                    // Quantité sortie
    },
    {
      label: "PATCHCORD SC",
      qty: 5
    }
  ],
  
  // Format hérité (si pas d'items array) :
  logs: [                        // ALTERNATIF : logs stockent "label (-qty)"
    "CÂBLE FO 2MM (-10)",
    "PATCHCORD SC (-5)"
  ],
  
  date: "12/12/2024 14:35:22",   // Date/heure de création (toLocaleString)
  createdBy: "GESTIONNAIRE BUREAU 01",
  
  // Champs optionnels (lors d'une correction) :
  updatedAt: "13/12/2024 09:15:00",
  updatedBy: "GESTIONNAIRE BUREAU 01"
}
```

### Champs DATE dans sorties :
- **`date`** : Date de création au format `"jj/mm/aaaa HH:MM:SS"`
- **`updatedAt`** : Date de dernière modification (optionnel)

### Exemples de Données Réelles :
```javascript
appData.sorties = [
  {
    id: "SORTIE-1704067260000",
    ref: "BON PHYSIQUE N°42",
    op: "ITC-B01",
    tech: "ROGER AHONON",
    items: [
      { label: "CÂBLE FO 2MM", qty: 40 },
      { label: "PATCHCORD SC", qty: 25 }
    ],
    date: "01/01/2024 10:30:45",
    createdBy: "GESTIONNAIRE BUREAU 01"
  },
  {
    id: "SORTIE-1704067500000",
    ref: "CHANTIER COCODY",
    op: "OCI",
    tech: "JEAN DUPONT",
    logs: ["CÂBLE CUIVRE (-30)", "RACK 1U (-2)"],
    date: "01/01/2024 11:15:00",
    createdBy: "GESTIONNAIRE BUREAU 01"
  }
]
```

---

## 3️⃣ STRUCTURE DES DEMANDES

### Structure d'un objet `demande` (bon de sortie) :
```javascript
{
  id: "BS-1234",                 // Identifiant unique
  demandeurOriginalId: 8,        // ID du technicien qui a demandé
  demandeurName: "TECHNICIEN TERRAIN",
  
  op: "ITC-B01",                 // Opérateur source
  prestataire: "ITC / ÉQUIPE FIBRE",  // Équipe exécutante
  
  items: [
    {
      label: "CONNECTEUR SC",
      qty: 10
    },
    {
      label: "BOÎTIER DISTRIBUTION",
      qty: 2
    }
  ],
  
  motif: "CHANTIER ABOBO - INSTALLATION RÉSEAU FIBRE",
  
  status: "EN ATTENTE GESTIONNAIRE" | "PRET" | "LIVREE",
  
  // Dates
  date: "10/12/2024",            // Date de création
  dateLivraison: "11/12/2024",   // Date de livraison (si LIVREE)
  
  // Assignation du gestionnaire
  assignedGestionnaireId: 2,
  assignedGestionnaireName: "GESTIONNAIRE BUREAU 01",
  
  // Coordinatrice
  coordinateurNom: "COORDINATRICE"
}
```

### Statuts possibles :
- **EN ATTENTE GESTIONNAIRE** : En attente de réservation au magasin
- **PRET** : Réservé et prêt à être livré
- **LIVREE** : Matériel livré au technicien
- **PREPARÉE** : En cours de préparation

### Exemples de Données Réelles :
```javascript
appData.demandes = [
  {
    id: "BS-0001",
    demandeurOriginalId: 8,
    demandeurName: "TECHNICIEN TERRAIN",
    op: "ITC-B01",
    items: [
      { label: "CÂBLE FO 2MM", qty: 10 },
      { label: "PATCHCORD SC", qty: 5 }
    ],
    motif: "CHANTIER ABOBO - INSTALLATION",
    status: "LIVREE",
    date: "10/12/2024",
    dateLivraison: "10/12/2024",
    assignedGestionnaireId: 2,
    assignedGestionnaireName: "GESTIONNAIRE BUREAU 01"
  }
]
```

---

## 4️⃣ STRUCTURE DU STOCK

### Structure d'un objet `stock` :
```javascript
{
  op: "ITC-B01",           // Opérateur (ITC-B01, ITC-B02, OCI, CIC, MOOV, MTN)
  label: "CÂBLE FO 2MM",  // Désignation
  qty: 50,                 // Quantité disponible
  type: "CONNECTIQUES"     // Catégorie (optionnel)
}
```

### Exemple de stock initial :
```javascript
appData.stock = [
  { op: "ITC-B01", label: "CÂBLE FO 2MM", qty: 40, type: "CONNECTIQUES" },
  { op: "ITC-B01", label: "PATCHCORD SC", qty: 25, type: "CONNECTIQUES" },
  { op: "ITC-B01", label: "RACK 1U", qty: 10, type: "HARDWARE" },
  { op: "ITC-B02", label: "CÂBLE FO 2MM", qty: 50, type: "CONNECTIQUES" },
  { op: "ITC-B02", label: "PATCHCORD SC", qty: 30, type: "CONNECTIQUES" },
  { op: "MOOV", label: "SIM MOOV", qty: 120, type: "CONNECTIQUES" }
]
```

---

## 5️⃣ STRUCTURE DES UTILISATEURS

### Structure d'un objet `user` :
```javascript
{
  id: 1,
  name: "AHONON ROGER",
  role: "Superviseur",           // Rôles : Superviseur, Gestionnaire, Coordinatrice, Technicien
  email: "roger.ahonon@itc.ci",
  
  // Pour Gestionnaire : opérateurs gérés
  managedOps: ["ITC-B01", "MTN", "OCI", "CIC"]
}
```

### Utilisateurs par défaut :
```javascript
appData.users = [
  { id: 1, name: "AHONON ROGER", role: "Superviseur", email: "roger.ahonon@itc.ci" },
  { id: 2, name: "GESTIONNAIRE BUREAU 01", role: "Gestionnaire", email: "gest@itc.ci", 
    managedOps: ["ITC-B01", "MTN", "OCI", "CIC"] },
  { id: 9, name: "GESTIONNAIRE BUREAU 02", role: "Gestionnaire", email: "gest_b02@itc.ci",
    managedOps: ["ITC-B02", "MOOV"] },
  { id: 7, name: "COORDINATRICE", role: "Coordinatrice", email: "coord@itc.ci" },
  { id: 8, name: "TECHNICIEN TERRAIN", role: "Technicien", email: "tech@itc.ci" }
]
```

---

## 6️⃣ STRUCTURE DES NOTIFICATIONS

### Structure d'une `notification` :
```javascript
{
  userId: 1,                     // ID de l'utilisateur destinataire
  message: "AUDIT : SORTIE VALIDÉE (BS-0001)",
  date: "12/12/2024 14:35:22",   // toLocaleString()
  auditFlux: "ITC-B01"           // Opérateur concerné (optionnel)
}
```

---

## 7️⃣ STRUCTURE DES ARCHIVES DE CONSOMMATION

### Structure d'une `consumptionArchive` :
```javascript
{
  key: "2024-11",                // Format : "YYYY-MM"
  label: "novembre 2024",        // Label lisible
  monthIndex: 10,                // 0-11 (novembre = 10)
  year: 2024,
  
  // Statistiques par technicien
  statsTech: {
    "TECHNICIEN 1": 25,
    "TECHNICIEN 2": 18
  },
  
  // Statistiques par équipe
  statsEquipe: {
    "ÉQUIPE FIBRE": 50,
    "ÉQUIPE GÉNIE CIVIL": 20
  },
  
  // Détails par opérateur
  operatorStats: {
    "ITC-B01": {
      availableTotal: 500,       // Stock disponible ce mois
      entrantsByDesignation: {
        "CABLE_FO_2MM": 50,      // Articles entrés
        "PATCHCORD_SC": 30
      },
      sortantsByDesignation: {
        "CABLE_FO_2MM": 40,      // Articles sortis
        "PATCHCORD_SC": 20
      },
      sortantsDetails: [         // Détail des sorties avec référence
        { designation: "CABLE FO 2MM", reference: "BON N°42", qty: 30 },
        { designation: "PATCHCORD SC", reference: "CHANTIER ABOBO", qty: 15 }
      ]
    },
    "OCI": { /* ... */ },
    "CIC": { /* ... */ },
    "MOOV": { /* ... */ },
    "MTN": { /* ... */ },
    "ITC-B02": { /* ... */ }
  },
  
  archivedAt: "01/12/2024 10:15:00"
}
```

---

## 8️⃣ FONCTIONS CLÉS D'ACCÈS AUX DONNÉES

### Extraction des items d'une sortie :
```javascript
function getSortieItems(sortie) {
  // 1. Si items array existe, l'utiliser
  if (Array.isArray(sortie?.items)) {
    return sortie.items
      .filter((item) => item && item.label)
      .map((item) => ({
        label: String(item.label),
        qty: Number(item.qty) || 0
      }));
  }

  // 2. Sinon, extraire des logs
  if (Array.isArray(sortie?.logs)) {
    return sortie.logs
      .map((entry) => {
        const match = entry.match(/^(.*?)\s*\(-\s*(\d+)\s*\)$/);
        if (match) {
          return { label: match[1].trim(), qty: Number(match[2]) };
        }
      })
      .filter(Boolean);
  }

  return [];
}
```

### Parsing de date :
```javascript
function getSortieTimestamp(dateText) {
  // Cherche le format "jj/mm/aaaa hh:mm(:ss)"
  const match = String(dateText || "").match(
    /(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\D+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/
  );
  if (match) {
    const day = parseInt(match[1], 10);
    const month = parseInt(match[2], 10) - 1;
    const year = parseInt(match[3], 10);
    const hour = parseInt(match[4] || "0", 10);
    const minute = parseInt(match[5] || "0", 10);
    const second = parseInt(match[6] || "0", 10);
    return new Date(year, month, day, hour, minute, second).getTime();
  }
  return 0;
}
```

---

## 9️⃣ FONCTIONS DE RENDU (AFFICHAGE)

### Afficher les rapports de sorties :
```javascript
function renderRapportsSorties(container, options = {})
// - Groupe les sorties par mois (Gestionnaire) ou par référence (Superviseur)
// - Permet l'édition des sorties
// - Affiche des graphiques d'analyse
```

### Afficher les archives de consommation :
```javascript
function renderArchivesConsommations(container)
// - Liste les archives mensuelles
// - Affiche résumés par opérateur
// - Permet export PDF/Excel
```

### Afficher les statistiques de consommation :
```javascript
function renderStatsConsommation(container)
// - Rapport mensuel courant
// - Statistiques par équipe et technicien
// - Flux entrants/sortants par désignation
```

---

## 🔟 NORMALISATION DES OPÉRATEURS

```javascript
function normalizeOperatorKey(opValue) {
  const normalized = String(opValue || "").trim().toUpperCase();

  // Variantes Orange -> OCI
  if (["ORANGE", "OCI", "OCI-CIC", "ORANGE/OCI"].includes(normalized)) {
    return "OCI";
  }

  // Opérateurs directs
  if (normalized === "CIC") return "CIC";
  if (normalized === "MOOV") return "MOOV";
  if (normalized === "MTN") return "MTN";

  // Variantes ITC
  if (normalized.includes("ITC-B02")) return "ITC-B02";
  if (normalized.includes("ITC-B01")) return "ITC-B01";
  if (normalized.includes("ITC")) return "ITC-B01";  // Défaut

  return normalized || "ITC-B01";
}
```

---

## 1️⃣1️⃣ CHAMPS DATE UTILISÉS

| Objet | Champ | Format | Utilisé Pour |
|-------|-------|--------|--------------|
| Sortie | `date` | `jj/mm/aaaa HH:MM:SS` | Date de création |
| Sortie | `updatedAt` | `jj/mm/aaaa HH:MM:SS` | Dernière modification |
| Demande | `date` | `jj/mm/aaaa` | Date de création |
| Demande | `dateLivraison` | `jj/mm/aaaa` | Date de livraison |
| Notification | `date` | `jj/mm/aaaa HH:MM:SS` | Timestamp événement |
| Archive | `archivedAt` | `jj/mm/aaaa HH:MM:SS` | Date d'archivage |

---

## 1️⃣2️⃣ FLUX DE DONNÉES - EXEMPLE COMPLET

### 1. Technicien demande du matériel
```javascript
// INPUT : Demande du technicien ID 8
techDemande = {
  id: "T-0042",
  technicienId: 8,
  technicienNom: "TECHNICIEN TERRAIN",
  equipe: "ÉQUIPE FIBRE 1",
  objectif: "CHANTIER COCODY",
  besoin: "10X CONNECTEUR SC, 2X BOÎTIER",
  statut: "EN ATTENTE COORDINATION"
}
// Sauvegardé dans : appData.techDemandes
```

### 2. Coordinatrice traite la demande
```javascript
// CONVERSION : Demande → Bon de sortie
demande = {
  id: "BS-0001",
  demandeurOriginalId: 8,
  demandeurName: "TECHNICIEN TERRAIN",
  items: [
    { label: "CONNECTEUR SC", qty: 10 },
    { label: "BOÎTIER DISTRIBUTION", qty: 2 }
  ],
  status: "EN ATTENTE GESTIONNAIRE",
  date: "10/12/2024"
}
// Sauvegardé dans : appData.demandes
```

### 3. Gestionnaire réserve le matériel
```javascript
// UPDATE : Status → PRET
demande.status = "PRET";
// Stock mis à jour automatiquement
```

### 4. Matériel livré au technicien
```javascript
// FINAL : Status → LIVREE
demande.status = "LIVREE";
demande.dateLivraison = "10/12/2024";

// Créer le rapport de sortie
sortie = {
  id: "SORTIE-1704067260000",
  ref: "BS-0001",
  op: "ITC-B01",
  tech: "TECHNICIEN TERRAIN",
  items: [
    { label: "CONNECTEUR SC", qty: 10 },
    { label: "BOÎTIER DISTRIBUTION", qty: 2 }
  ],
  date: "10/12/2024 14:35:22"
}
// Sauvegardé dans : appData.sorties
```

### 5. Consommation archivée mensuellement
```javascript
// À la fin du mois précédent :
archive = {
  key: "2024-11",
  label: "novembre 2024",
  operatorStats: {
    "ITC-B01": {
      sortantsDetails: [
        { designation: "CONNECTEUR SC", reference: "BS-0001", qty: 10 }
      ]
    }
  }
}
// Sauvegardé dans : appData.consumptionArchives
```

---

## 1️⃣3️⃣ POINTS CRITIQUES POUR LE DÉBOGAGE

### ✅ Vérifier la migration des données
- Les anciennes sorties peuvent avoir `logs` au lieu de `items`
- Fonction `getSortieItems()` gère les deux formats

### ✅ Vérifier les dates
- Format : `jj/mm/aaaa HH:MM:SS` (toLocaleString)
- Parser avec `getSortieTimestamp()` pour comparer

### ✅ Vérifier la normalisation des opérateurs
- "ITC", "ITC-B01", "ITC-B02" doivent être normalisés
- Utiliser `normalizeOperatorKey()` avant les comparaisons

### ✅ Archivage mensuel
- `consumptionArchives` doit contenir les mois précédents
- Fonction `ensureMonthlyConsumptionArchive()` l'ajoute automatiquement

### ✅ Filtrage par rôle
- Les gestionnaires ne voient que leurs opérateurs (`managedOps`)
- Fonction `getManagedOpsNormalized(user)` retourne la liste autorisée

---

## 🎯 RÉSUMÉ POUR LE DEBUGGING

| Problème | Fichier/Fonction | Solution |
|----------|------------------|----------|
| Sorties ne s'affichent pas | `renderRapportsSorties()` | Vérifier `appData.sorties` existe |
| Dates mal affichées | `getSortieTimestamp()` | Format doit être `jj/mm/aaaa HH:MM:SS` |
| Items vides dans sortie | `getSortieItems()` | Vérifier `items[]` ou `logs[]` |
| Opérateur non reconnu | `normalizeOperatorKey()` | Normaliser avant comparaison |
| Archives manquantes | `ensureMonthlyConsumptionArchive()` | Appeler à chaque chargement données |
| Gestionnaire voit tous | `getManagedOpsNormalized()` | Filtrer par rôle et managedOps |
