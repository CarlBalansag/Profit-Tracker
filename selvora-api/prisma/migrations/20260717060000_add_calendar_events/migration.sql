-- AlterTable: add calendar_token to User
ALTER TABLE "User" ADD COLUMN "calendar_token" TEXT;
CREATE UNIQUE INDEX "User_calendar_token_key" ON "User"("calendar_token");

-- CreateTable: CalendarEvent
CREATE TABLE "CalendarEvent" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "end_date" TEXT,
    "type" TEXT NOT NULL DEFAULT 'manual',
    "color" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CalendarEvent_user_id_idx" ON "CalendarEvent"("user_id");
CREATE INDEX "CalendarEvent_user_id_date_idx" ON "CalendarEvent"("user_id", "date");

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
