-- Phase 8b: mileage log, equipment register, simplified home office and
-- vehicle (Part IV) settings. Additive: new nullable columns and new tables.
-- AlterTable
ALTER TABLE "TaxYearSetting" ADD COLUMN     "home_office_months" INTEGER,
ADD COLUMN     "home_office_sq_ft" INTEGER,
ADD COLUMN     "home_total_sq_ft" INTEGER,
ADD COLUMN     "vehicle_commuting_miles" DECIMAL(12,1),
ADD COLUMN     "vehicle_in_service" TIMESTAMP(3),
ADD COLUMN     "vehicle_other_miles" DECIMAL(12,1);

-- CreateTable
CREATE TABLE "TaxMileageTrip" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "miles" DECIMAL(10,1) NOT NULL,
    "destination" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "parking_tolls" DECIMAL(19,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxMileageTrip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxAsset" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "placed_in_service" TIMESTAMP(3) NOT NULL,
    "cost" DECIMAL(19,2) NOT NULL,
    "business_percent" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "recovery_years" INTEGER,
    "disposed_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaxMileageTrip_user_id_date_idx" ON "TaxMileageTrip"("user_id", "date");

-- CreateIndex
CREATE INDEX "TaxAsset_user_id_idx" ON "TaxAsset"("user_id");

-- AddForeignKey
ALTER TABLE "TaxMileageTrip" ADD CONSTRAINT "TaxMileageTrip_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxAsset" ADD CONSTRAINT "TaxAsset_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

