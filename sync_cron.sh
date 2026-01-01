#!/bin/bash

# Base URL for local Next.js server
BASE_URL="http://localhost:3000"

# Current Timestamp for logging
NOW=$(date +"%Y-%m-%d %H:%M:%S")

echo "[$NOW] Starting Sync..."

# 1. Sync RetailCRM (Incremental/Partial)
# No 'force' param ensures it continues from where it left off (pagination)
echo "Syncing RetailCRM..."
curl -s "$BASE_URL/api/sync/retailcrm" > /dev/null

# 2. Sync Telphin
echo "Syncing Telphin..."
curl -s "$BASE_URL/api/sync/telphin" > /dev/null

# 3. Runs Matcher
echo "Running Matcher..."
curl -s "$BASE_URL/api/match" > /dev/null

echo "[$NOW] Sync Cycle Complete."
