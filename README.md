# TeleBid Enterprise

Professional Bid & Tender Management System

---

## Requirements

- [Docker Desktop](https://www.docker.com/products/docker-desktop) — install this first

---

## How to Start

### Windows
1. Install Docker Desktop and make sure it is running
2. Double-click **START.bat**
3. Browser opens automatically → http://localhost:5173
4. Login: `admin` / `Admin@1234`

### Mac / Linux
1. Install Docker Desktop and make sure it is running
2. Open Terminal in this folder
3. Run: `./start.sh`
4. Browser opens automatically → http://localhost:5173
5. Login: `admin` / `Admin@1234`

---

## How to Stop

- **Windows:** Double-click **STOP.bat**
- **Mac/Linux:** Run `./stop.sh`

---

## How to Reset (wipes all data)

Only do this if you want to start completely fresh.

- **Windows:** Double-click **RESET.bat**
- **Mac/Linux:** Run `./reset.sh`

---

## Applying Updates

When you receive a new version ZIP:

1. Run **STOP.bat** (or `./stop.sh`)
2. Delete this folder
3. Extract the new ZIP
4. Run **START.bat** (or `./start.sh`)

> If you have important data you want to keep, ask before updating.

---

## URL

http://localhost:5173

Default login: `admin` / `Admin@1234`
