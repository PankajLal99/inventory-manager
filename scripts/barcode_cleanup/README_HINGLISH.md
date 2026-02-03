# Barcode Cleanup Scripts Documentation (Hinglish)

Yeh directory mein woh scripts hain jo hamare inventory aur sales data ko synchronize rakhne mein madad karte hain. Agar kabhi barcodes ka status galat ho jaye ya invoice items mismatch ho jayein, toh hum inka use karte hain.

## 1. Scripts Ka Overview

| Script Name | Kya karta hai? (Purposes) | Kab use karein? |
| :--- | :--- | :--- |
| `audit_barcodes.py` | Sirf issues check karta hai (Report only). | Health check ke liye. |
| `repair_barcodes.py` | Individually barcodes ke status fix karta hai. | Jab barcode `sold` ho par invoice pe na ho. |
| `barcode_status_healer.py` | Pura invoice structure reconstruct karta hai. | Jab invoice empty ho ya products hi galat hon. |
| `emergency_restore.py` | Agar cleanup se kuch galat ho jaye toh revert karta hai. | Restoration ke liye. |

---

## 2. Ho kya raha hai? (What is happening?)

Jab hum koi cheez bechte hain (POS checkout), toh do-teen cheezein saath mein honi chahiye:
1. Invoice banni chahiye.
2. Invoice mein wahi items hone chahiye jo physically scan hue (Beeps).
3. Barcode ka status `available` se hat kar `sold` hona chahiye.

Lekin kabhi-kabhi network lag ya system crash ki wajah se:
- Barcode `available` hi reh jata hai (Inventory double dikhti hai).
- Invoice ban jati hai par usme items save nahi hote (Empty Invoice).
- System apne aap koi random barcode utha leta hai (Auto-assign mismatch).

---

## 3. Ham ise kaise Resolve kar rahe hain? (Resolution Logic)

### Step 1: Deep Investigation
Hum `Cart` table mein check karte hain ki asliyat mein (physically) kaunse barcodes scan hue the. Yeh hamara **"Source of Truth"** hai.

### Step 2: Identification
Hum compare karte hain:
- **Cart Scans (Asliyat)** vs **Invoice Items (Digital Record)**.
- Agar difference milta hai, toh use `audit` log mein mark karte hain.

### Step 3: Healing (Healer Logic)
Agar aap `--apply` run karte hain:
1. **Structural Fix**: Script purane (mismatched) invoice items ko delete karta hai.
2. **Reconstruction**: `Cart` ke scan data se naye invoice items banata hai.
3. **Status Sync**: In items se linked saare barcodes ko force karke `sold` status pe set karta hai.

---

## 4. Kaise Chalayein? (Usage)

Safe rehne ke liye hamesha pehle `Dry Run` karein:

```bash
# Sirf report dekhne ke liye
python audit_barcodes.py

# Barcode mismatches dekhne ke liye (No changes)
python repair_barcodes.py

# Invoice healing ka proposal dekhne ke liye
python barcode_status_healer.py

# CHANGES APPLY KARNE KE LIYE (CAUTION!)
python repair_barcodes.py --real
python barcode_status_healer.py --apply
```

---

> [!CAUTION]
> Cleanup run karne se pehle database ka backup zaroor lein.
