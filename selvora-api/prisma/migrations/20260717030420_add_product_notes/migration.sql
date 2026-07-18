-- CreateTable
CREATE TABLE "ProductNote" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductNote_user_id_idx" ON "ProductNote"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "ProductNote_user_id_product_name_key" ON "ProductNote"("user_id", "product_name");

-- AddForeignKey
ALTER TABLE "ProductNote" ADD CONSTRAINT "ProductNote_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
