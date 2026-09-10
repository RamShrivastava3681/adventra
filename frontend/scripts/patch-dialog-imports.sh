#!/usr/bin/env bash
set -euo pipefail

files=(
  src/routes/app.purchases.tsx
  src/routes/app.proformas.tsx
  src/routes/app.grn.tsx
  src/routes/app.purchase-orders.tsx
  src/routes/app.inventory.tsx
  src/routes/app.debtors.tsx
  src/routes/app.suppliers.tsx
  src/routes/app.vendors.tsx
  src/routes/app.notes.tsx
  src/routes/app.expenses.tsx
  src/routes/app.crm.tsx
  src/routes/app.stock-allocation.tsx
  src/routes/app.sample-distribution.tsx
)

for f in "${files[@]}"; do
  if ! grep -q '@/components/dialog' "$f"; then
    awk '
      {
        print
        if (seen == 0 && /from "@\/components\//) {
          seen = 1
          print "import {"
          print "  Dialog,"
          print "  DialogWithStickyFooter,"
          print "  Field,"
          print "  inputBase,"
          print "  textareaBase,"
          print "  selectBase,"
          print "  TwoFieldGrid,"
          print "  InfoPanel,"
          print "} from \"@/components/dialog\";"
          print "import { LineHeaders, AddLineButton } from \"@/components/dialog/LineRow\";"
        }
      }
    ' "$f" > "$f.tmp" && mv "$f.tmp" "$f"
  fi
done
echo done
