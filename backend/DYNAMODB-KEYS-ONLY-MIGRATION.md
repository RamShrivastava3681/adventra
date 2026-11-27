# DynamoDB GSI storage reduction

The `adventra` table has two active GSIs with `ALL` projections. They are used
by the application, so do not remove either index or expire business records.
This migration keeps table records and replaces each full projection with a
`KEYS_ONLY` index. The backend hydrates the base-table rows with `BatchGetItem`
so existing model and API results remain complete.

## Trade-offs

- Index storage should fall, but the exact savings depend on index key and
  record sizes. The base table remains unchanged.
- GSI queries will be followed by base-table reads. This increases read
  requests and can increase latency and on-demand read charges.
- The new indexes temporarily coexist with the old ones, so storage and
  backfill charges can rise during migration.
- No business records are deleted. TTL remains disabled.

## Migration steps

1. Deploy the backend changes first with `DYNAMODB_GSI1_NAME=GSI1`,
   `DYNAMODB_GSI2_NAME=GSI2`, and `DYNAMODB_GSI_KEYS_ONLY=false` (or leave them
   unset). This preserves the current read behavior until the replacement
   indexes are ready.
2. From `backend`, run a read-only preflight:

   ```powershell
   npm run dynamodb:gsi-projection -- --create-replacements
   ```

3. If preflight identifies the expected table and index schemas, create the
   replacement indexes:

   ```powershell
   npm run dynamodb:gsi-projection -- --create-replacements --apply
   ```

   Wait for both `GSI1_KEYS` and `GSI2_KEYS` to become `ACTIVE`. The script
   creates and waits for one index at a time.
4. Set and deploy all three settings together:

   ```text
   DYNAMODB_GSI1_NAME=GSI1_KEYS
   DYNAMODB_GSI2_NAME=GSI2_KEYS
   DYNAMODB_GSI_KEYS_ONLY=true
   ```

   Smoke-test tenant-scoped lists, entity-wide lists, exports, and pagination.
   The existing indexes remain available for rollback at this point; revert
   the index names to `GSI1` and `GSI2` and set `DYNAMODB_GSI_KEYS_ONLY=false`
   if needed.
5. Only after the new indexes and application reads are verified, remove the
   old indexes:

   ```powershell
   npm run dynamodb:gsi-projection -- --delete-full-indexes --confirm-app-deployed --apply
   ```

6. Confirm the new indexes remain `ACTIVE` and compare their sizes with
   `npm exec -- tsx scripts/describe-dynamodb.ts` (or the AWS console). DynamoDB size metrics are
   approximate and may take time to reflect the completed migration.

The migration script defaults to a dry run. `--apply` is required for changes.
The deletion phase also requires `--confirm-app-deployed` and verifies both
replacement indexes before removing either old index.
