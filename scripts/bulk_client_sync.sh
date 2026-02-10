#!/bin/bash

# Configuration
# URL of the Vercel deployment (Production)
API_URL="https://okk-riteil-crm-aqwq.vercel.app/api/sync/retailcrm/clients"

# Start settings
DAYS=3650 # 10 years
START_PAGE=1
IGNORE_DB="true"

echo "Starting Full Corporate Clients Sync..."
echo "Lookback: $DAYS days"
echo "Target: $API_URL"

CURRENT_PAGE=$START_PAGE
HAS_MORE=true

while [ "$HAS_MORE" = true ]; do
  echo "----------------------------------------"
  echo "Fetching batch starting at page $CURRENT_PAGE..."
  
  # Call API and capture response
  # We use python3 to parse JSON because it's usually available on mac/linux
  RESPONSE=$(curl -s "$API_URL?days=$DAYS&ignore_db=$IGNORE_DB&start_page=$CURRENT_PAGE")
  
  # Check for curl errors
  if [ $? -ne 0 ]; then
     echo "Error: Curl request failed."
     sleep 5
     continue
  fi

  # Print summary of response (optional)
  echo "Response: $RESPONSE" | head -c 100
  echo "..."

  # Parse vars using python one-liner fallback or grep/sed if jq not available
  # Assuming simpler approach if jq missing: python or node
  
  # Let's use a simple node script inline to extract next_page and has_more
  eval $(echo "$RESPONSE" | node -e '
    const fs = require("fs"); 
    const chunks = []; 
    process.stdin.on("data", c => chunks.push(c));
    process.stdin.on("end", () => {
        try {
            const r = JSON.parse(Buffer.concat(chunks).toString());
            console.log(`HAS_MORE=${r.has_more}`);
            console.log(`NEXT_PAGE=${r.next_page}`);
            console.log(`FETCHED=${r.total_fetched}`);
        } catch(e) {
            console.log("HAS_MORE=false"); // Break loop on error
            console.error("Parse Error");
        }
    });
  ')

  echo "Fetched in this batch: $FETCHED"

  if [ "$HAS_MORE" = "true" ] && [ "$NEXT_PAGE" != "null" ] && [ "$NEXT_PAGE" != "" ]; then
      CURRENT_PAGE=$NEXT_PAGE
      echo "Moving to next batch: Page $CURRENT_PAGE"
      # Small sleep to be nice to Vercel/RetailCRM limits
      sleep 2
  else
      echo "Sync Complete or No More Pages."
      HAS_MORE=false
  fi
done

echo "Done."
