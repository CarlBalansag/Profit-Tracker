-- CreateTable
CREATE TABLE "EmailAccount" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "preset" TEXT NOT NULL,
    "email_address" TEXT NOT NULL,
    "imap_host" TEXT,
    "imap_port" INTEGER,
    "imap_username" TEXT,
    "encrypted_secret" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "last_error" TEXT,
    "sync_since" TIMESTAMP(3) NOT NULL,
    "include_spam" BOOLEAN NOT NULL DEFAULT false,
    "last_synced_at" TIMESTAMP(3),
    "sync_started_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailFolderCursor" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "folder" TEXT NOT NULL,
    "uid_validity" TEXT,
    "last_uid" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailFolderCursor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailMessage" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "message_id" TEXT,
    "folder" TEXT NOT NULL,
    "uid" INTEGER NOT NULL,
    "from_address" TEXT NOT NULL,
    "from_name" TEXT,
    "subject" TEXT,
    "sent_at" TIMESTAMP(3),
    "merchant" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmailAccount_status_idx" ON "EmailAccount"("status");

-- CreateIndex
CREATE UNIQUE INDEX "EmailAccount_user_id_email_address_key" ON "EmailAccount"("user_id", "email_address");

-- CreateIndex
CREATE UNIQUE INDEX "EmailFolderCursor_account_id_folder_key" ON "EmailFolderCursor"("account_id", "folder");

-- CreateIndex
CREATE INDEX "EmailMessage_user_id_sent_at_idx" ON "EmailMessage"("user_id", "sent_at");

-- CreateIndex
CREATE INDEX "EmailMessage_account_id_idx" ON "EmailMessage"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "EmailMessage_user_id_dedupe_key_key" ON "EmailMessage"("user_id", "dedupe_key");

-- AddForeignKey
ALTER TABLE "EmailAccount" ADD CONSTRAINT "EmailAccount_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailFolderCursor" ADD CONSTRAINT "EmailFolderCursor_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "EmailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "EmailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

