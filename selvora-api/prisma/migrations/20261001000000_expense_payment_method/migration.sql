-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "payment_method_id" TEXT;

-- AlterTable
ALTER TABLE "RecurringExpense" ADD COLUMN     "payment_method_id" TEXT;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "PaymentMethod"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringExpense" ADD CONSTRAINT "RecurringExpense_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "PaymentMethod"("id") ON DELETE SET NULL ON UPDATE CASCADE;
