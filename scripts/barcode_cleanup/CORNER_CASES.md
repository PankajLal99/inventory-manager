# Identification of Detailed Conditions & Corner Cases

Humne script ko analyze kiya hai aur kuch aise cases identify kiye hain jo documentation ya code mein dhyan rakhne chahiye.

## 1. Missing Corner Cases & Scenarios

### A. Barcode Swapping (Auto-assigned vs Scanned)
Yeh ek common case hai jaha physical reality aur digital record mismatch hote hain.

**Scenario**: 
- Aapne ParleG ka barcode `123` scan kiya.
- Invoice par galti se barcode `456` chad gaya (Auto-assignment ki wajah se).
- Customer `123` le gaya, par `456` dukan mein hi reh gaya.

**Resolution Logic in `repair_barcodes.py`**:
1. **Detection**: Script `Cart` (Physical scan list) aur `Invoice` (Digital record) ko compare karta hai.
2. **Identification**: 
    - `456` ko **"Auto-assigned"** mark kiya jata hai (Invoice pe hai par scan nahi hua).
    - `123` ko **"Lost Scan"** mark kiya jata hai (Scan hua par invoice pe nahi hai).
3. **The Swap**: 
    - Agar dono same product (ParleG) ke hain, toh script automatic swap kar deta hai.
    - `456`: `sold` -> `new` (Taki dukan ki inventory mein wapas aa jaye).
    - `123`: `new` -> `sold` (Taki digital record sahi ho jaye).
    - `InvoiceItem`: Link update karke `123` kar diya jata hai.

### C. Double-Sale Anomalies (Multiple Sales)
Yeh tab hota hai jab ek hi barcode do alag-alag invoices par "Sold" dikhta hai bina kisi return entry ke.

**Kyun hota hai? (Causes)**:
1. **Missing Return**: Item physically return hua, wapas sell bhi ho gaya, par system mein return entry nahi huyi.
2. **Duplicate Prints**: Do alag items pe same barcode print ho gaya.
3. **System Auto-Assignment**: Sabse common case! Invoice A par system ne ise automatically assign kar diya (taaki stock minus ho jaye), aur Invoice B pe aapne ise physically scan kiya.

**Resolution**:
- **Auto-Assign Fix**: `repair_barcodes.py` ise fix karta hai. Woh dekhta hai ki kis invoice pe yeh barcode beep (scan) nahi hua tha, aur waha se ise unlink kar deta hai.
- **Manual Verification**: Agar dono invoices pe barcode physically scan (beep) hua hai, toh yeh ek bada problem hai. Iska matlab barcode print hi do baar hua hai. Aise cases mein system sirf **investigate (detect)** karta hai aur auditor ko manually check karne ko bolta hai.

### D. Manual Items Overwrite (Vibhinn Case)
`barcode_status_healer.py` sirff `scanned_barcodes` (beeps) ko priority deta hai.
- **Risk**: Agar POS operator ne kuch items manually bina scan kiye add kiye honge (Manual Entry), toh healer unhe "Legacy manual" toh bolega par agar quantity zero ho gayi toh delete kar prioritizes scans.
- **Impact**: Manual adjustments lost ho sakte hain.

### B. Race Conditions (Concurrency)
Agar koi operator POS pe checkout kar raha hai usi waqt cleanup script chal jaye:
- **Risk**: Script `prefetch_related` use karta hai. Data Fetch hone aur Update hone ke beech agar change ho gaya toh corruption ho sakta hai.
- **Solution**: Cleanup hamesha "Offline hours" mein ya server band karke karna chahiye.

### C. Deleted Entities (Zombie Foreign Keys)
- **Risk**: Agar koi `Product` ya `Barcode` record database se manual delete kiya gaya ho par `CartItem` mein uski ID abhi bhi ho.
- **Technical Issue**: `Product.objects.get(id=d['product_id'])` crash kar jayega agar product ID missing ho.

### D. Return & Exchange Status
- **Risk**: Script hamesha status ko `sold` karta hai.
- **Corner Case**: Agar transaction Return ya Exchange ka hai, toh status `returned` ya `defective` hona chahiye. Healer current logic mein use `sold` kar dega.

### E. Multiple Stores (Database Routing)
- **Risk**: Script default database run karta hai.
- **Limitation**: Agar client multiple databases (Dhar, SouthBetul etc.) use kar raha hai toh scripts ko manual migrate/configure karna padega store-wise.

## 2. Recommended Improvements for Scripts

1.  **Add Try-Except Blocks**: `Product.objects.get` ki jagah `filter().first()` use karein taaki missing products pe script crash na ho.
2.  **Transaction Status Check**: `Invoice.objects.exclude(status='void')` ke saath `exclude(status='draft')` bhi add karna chahiye kyunki draft invoices abhi process mein hoti hain.
3.  **Logging Enhancement**: `csv_logger.py` achha hai, par ek "Summary JSON" bhi banni chahiye reversal ke liye.

---

> [!NOTE]
> Barcode Cleanup suite production-ready hai par hamesha `--apply` se pehle `audit` check karna anivarya hai.
