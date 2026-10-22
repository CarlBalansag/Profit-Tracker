-- Additive only: no column dropped, renamed, or made non-nullable. Existing
-- reads/writes against Inventory, Sales, and PaymentMethod keep working
-- unchanged.

-- AlterTable
ALTER TABLE "Inventory" ADD COLUMN     "carrier" TEXT;

-- AlterTable
ALTER TABLE "Sales" ADD COLUMN     "carrier" TEXT;

-- AlterTable
ALTER TABLE "PaymentMethod" ADD COLUMN     "last4" TEXT;
