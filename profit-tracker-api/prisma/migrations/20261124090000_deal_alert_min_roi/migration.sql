-- Deal alerts: an optional minimum ROI (profit as a percent of retail, with the
-- best card's rewards). NULL means no ROI minimum.
ALTER TABLE "NotificationSettings" ADD COLUMN "deal_min_roi" DECIMAL(7,2);
