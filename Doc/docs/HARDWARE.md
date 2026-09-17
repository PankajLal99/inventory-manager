Build a production-ready ZKTeco K45 Pro ADMS attendance integration as a Django application.

## 1. Project context

We have a ZKTeco K45 Pro biometric attendance device.

Confirmed device details:

* Model: ZKTeco K45 Pro
* Device serial number: WED3253601172
* Device LAN IP during development: 192.168.1.201
* Firmware information observed from device: Ver 8.0.4.2-20210623
* Push Service observed: 2.0.333-20220813
* Communication mode: ADMS
* ADMS / Cloud Server Setting: enabled
* Enable Domain Name: supported
* Proxy: disabled
* TCP communication port: 4370
* Local development ADMS server: 192.168.1.27:8080

The device has already successfully pushed real attendance records to a plain Python HTTP server on the developer's Mac.

The observed request was:

POST /iclock/cdata?SN=WED3253601172&table=ATTLOG&Stamp=9999

Observed attendance payload:

1<TAB>2026-09-17 13:22:40<TAB>0<TAB>2<TAB>0<TAB>0<TAB>0<TAB>0<TAB>0<TAB>0

The device also sends:

GET /iclock/getrequest?SN=WED3253601172&INFO=...

and OPERLOG requests.

The device has also been observed sending biometric fingerprint template data in OPERLOG, for example:

FP PIN=2 FID=6 Size=1240 Valid=1 TMP=...

NEVER persist, expose, or unnecessarily log biometric template data.

The goal is to build a Django-based ADMS server that receives real-time attendance events from the K45 Pro and stores normalized attendance data in PostgreSQL.

---

## 2. Important protocol requirement

Implement the ZKTeco iClock ADMS HTTP Push protocol.

Primary endpoints:

GET /iclock/cdata
POST /iclock/cdata

GET /iclock/getrequest

POST /iclock/devicecmd

Optionally support:

GET /iclock/registry
POST /iclock/registry

The K45 automatically appends /iclock/cdata and other protocol paths to the configured server address.

Do NOT require the user to configure /iclock/cdata in the physical device's server-address field.

The device initiates HTTP requests to the server.

The application must support HTTP during local development and HTTPS behind Nginx in production.

---

## 3. Technology stack

Use:

* Python 3.11+
* Django 5.x
* Django REST Framework for normal application APIs
* PostgreSQL 17
* Gunicorn
* Nginx
* Docker-compatible deployment
* pytest or Django TestCase
* Python standard logging

Do not introduce unnecessary third-party ZKTeco SDKs.

Implement the ADMS HTTP protocol directly because the exact traffic from the target K45 Pro has already been captured and verified.

---

## 4. Django application structure

Create a dedicated Django app named:

attendance

Suggested structure:

attendance/
**init**.py
admin.py
apps.py
models.py
urls.py
views.py
services/
**init**.py
adms.py
parser.py
devices.py
attendance.py
tests/
test_adms.py
test_parser.py
test_attendance.py

Keep ADMS protocol handling separate from normal authenticated application APIs.

---

## 5. Database models

Create a Device model.

Fields:

* id
* serial_number
* device_name
* ip_address
* firmware_version
* platform
* push_service_version
* is_active
* last_seen_at
* last_attendance_at
* created_at
* updated_at

serial_number must be unique.

Example:

serial_number = WED3253601172

Create an Employee/User mapping model.

Fields:

* id
* device
* device_user_id
* employee_code
* employee_name
* is_active
* created_at
* updated_at

Unique constraint:

(device, device_user_id)

Do not assume the ZKTeco device user ID is the Django user ID.

Create an AttendanceEvent model.

Fields:

* id
* device
* device_user_id
* punch_datetime
* status
* verify_mode
* work_code
* raw_payload
* source_ip
* received_at
* event_hash
* created_at

event_hash must be unique.

Create indexes on:

* device + punch_datetime
* device_user_id + punch_datetime
* event_hash

---

## 6. ATTLOG parser

Parse tab-separated ATTLOG records.

The known field positions are:

field 0 = user ID
field 1 = timestamp
field 2 = status
field 3 = verification mode
field 4 = work code

There may be additional fields.

Do not reject a record merely because it contains additional fields.

Preserve the original ATTLOG line in raw_payload.

Use:

timestamp format:

%Y-%m-%d %H:%M:%S

Do not guess meanings for fields beyond those already established.

Keep status and verify_mode as integers initially.

Do not convert them into check-in/check-out/fingerprint/card labels until explicit mappings have been verified against the target device.

---

## 7. ATTLOG example

Given:

1<TAB>2026-09-17 13:22:40<TAB>0<TAB>2<TAB>0<TAB>0<TAB>0<TAB>0<TAB>0<TAB>0

produce:

device_user_id = "1"
punch_datetime = 2026-09-17 13:22:40
status = 0
verify_mode = 2
work_code = 0

Keep the complete original line in raw_payload.

---

## 8. Idempotency

The ZKTeco device may resend attendance records.

Do not blindly create a new AttendanceEvent for every POST.

Create a deterministic SHA-256 event hash from:

device serial number
user ID
timestamp
status
verify mode
work code

Example:

SHA256(
serial_number
+ "|"
+ user_id
+ "|"
+ timestamp
+ "|"
+ status
+ "|"
+ verify_mode
+ "|"
+ work_code
)

Use the database unique constraint on event_hash.

Repeated identical events must not create duplicates.

The API should still return a successful ADMS response to the device when a duplicate is received.

---

## 9. ADMS /iclock/cdata handling

For GET /iclock/cdata:

* identify the device using SN query parameter
* update last_seen_at
* return a valid ADMS configuration response
* do not require Django authentication
* do not apply normal browser CSRF requirements

For POST /iclock/cdata:

Read query parameters:

SN
table
Stamp / OpStamp when present

Supported table values:

ATTLOG
OPERLOG
USERINFO if later required

For ATTLOG:

* parse attendance
* persist AttendanceEvent
* update Device.last_attendance_at
* update Device.last_seen_at
* return successful ADMS acknowledgement

For OPERLOG:

* acknowledge the request
* do not persist biometric fingerprint templates
* do not log TMP fields
* optionally store only safe operational metadata

For unknown tables:

* log a safe warning
* return a protocol-compatible successful response unless the protocol specifically requires an error

---

## 10. Security requirement for OPERLOG

The K45 has already been observed sending:

FP PIN=2
FID=6
Size=1240
Valid=1
TMP=...

TMP represents biometric template data.

Never:

* store TMP
* print TMP in application logs
* return TMP through APIs
* expose TMP to React
* put TMP into exception traces

If raw payload storage is required for debugging, redact biometric fields first.

Example:

FP PIN=2 FID=6 Size=1240 Valid=1 TMP=[REDACTED]

Prefer not storing OPERLOG raw bodies at all in production.

---

## 11. /iclock/getrequest

Implement:

GET /iclock/getrequest

Read:

SN
INFO

Update Device.last_seen_at.

Initially return no pending commands.

Do not implement device-management commands until attendance ingestion is stable.

The architecture should allow future command queue support.

Potential future commands include:

* user update
* user delete
* attendance query
* device information

But these are OUT OF SCOPE for version 1.

---

## 12. /iclock/devicecmd

Implement a basic endpoint that:

* accepts POST
* identifies device using SN where available
* records safe command execution metadata
* updates last_seen_at
* returns a protocol-compatible response

Do not execute arbitrary shell commands or accept arbitrary device commands from users.

---

## 13. Device registration

Automatically register/update a device when a valid SN is received.

Do not automatically trust arbitrary Internet requests.

For production, require the SN to belong to a pre-provisioned Device record OR place unknown devices into a pending state.

Preferred behavior:

Known serial:
accept and process.

Unknown serial:
record a safe connection attempt and do not persist attendance until the device is approved.

---

## 14. Device authentication

The K45 ADMS protocol does not use normal Django JWT authentication.

Create a dedicated ADMS authentication layer.

At minimum:

* HTTPS in production
* registered device serial number
* optional allowed source IP / network restriction if practical
* device activation flag

Do not expose normal application JWT/session authentication requirements on /iclock/* endpoints.

If a device secret/token can be configured and supported by the firmware, support an optional device secret.

Do not invent unsupported authentication parameters.

---

## 15. Normal application API

Separately expose authenticated APIs such as:

GET /api/attendance/
GET /api/attendance/{id}/
GET /api/devices/
GET /api/devices/{id}/
GET /api/employees/

Use Django REST Framework authentication for these APIs.

Do not apply this authentication mechanism to ADMS device endpoints.

---

## 16. Admin interface

Register:

Device
Employee mapping
AttendanceEvent

in Django admin.

Admin should show:

Device serial
User ID
Punch datetime
Status
Verify mode
Work code
Received at

Do not show biometric template data.

---

## 17. Time zone

The attendance payload does not contain a timezone.

Configure Django timezone explicitly.

For the current deployment use:

Asia/Kolkata

Store timestamps consistently.

Prefer timezone-aware Python datetime objects.

Do not silently interpret a device timestamp as UTC.

---

## 18. Logging

Use structured application logging.

Safe example:

INFO
ADMS ATTLOG received
device=WED3253601172
user=1
timestamp=2026-09-17T13:22:40
verify_mode=2
status=0

Do NOT log:

* fingerprint templates
* passwords
* card secrets
* raw biometric payloads

Do not dump every HTTP body in production.

---

## 19. Error handling

A malformed attendance record must not crash the Django worker.

Handle:

* missing SN
* unknown device
* malformed timestamp
* insufficient ATTLOG fields
* invalid integer fields
* duplicate event
* database failure

Log enough information for troubleshooting but redact sensitive data.

For temporary database failure, return an appropriate HTTP/protocol response so the device can retry where the protocol supports it.

Do not falsely acknowledge an attendance record if it could not be persisted unless the behavior is explicitly designed and documented.

---

## 20. Local development

First support:

Mac:
192.168.1.27

K45:
192.168.1.201

ADMS:
HTTP port 8080

Device configuration:

Server mode:
ADMS

Enable Domain Name:
OFF

Server address:
192.168.1.27

Server port:
8080

Proxy:
OFF

The local Django server should be reachable from the K45.

Use Django only for application testing; do not use Django runserver in production.

---

## 21. Production AWS architecture

Production environment:

AWS EC2

Recommended starting configuration:

2 vCPU
4 GB RAM
30+ GB gp3 EBS

A 2 GB instance can be used for a very small workload, but 4 GB is preferred if Django, Gunicorn, PostgreSQL, Nginx and other services share the instance.

Do not use RDS.

PostgreSQL must run on the same EC2 instance.

PostgreSQL must listen only on localhost/private interface.

Never expose port 5432 to the Internet.

---

## 22. Production network

Public:

80
443

Private:

127.0.0.1:8001 Django/Gunicorn
127.0.0.1:5432 PostgreSQL

Security Group:

22:
only administrator's fixed IP if possible

80:
0.0.0.0/0

443:
0.0.0.0/0

5432:
no public access

8001:
no public access

8080:
no public access

---

## 23. Production DNS

Use:

attendance.<your-domain>

DNS should point to the EC2 Elastic IP.

K45 production configuration should use:

Server mode:
ADMS

Enable Domain Name:
ON

Server address:
attendance.<your-domain>

Server port:
443

Proxy:
OFF

HTTPS:
enabled if the K45 firmware exposes the HTTPS setting.

Do not configure /iclock/cdata in the device server address.

The firmware automatically calls:

/iclock/cdata
/iclock/getrequest
/iclock/devicecmd

---

## 24. Nginx

Configure:

HTTPS :443
↓
proxy_pass http://127.0.0.1:8001

HTTP :80
↓
redirect to HTTPS

Forward:

Host
X-Real-IP
X-Forwarded-For
X-Forwarded-Proto

Set a reasonable client_max_body_size.

Do not expose Gunicorn directly to the Internet.

---

## 25. Gunicorn

Run Django using Gunicorn.

Initial configuration for a small 4 GB EC2:

2 workers

Bind:

127.0.0.1:8001

Use a systemd service or Docker restart policy.

Do not use Django runserver in production.

---

## 26. PostgreSQL

Use PostgreSQL 17.

Database:

attendance_db

User:

attendance_app

Do not use the postgres superuser from Django.

Grant only the permissions required by the Django database.

Configure:

DB_HOST=127.0.0.1
DB_PORT=5432

Use environment variables/secrets rather than hard-coding credentials.

---

## 27. Environment variables

Create:

DJANGO_SECRET_KEY
DJANGO_DEBUG
DJANGO_ALLOWED_HOSTS
DJANGO_CSRF_TRUSTED_ORIGINS
DATABASE_NAME
DATABASE_USER
DATABASE_PASSWORD
DATABASE_HOST
DATABASE_PORT
ADMS_ALLOWED_DEVICES
DJANGO_TIME_ZONE

Never commit production secrets to Git.

---

## 28. HTTPS

Use Let's Encrypt/Certbot or an equivalent trusted certificate.

Production traffic:

K45
↓
HTTPS 443
↓
Nginx
↓
Gunicorn
↓
Django

Do not expose plain HTTP ADMS over the public Internet.

---

## 29. Database backup

Because PostgreSQL is on EC2 rather than RDS, implement backups.

At minimum:

daily PostgreSQL logical backup using pg_dump

Store backups outside the instance, preferably S3.

Do not rely only on EBS snapshots.

Add retention, e.g.:

7 daily
4 weekly
3 monthly

Make backup restoration testable.

---

## 30. Monitoring

Track:

* Django/Gunicorn errors
* Nginx errors
* PostgreSQL health
* EC2 disk usage
* EC2 memory usage
* ADMS requests
* last_seen_at for every device
* last_attendance_at for every device
* failed attendance parsing
* unknown device serials

Add a health endpoint:

GET /health/

Return application/database health.

---

## 31. Device health

Expose:

Device serial
IP address
last_seen_at
last_attendance_at
firmware
active/inactive

A device should be considered potentially offline if:

now - last_seen_at > configured threshold

Do not hard-code an aggressive threshold because ADMS polling intervals can vary.

---

## 32. Tests

Create automated tests for:

1. GET /iclock/cdata
2. GET /iclock/getrequest
3. POST ATTLOG
4. POST multiple ATTLOG lines
5. duplicate ATTLOG
6. malformed ATTLOG
7. unknown device
8. OPERLOG
9. OPERLOG containing TMP
10. device last_seen update
11. attendance last_seen update
12. timezone conversion
13. database failure
14. event hash generation

Use the exact real payload captured from the K45 Pro as a fixture.

Real fixture:

1<TAB>2026-09-17 13:22:40<TAB>0<TAB>2<TAB>0<TAB>0<TAB>0<TAB>0<TAB>0<TAB>0

Also test:

2<TAB>2026-09-17 13:23:32<TAB>0<TAB>1<TAB>0<TAB>0<TAB>0<TAB>0<TAB>0<TAB>0

---

## 33. Important protocol behavior

Do not assume all K45 devices behave identically.

The target device has already demonstrated:

* /iclock/getrequest
* /iclock/cdata
* ATTLOG
* OPERLOG
* fingerprint template transfer
* repeated real-time attendance POSTs

Treat the captured K45 traffic as the primary compatibility test.

Do not introduce undocumented ZKTeco commands unless explicitly required.

---

## 34. Version 1 scope

Version 1 MUST provide:

* ADMS connectivity
* device registration
* real-time attendance ingestion
* ATTLOG parser
* duplicate prevention
* PostgreSQL persistence
* Django admin
* authenticated attendance read APIs
* device health
* structured logging
* HTTPS production support
* tests
* Docker deployment support
* Gunicorn
* Nginx configuration
* PostgreSQL backup documentation

Version 1 MUST NOT include:

* fingerprint template management
* fingerprint template storage
* remote fingerprint enrollment
* remote device shell commands
* user provisioning
* arbitrary device commands
* face-template storage
* card-template storage

Those can be considered later only if explicitly required.

---

## 35. Deliverables

Produce:

1. Django attendance app
2. Models
3. ADMS parser
4. ADMS views
5. URL configuration
6. Database migrations
7. Django admin
8. REST APIs
9. Tests
10. Dockerfile
11. docker-compose.yml for local development
12. Gunicorn configuration
13. Nginx configuration
14. PostgreSQL configuration guidance
15. .env.example
16. AWS EC2 deployment guide
17. systemd alternative if Docker is not used
18. backup script
19. health-check endpoint
20. README with local K45 setup

Before considering the implementation complete, demonstrate that this exact K45 payload is accepted and persisted:

1<TAB>2026-09-17 13:22:40<TAB>0<TAB>2<TAB>0<TAB>0<TAB>0<TAB>0<TAB>0<TAB>0

and that a duplicate submission does not create a second AttendanceEvent.
