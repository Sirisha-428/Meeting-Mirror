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
# mkcert Setup (Trusted HTTPS for Development)
 
Follow these steps to use mkcert and avoid the "Certificate Error" / `ERR_CERT_AUTHORITY_INVALID` in Teams.
 
The install step differs per operating system; the rest of the steps are the same everywhere.
 
---
 
## Step 1: Install mkcert
 
### Linux (Debian / Ubuntu)
 
```bash
sudo apt update
sudo apt install -y libnss3-tools mkcert
```
 
*(`libnss3-tools` is needed so mkcert can install its local CA into your system trust store.)*
 
> On Fedora/RHEL use `sudo dnf install nss-tools mkcert`. On Arch use `sudo pacman -S nss mkcert`.
> If your distro's package manager doesn't have `mkcert`, install it via Homebrew (below) or download the binary from https://github.com/FiloSottile/mkcert/releases.
 
### Windows
 
Using [Chocolatey](Chocolatey - The package manager for Windows) (run PowerShell as Administrator):
 
```powershell
choco install mkcert
```
 
Or using [Scoop](https://scoop.sh/):
 
```powershell
scoop bucket add extras
scoop install mkcert
```
 
*(No separate NSS/tools package is required on Windows — mkcert uses the Windows certificate store. If you use Firefox, also install `nss` so mkcert can trust certs there: `choco install nss`.)*
 
### macOS
 
Using [Homebrew](https://brew.sh/):
 
```bash
brew install mkcert
brew install nss   # only needed if you use Firefox
```
 
---
 
## Step 2: Install the local Certificate Authority
 
This adds mkcert's root CA to your system so browsers trust certs it issues. Same command on all platforms:
 
```bash
mkcert -install
```
 
> **Windows:** run this in the same PowerShell/terminal where mkcert is available. You may get a prompt to approve adding the root CA — accept it.
 
---
 
## Step 3: Generate certificates (used by frontend and backend)
 
From the project root:
 
### Linux / macOS
 
```bash
cd frontend
mkcert -key-file certs/localhost-key.pem -cert-file certs/localhost.pem localhost 127.0.0.1 ::1
```
 
### Windows (PowerShell)
 
```powershell
cd frontend
mkcert -key-file certs/localhost-key.pem -cert-file certs/localhost.pem localhost 127.0.0.1 ::1
```
 
*(If the `certs` folder doesn't exist yet, create it first: `mkdir certs`.)*
 
The backend will use these same certs for WSS support. Both frontend (HTTPS) and backend (WSS) must use TLS when running in Teams.
 
---
 
## Step 4: Start both servers with SSL
 
**Frontend** (all platforms):
 
```bash
cd frontend
npm run dev
```
 
**Backend (with WSS):**
 
```bash
cd backend
python run_dev.py
```
 
*Or run uvicorn manually:*
 
### Linux / macOS
 
```bash
uvicorn main:app --reload --port 8000 --ssl-certfile ../frontend/certs/localhost.pem --ssl-keyfile ../frontend/certs/localhost-key.pem
```
 
### Windows (PowerShell)
 
```powershell
uvicorn main:app --reload --port 8000 --ssl-certfile ..\frontend\certs\localhost.pem --ssl-keyfile ..\frontend\certs\localhost-key.pem
```
 
Vite and the backend will use the certs. You should see no certificate warnings, and the WebSocket will connect.
 
---
 
## Fallback
 
If the `frontend/certs/` directory is missing or empty, Vite falls back to the basic-ssl self-signed cert and you may still see certificate warnings.
 