# mkcert Setup (Trusted HTTPS for Development)

Follow these steps to use mkcert and avoid the "Certificate Error" / `ERR_CERT_AUTHORITY_INVALID` in Teams.

---

## Step 1: Install mkcert

```bash
sudo apt update
sudo apt install -y libnss3-tools mkcert
```

*(`libnss3-tools` is needed so mkcert can install its local CA into your system trust store.)*

---

## Step 2: Install the local Certificate Authority

This adds mkcert’s root CA to your system so browsers trust certs it issues:

```bash
mkcert -install
```

---

## Step 3: Generate certificates (used by frontend and backend)

From the project root:

```bash
cd frontend
mkcert -key-file certs/localhost-key.pem -cert-file certs/localhost.pem localhost 127.0.0.1 ::1
```

The backend will use these same certs for WSS support. Both frontend (HTTPS) and backend (WSS) must use TLS when running in Teams.

---

## Step 4: Start both servers with SSL

**Frontend:**
```bash
cd frontend
npm run dev
```

**Backend (with WSS):**
```bash
cd backend
python run_dev.py
```
*Or:* `uvicorn main:app --reload --port 8000 --ssl-certfile ../frontend/certs/localhost.pem --ssl-keyfile ../frontend/certs/localhost-key.pem`

Vite and the backend will use the certs. You should see no certificate warnings, and the WebSocket will connect.

---

## Fallback

If the `frontend/certs/` directory is missing or empty, Vite falls back to the basic-ssl self-signed cert and you may still see certificate warnings.
