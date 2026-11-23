// The email sync's automatic actions: [setting key, label, what it does].
// Every automatic change is in Activity and on the Automation page, with Undo.
export const AUTOMATIONS = [
  ['linkMatches', 'Link sure matches without asking', 'Fills blank order and tracking numbers.'],
  ['updateShipping', 'Update purchases from shipping emails', 'Adds tracking and marks them delivered.'],
  ['cashoutPayouts', 'Mark cash-out sales paid from receipts', 'Paid to your cash-out balance. Adds tracking and serial numbers.'],
  ['returnReminders', 'Fill in return-by dates', "From the store's usual return window."],
  ['createPurchases', 'Add likely resale orders as purchases', 'Without asking, a day after the order. Personal ones are never added.'],
  ['cancellations', 'Cancel purchases the store cancelled', 'Off: you get a To-Do instead.'],
];
