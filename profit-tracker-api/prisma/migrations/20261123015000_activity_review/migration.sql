-- Email automation review: an automatic change the user confirmed or rejected.
ALTER TABLE "ActivityLog" ADD COLUMN "review_state" TEXT;
ALTER TABLE "ActivityLog" ADD COLUMN "reviewed_at" TIMESTAMP(3);
CREATE INDEX "ActivityLog_user_id_source_review_state_idx" ON "ActivityLog"("user_id", "source", "review_state");
