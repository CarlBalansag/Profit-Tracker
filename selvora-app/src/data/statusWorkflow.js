// Frontend-facing half of the status-workflow vocabulary.
//
// `selvora-api/services/statusTransitions.js` is the single source of truth for
// statuses, display labels and allowed actions, but it is a CommonJS module that
// lives outside this Vite app's module graph, so the browser cannot import it.
// The API already ships the per-record action descriptors (`allowed_actions`,
// which carry their own labels), so the only thing that has to be restated here
// is the stored-status -> label map plus the purely presentational icon/colour
// choices the API has no business knowing about.
//
// DRIFT GUARD: statusWorkflow.test.js reads the registry file and asserts that
// DISPLAY_LABELS below matches its DISPLAY_LABELS exactly, so a rename on the
// server fails the frontend suite instead of silently showing a raw constant.
// Checkpoint 4/5 should remove the duplication by having the API send a
// `status_label` with each record; until then the guard test is the contract.

import {
  ShoppingCart, ShoppingBag, Truck, Package, ScanLine, CircleCheck, CheckCircle2,
  Clock, ShieldCheck, Store, Banknote, AlertTriangle, RotateCcw, Layers,
} from 'lucide-react';

export const INVENTORY_RECEIVING_STATUSES = ['PRE_ORDER', 'PURCHASED', 'INBOUND', 'ON_HAND'];

export const SALE_STATUSES_BY_WORKFLOW = {
  STANDARD_MARKETPLACE: ['AWAITING_SHIPMENT', 'OUTBOUND', 'WAITING_FOR_PAYMENT', 'PAID'],
  AUTH_MARKETPLACE: ['AWAITING_SHIPMENT', 'OUTBOUND', 'DELIVERED_TO_AUTHENTICATOR', 'AUTHENTICATING', 'WAITING_FOR_PAYMENT', 'PAID'],
  CASHOUT: ['AWAITING_SHIPMENT', 'OUTBOUND', 'DELIVERED_TO_PROVIDER', 'WAITING_FOR_SCAN_IN', 'SCANNED_IN', 'ACCEPTED', 'WAITING_FOR_PAYMENT', 'PAID'],
  DIRECT_LOCAL: ['AWAITING_HANDOFF', 'HANDED_OVER', 'WAITING_FOR_PAYMENT', 'PAID'],
};

export const SALE_EXCEPTION_STATUSES = ['CANCELLED', 'RETURN_IN_PROGRESS', 'RETURNED', 'DISPUTED', 'AUTHENTICATION_FAILED'];

export const DEFAULT_SALE_WORKFLOW = 'STANDARD_MARKETPLACE';

// Mirrors statusTransitions.DISPLAY_LABELS (see the drift guard above).
export const DISPLAY_LABELS = {
  // Inventory receiving
  PRE_ORDER: 'Pre-order',
  PURCHASED: 'Purchased',
  INBOUND: 'Inbound',
  ON_HAND: 'On Hand',
  // Sale normal path
  AWAITING_SHIPMENT: 'Sold — Waiting to Ship',
  OUTBOUND: 'Outbound',
  DELIVERED_TO_AUTHENTICATOR: 'Delivered to Authenticator',
  AUTHENTICATING: 'Authenticating',
  DELIVERED_TO_PROVIDER: 'Delivered to Provider',
  WAITING_FOR_SCAN_IN: 'Waiting for Scan-In',
  SCANNED_IN: 'Scanned In',
  ACCEPTED: 'Accepted',
  AWAITING_HANDOFF: 'Awaiting Handoff',
  HANDED_OVER: 'Handed Over',
  WAITING_FOR_PAYMENT: 'Waiting for Payment',
  PAID: 'Paid',
  // Sale exceptions
  CANCELLED: 'Cancelled',
  RETURN_IN_PROGRESS: 'Return in Progress',
  RETURNED: 'Returned',
  DISPUTED: 'Disputed',
  AUTHENTICATION_FAILED: 'Authentication Failed',
};

export const displayLabel = (status) => DISPLAY_LABELS[status] || status || 'No status yet';

// qty_on_hand, not a stored status -- same rule as statusTransitions.availabilityLabel.
export const availabilityLabel = (inventory = {}) =>
  Number(inventory.qty_on_hand) > 0 ? 'Available' : 'Sold Out';

// Presentational only: which tile icon and accent colour a status gets.
export const STATUS_VISUALS = {
  PRE_ORDER: { icon: Clock, color: '#a78bfa' },
  PURCHASED: { icon: ShoppingBag, color: '#60a5fa' },
  INBOUND: { icon: Truck, color: '#facc15' },
  ON_HAND: { icon: Package, color: '#22c55e' },

  AWAITING_SHIPMENT: { icon: ShoppingCart, color: '#f97316' },
  AWAITING_HANDOFF: { icon: ShoppingCart, color: '#f97316' },
  OUTBOUND: { icon: Truck, color: '#38bdf8' },
  HANDED_OVER: { icon: CheckCircle2, color: '#38bdf8' },
  DELIVERED_TO_AUTHENTICATOR: { icon: ShieldCheck, color: '#818cf8' },
  AUTHENTICATING: { icon: ShieldCheck, color: '#818cf8' },
  DELIVERED_TO_PROVIDER: { icon: Store, color: '#818cf8' },
  WAITING_FOR_SCAN_IN: { icon: ScanLine, color: '#fbbf24' },
  SCANNED_IN: { icon: ScanLine, color: '#fbbf24' },
  ACCEPTED: { icon: CircleCheck, color: '#34d399' },
  WAITING_FOR_PAYMENT: { icon: Banknote, color: '#fbbf24' },
  PAID: { icon: CircleCheck, color: '#10b981' },

  AUTHENTICATION_FAILED: { icon: AlertTriangle, color: '#f87171' },
  RETURN_IN_PROGRESS: { icon: RotateCcw, color: '#fb923c' },
  RETURNED: { icon: RotateCcw, color: '#f87171' },
  DISPUTED: { icon: AlertTriangle, color: '#f87171' },
  CANCELLED: { icon: AlertTriangle, color: '#9ca3af' },
};

const FALLBACK_VISUAL = { icon: Layers, color: '#9ca3af' };

export const statusVisual = (status) => STATUS_VISUALS[status] || FALLBACK_VISUAL;

// Display order for a mixed pipeline strip: inventory receiving first, then the
// union of every sale workflow's forward path, then the exceptions.
const SALE_FORWARD_ORDER = [
  'AWAITING_SHIPMENT', 'AWAITING_HANDOFF', 'OUTBOUND', 'HANDED_OVER',
  'DELIVERED_TO_AUTHENTICATOR', 'AUTHENTICATING', 'DELIVERED_TO_PROVIDER',
  'WAITING_FOR_SCAN_IN', 'SCANNED_IN', 'ACCEPTED', 'WAITING_FOR_PAYMENT', 'PAID',
];

export const SALE_STATUS_ORDER = [...SALE_FORWARD_ORDER, ...SALE_EXCEPTION_STATUSES];

export const STATUS_ORDER = [...INVENTORY_RECEIVING_STATUSES, ...SALE_STATUS_ORDER];

// Every status a sale on `workflowType` may legitimately be corrected to.
export const correctableSaleStatuses = (workflowType) => {
  const path = SALE_STATUSES_BY_WORKFLOW[workflowType] || SALE_STATUSES_BY_WORKFLOW[DEFAULT_SALE_WORKFLOW];
  return [...path, ...SALE_EXCEPTION_STATUSES];
};
