-- CreateTable
CREATE TABLE "ebay_price_cache" (
    "product_name" TEXT NOT NULL,
    "last_sold_price" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "fetched_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ebay_price_cache_pkey" PRIMARY KEY ("product_name")
);
