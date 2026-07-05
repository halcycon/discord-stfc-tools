#!/bin/bash

# Script to load all D1 migration batches to the remote database

echo "🚀 Loading all D1 migration batches to remote database..."

# Get the number of batch files
BATCH_COUNT=$(ls -1 d1-migration-batch-*.sql | wc -l)
echo "📊 Found $BATCH_COUNT batch files to process"

# Load each batch file
LOADED=0
FAILED=0

for i in $(seq 2 $BATCH_COUNT); do
    echo "📝 Loading batch $i/$BATCH_COUNT..."
    
    if npx wrangler d1 execute stfc-officers --remote --file="d1-migration-batch-$i.sql" --yes; then
        LOADED=$((LOADED + 1))
        echo "✅ Batch $i loaded successfully"
    else
        FAILED=$((FAILED + 1))
        echo "❌ Batch $i failed to load"
    fi
    
    # Small delay to be respectful to the API
    sleep 2
done

echo ""
echo "🎉 Migration complete!"
echo "✅ Successfully loaded: $((LOADED + 1)) batches (including batch 1)"
echo "❌ Failed: $FAILED batches"
echo "📊 Total batches: $BATCH_COUNT"

# Query the database to confirm data is loaded
echo ""
echo "🔍 Verifying data in remote database..."
npx wrangler d1 execute stfc-officers --remote --command="SELECT COUNT(*) as officers_count FROM officers;"
npx wrangler d1 execute stfc-officers --remote --command="SELECT COUNT(*) as abilities_count FROM officer_abilities;"
npx wrangler d1 execute stfc-officers --remote --command="SELECT COUNT(*) as translations_count FROM officer_translations;"
