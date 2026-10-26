-- Add per-period target columns (nullable so existing rows are unaffected)
ALTER TABLE "Goal" ADD COLUMN IF NOT EXISTS "target_7d"  DOUBLE PRECISION;
ALTER TABLE "Goal" ADD COLUMN IF NOT EXISTS "target_30d" DOUBLE PRECISION;
ALTER TABLE "Goal" ADD COLUMN IF NOT EXISTS "target_ytd" DOUBLE PRECISION;

-- Drop old columns no longer used
ALTER TABLE "Goal" DROP COLUMN IF EXISTS "target";
ALTER TABLE "Goal" DROP COLUMN IF EXISTS "timeframe";
ALTER TABLE "Goal" DROP COLUMN IF EXISTS "label";
