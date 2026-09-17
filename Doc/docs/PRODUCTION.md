# Production checklist — hardware attendance

Use the **same** Django app, Gunicorn, and Postgres as the rest of MT-IMS. No separate attendance database.

## 1. Deploy code + migrate

```bash
python manage.py migrate attendance
python manage.py migrate salary_book
```

Ensure `ATTENDANCE_AUTO_APPROVE_DEVICES` is **not** set (or `false`).

## 2. Nginx — expose `/iclock/` on the API host

Device ADMS must reach HTTPS on your API domain (or a dedicated host that proxies to the same Gunicorn).

Example location blocks (alongside existing `/api/`):

```nginx
location /iclock/ {
    proxy_pass http://127.0.0.1:8001;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 5m;
}

location /health/ {
    proxy_pass http://127.0.0.1:8001;
    proxy_set_header Host $host;
}
```

Use HTTPS (443). Do not expose Gunicorn or Postgres publicly. Do not open port 8080 on the security group.

## 3. Provision the device

1. Django admin → **Devices**: create/approve serial `WED3253601172` (Active + `is_active`).
2. Admin → **Device user mappings**: map each device PIN → `EMP-xxx`.
3. Salary Book settings → Capture mode **Hardware**.

## 4. K45 ADMS settings (production)

- Server mode: ADMS  
- Enable Domain Name: ON (if using a hostname)  
- Server address: your API hostname (no `/iclock` path)  
- Server port: 443  
- Proxy: OFF  

## 5. Verify

```bash
curl -s https://<api-host>/health/
# After a punch, check Django admin → Attendance events
# and Salary Book attendance for the mapped employee
```

## Out of scope for this deploy

- Separate `attendance_db` / RDS  
- Fingerprint template sync / remote enroll  
- Dedicated `attendance.` subdomain (optional later)
