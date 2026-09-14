-- AlterTable
ALTER TABLE "User" ADD COLUMN     "login_disabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "FirebaseIdentity" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "firebase_uid" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,

    CONSTRAINT "FirebaseIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FirebaseSession" (
    "fingerprint" TEXT NOT NULL,
    "identity_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "FirebaseSession_pkey" PRIMARY KEY ("fingerprint")
);

-- CreateTable
CREATE TABLE "AuthIntent" (
    "id" TEXT NOT NULL,
    "proof_hash" TEXT NOT NULL,
    "session_hash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "user_id" TEXT,
    "credential_version" INTEGER,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AuthIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MigrationApproval" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "firebase_uid" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "MigrationApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthAttemptBucket" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthAttemptBucket_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "FirebaseIdentity_user_id_key" ON "FirebaseIdentity"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "FirebaseIdentity_project_id_firebase_uid_key" ON "FirebaseIdentity"("project_id", "firebase_uid");

-- CreateIndex
CREATE INDEX "FirebaseSession_expires_at_idx" ON "FirebaseSession"("expires_at");

-- CreateIndex
CREATE INDEX "AuthIntent_expires_at_idx" ON "AuthIntent"("expires_at");

-- CreateIndex
CREATE INDEX "MigrationApproval_user_id_project_id_firebase_uid_idx" ON "MigrationApproval"("user_id", "project_id", "firebase_uid");

-- CreateIndex
CREATE INDEX "AuthAttemptBucket_expires_at_idx" ON "AuthAttemptBucket"("expires_at");

-- AddForeignKey
ALTER TABLE "FirebaseIdentity" ADD CONSTRAINT "FirebaseIdentity_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FirebaseSession" ADD CONSTRAINT "FirebaseSession_identity_id_fkey" FOREIGN KEY ("identity_id") REFERENCES "FirebaseIdentity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
