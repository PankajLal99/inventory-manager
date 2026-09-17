# Hardware attendance (ZKTeco ADMS)

Receives real-time punches from a ZKTeco K45 Pro (ADMS push) into this Django project’s Postgres DB.

## Push employees to the K45 (register only)

We **do not** use `pyzk` (TCP port 4370). Your device already speaks **ADMS HTTP**, so we queue commands and deliver them on `GET /iclock/getrequest`:

```text
C:{id}:DATA UPDATE USERINFO PIN=2	Name=ROHIT	Privilege=0	Password=	Card=
```

- **No fingerprint / TMP** is ever sent
- **Password is empty**
- Name + PIN only
- PIN change → `DATA DELETE USERINFO` (old) then `DATA UPDATE USERINFO` (new)
- Salary Book employee rename re-queues Name update for all mappings

### UI

Salary Book → **More → Devices**: map PIN → employee, **Save & push**, or **Push all users**.

Device picks up the command on the next ~30s poll. Watch **Recent device commands** for PENDING → SENT → ACKED.

### Libraries note

| Library | Protocol | Use here? |
|---------|----------|-----------|
| [pyzk](https://github.com/fananimi/pyzk) | TCP 4370 pull | No — needs LAN socket, not ADMS |
| [s0x90/zkteco-adms](https://github.com/s0x90/zkteco-adms) (Go) | ADMS HTTP | Reference for command format only |
| This app | ADMS HTTP | Yes — native Django queue |

---

## Local testing

1. Migrate:

```bash
python manage.py migrate attendance
python manage.py migrate salary_book
```

2. For first-time local device testing, auto-approve unknown serials:

```bash
export ATTENDANCE_AUTO_APPROVE_DEVICES=true
python manage.py runserver 0.0.0.0:8080
```

3. Point the K45 ADMS settings at your Mac LAN IP (example `192.168.1.27`), port `8080`, domain name **OFF**, proxy **OFF**.  
   Do **not** append `/iclock/cdata` to the server address — the device adds `/iclock/...` itself.

4. Or simulate without the device:

```bash
# Handshake
curl -s "http://127.0.0.1:8080/iclock/cdata?SN=WED3253601172"

# Attendance punch (captured fixture)
curl -s -X POST \
  "http://127.0.0.1:8080/iclock/cdata?SN=WED3253601172&table=ATTLOG&Stamp=9999" \
  -H "Content-Type: text/plain" \
  --data $'1\t2026-09-17 13:22:40\t0\t2\t0\t0\t0\t0\t0\t0'

# Health
curl -s http://127.0.0.1:8080/health/
```

5. In Django admin:

- **Devices** — set serial `WED3253601172` to Active (`is_active=True`) if auto-approve is off.
- **Device user mappings** — map device PIN (e.g. `1`) → `employee_id` (e.g. `EMP-001`).

6. Salary Book → Settings → Capture mode **Hardware** (default for new installs).  
   Existing installs keep Geo/Manual based on previous GPS setting until you switch.

7. Run tests:

```bash
python manage.py test backend.attendance
```

## Security notes

- Fingerprint template data in OPERLOG (`TMP=...`) is never stored or logged.
- `/iclock/*` has no JWT/CSRF (device protocol). Protect with network controls + approved device serials in production.
- Leave `ATTENDANCE_AUTO_APPROVE_DEVICES` unset/false in production.

## Production checklist

See [PRODUCTION.md](PRODUCTION.md).
