#!/usr/bin/env python3
"""
Start the backend with HTTPS/WSS when mkcert certs exist.
Required when the frontend runs on HTTPS (Teams) — browsers block ws:// from https:// pages.
"""
import os
import sys
from pathlib import Path

# Cert paths: prefer backend/certs, then frontend/certs
ROOT = Path(__file__).resolve().parent.parent
CERT_DIRS = [
    ROOT / "backend" / "certs",
    ROOT / "frontend" / "certs",
]
CERT_FILE = "localhost.pem"
KEY_FILE = "localhost-key.pem"


def find_certs():
    for d in CERT_DIRS:
        cert = d / CERT_FILE
        key = d / KEY_FILE
        if cert.exists() and key.exists():
            return str(cert), str(key)
    return None, None


def main():
    cert, key = find_certs()
    if cert and key:
        print("Using mkcert certificates for HTTPS/WSS")
        os.execvp(
            "uvicorn",
            [
                "uvicorn",
                "main:app",
                "--reload",
                "--port", "8000",
                "--ssl-certfile", cert,
                "--ssl-keyfile", key,
            ],
        )
    else:
        print("No mkcert certs found. Run: cd frontend && mkcert -key-file certs/localhost-key.pem -cert-file certs/localhost.pem localhost 127.0.0.1")
        print("Falling back to HTTP (WebSocket may fail when frontend uses HTTPS).")
        os.execvp("uvicorn", ["uvicorn", "main:app", "--reload", "--port", "8000"])


if __name__ == "__main__":
    main()
