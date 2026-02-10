#!/bin/bash

# Configuration
API_URL="http://localhost:3000/api/sync"

echo "[$(date)] Starting Sync Cron Job..."

# 1. Sync Statuses (Foundation)
echo "Syncing Statuses..."
curl -s "$API_URL/statuses" > /dev/null

# 2. Sync Managers (Dependencies)
echo "Syncing Managers..."
curl -s "$API_URL/managers" > /dev/null

# 3. Sync Full History (The Heavy Lifting)
echo "Syncing Order History..."
curl -s "$API_URL/history" > /dev/null

# 4. Apply RetailCRM Orders Backfill (Batched)
echo "Syncing RetailCRM Orders (Backfill)..."
curl -s "$API_URL/retailcrm" > /dev/null

# 5. Sync Clients (New)
echo "Syncing Clients..."
curl -s "$API_URL/retailcrm/clients" > /dev/null

# 6. Telphin Calls (Communication)
echo "Syncing Calls..."
curl -s "http://localhost:3000/api/sync/telphin" > /dev/null

# 7. Matching & AI Audit (The Intelligence)
echo "Matching Calls to Orders & Triggering AI..."
curl -s "http://localhost:3000/api/match" > /dev/null

echo "Processing AMD Stragglers..."
curl -s "http://localhost:3000/api/analysis/amd/process?limit=10" > /dev/null

echo "[$(date)] Sync Completed."
