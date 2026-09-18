import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { DiscountType, PosCustomer, SearchResult } from '@/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CartLine {
  productId: string;
  name: string;
  sku: string;
  /** ProductUnit enum value (PCS, KG, GM, LTR, ML, BOX, PACK, DOZEN, BUNDLE). */
  unit: string;
  unitPrice: number;
  mrp: number;
  /** GstRate enum value (ZERO, FIVE, TWELVE, EIGHTEEN, TWENTYEIGHT). */
  gstRate: string;
  /** Stock seen when the line was added; null when the product is not stock-tracked. */
  stockSnapshot: number | null;
  quantity: number;
  /** Line discount 0-100. */
  discountPercent: number;
  /** ProductType enum value; SERVICE / DIGITAL lines are never stock-capped. */
  productType: string;
}

export interface CartDiscount {
  type: DiscountType;
  value: number;
  reason: string;
}

export interface HeldCart {
  id: string;
  label: string;
  createdAt: string;
  lines: CartLine[];
  customer: PosCustomer | null;
  discount: CartDiscount;
  notes: string;
}

export type QuantityResult = { ok: true; value: number } | { ok: false; reason: string };

export interface PosState {
  lines: CartLine[];
  customer: PosCustomer | null;
  discount: CartDiscount;
  notes: string;
  heldCarts: HeldCart[];
  idempotencyKey: string | null;

  addProduct: (product: SearchResult, quantity?: number) => QuantityResult;
  setQuantity: (productId: string, quantity: number) => QuantityResult;
  increment: (productId: string) => QuantityResult;
  decrement: (productId: string) => QuantityResult;
  setLineDiscount: (productId: string, percent: number) => void;
  removeLine: (productId: string) => void;
  clearCart: () => void;
  holdCart: (label: string) => HeldCart | null;
  resumeHeldCart: (id: string) => boolean;
  deleteHeldCart: (id: string) => void;
  setCustomer: (customer: PosCustomer | null) => void;
  setDiscount: (discount: Partial<CartDiscount>) => void;
  setNotes: (notes: string) => void;
  /** Rotates to a brand-new key (e.g. after IDEMPOTENCY_KEY_REUSED). */
  newIdempotencyKey: () => string;
  /** Returns the current key, generating one when there is none. */
  ensureIdempotencyKey: () => string;
  /** Clears the key after a successful submit; the hook generates a fresh one. */
  consumeIdempotencyKey: () => void;
}

// ---------------------------------------------------------------------------
// Quantity rules
// ---------------------------------------------------------------------------

/**
 * Units that are sold by weight / volume and therefore accept decimal
 * quantities. Source of truth: `enum ProductUnit` in apps/api/prisma/schema.prisma
 * (KG, GM, LTR, ML); the extra spellings are tolerated defensively.
 */
export const DECIMAL_UNITS: ReadonlySet<string> = new Set(['KG', 'GM', 'G', 'LTR', 'L', 'ML', 'MTR', 'M']);

/** Product types that never have their quantity capped by stock. */
const UNCAPPED_TYPES: ReadonlySet<string> = new Set(['SERVICE', 'DIGITAL']);

const MAX_DECIMALS = 3; // Prisma Decimal(10, 3)

export function allowsDecimalQuantity(unit: string): boolean {
  return DECIMAL_UNITS.has((unit || '').toUpperCase());
}

export function quantityStep(unit: string): number {
  return allowsDecimalQuantity(unit) ? 0.5 : 1;
}

export function isStockCapped(line: Pick<CartLine, 'productType' | 'stockSnapshot'>): boolean {
  return !UNCAPPED_TYPES.has((line.productType || 'SIMPLE').toUpperCase()) && line.stockSnapshot !== null;
}

export function validateQuantity(
  line: Pick<CartLine, 'unit' | 'productType' | 'stockSnapshot'>,
  quantity: number,
): QuantityResult {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { ok: false, reason: 'Quantity must be greater than 0' };
  }
  const decimalsAllowed = allowsDecimalQuantity(line.unit);
  if (!decimalsAllowed && !Number.isInteger(quantity)) {
    return { ok: false, reason: `Whole numbers only for ${line.unit || 'PCS'}` };
  }
  if (decimalsAllowed) {
    const rounded = Number(quantity.toFixed(MAX_DECIMALS));
    if (rounded !== quantity) {
      return { ok: false, reason: `Up to ${MAX_DECIMALS} decimal places allowed` };
    }
  }
  if (isStockCapped(line) && quantity > (line.stockSnapshot as number)) {
    return { ok: false, reason: `Only ${line.stockSnapshot} ${line.unit || ''} in stock`.trim() };
  }
  return { ok: true, value: quantity };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // RFC 4122 v4 fallback using getRandomValues when available, Math.random otherwise.
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const EMPTY_DISCOUNT: CartDiscount = { type: 'FIXED_AMOUNT', value: 0, reason: '' };

function lineFromProduct(product: SearchResult, quantity: number): CartLine {
  const type = (product.type || 'SIMPLE').toUpperCase();
  return {
    productId: product.id,
    name: product.name,
    sku: product.sku,
    unit: product.unit || 'PCS',
    unitPrice: product.sellingPrice,
    mrp: product.mrp,
    gstRate: product.gstRate || 'EIGHTEEN',
    stockSnapshot: UNCAPPED_TYPES.has(type) ? null : product.currentStock,
    quantity,
    discountPercent: 0,
    productType: type,
  };
}

const STORAGE_PREFIX = 'dukaanai-pos';

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const usePosStore = create<PosState>()(
  persist(
    (set, get) => ({
      lines: [],
      customer: null,
      discount: EMPTY_DISCOUNT,
      notes: '',
      heldCarts: [],
      idempotencyKey: null,

      addProduct: (product, quantity = 1) => {
        const existing = get().lines.find((l) => l.productId === product.id);
        if (existing) {
          const nextQty = existing.quantity + quantity;
          const check = validateQuantity(existing, nextQty);
          if (!check.ok) return check;
          set({ lines: get().lines.map((l) => (l.productId === product.id ? { ...l, quantity: check.value } : l)) });
          return check;
        }
        const line = lineFromProduct(product, quantity);
        const check = validateQuantity(line, quantity);
        if (!check.ok) return check;
        set({ lines: [...get().lines, { ...line, quantity: check.value }] });
        return check;
      },

      setQuantity: (productId, quantity) => {
        const line = get().lines.find((l) => l.productId === productId);
        if (!line) return { ok: false, reason: 'Line not found' };
        const check = validateQuantity(line, quantity);
        if (!check.ok) return check;
        set({ lines: get().lines.map((l) => (l.productId === productId ? { ...l, quantity: check.value } : l)) });
        return check;
      },

      increment: (productId) => {
        const line = get().lines.find((l) => l.productId === productId);
        if (!line) return { ok: false, reason: 'Line not found' };
        const step = quantityStep(line.unit);
        return get().setQuantity(productId, Number((line.quantity + step).toFixed(MAX_DECIMALS)));
      },

      decrement: (productId) => {
        const line = get().lines.find((l) => l.productId === productId);
        if (!line) return { ok: false, reason: 'Line not found' };
        const step = quantityStep(line.unit);
        const next = Number((line.quantity - step).toFixed(MAX_DECIMALS));
        if (next <= 0) {
          get().removeLine(productId);
          return { ok: true, value: 0 };
        }
        return get().setQuantity(productId, next);
      },

      setLineDiscount: (productId, percent) => {
        const clamped = Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0;
        set({
          lines: get().lines.map((l) => (l.productId === productId ? { ...l, discountPercent: clamped } : l)),
        });
      },

      removeLine: (productId) => set({ lines: get().lines.filter((l) => l.productId !== productId) }),

      clearCart: () => set({ lines: [], customer: null, discount: EMPTY_DISCOUNT, notes: '' }),

      holdCart: (label) => {
        const state = get();
        if (state.lines.length === 0) return null;
        const held: HeldCart = {
          id: generateUuid(),
          label: label.trim() || `Cart ${state.heldCarts.length + 1}`,
          createdAt: new Date().toISOString(),
          lines: state.lines,
          customer: state.customer,
          discount: state.discount,
          notes: state.notes,
        };
        set({
          heldCarts: [held, ...state.heldCarts],
          lines: [],
          customer: null,
          discount: EMPTY_DISCOUNT,
          notes: '',
        });
        return held;
      },

      resumeHeldCart: (id) => {
        const state = get();
        const held = state.heldCarts.find((h) => h.id === id);
        if (!held) return false;
        // Anything currently in the cart is preserved by holding it first.
        const remaining = state.heldCarts.filter((h) => h.id !== id);
        const parked: HeldCart[] =
          state.lines.length > 0
            ? [
                {
                  id: generateUuid(),
                  label: `Cart ${remaining.length + 1}`,
                  createdAt: new Date().toISOString(),
                  lines: state.lines,
                  customer: state.customer,
                  discount: state.discount,
                  notes: state.notes,
                },
              ]
            : [];
        set({
          heldCarts: [...parked, ...remaining],
          lines: held.lines,
          customer: held.customer,
          discount: held.discount,
          notes: held.notes,
        });
        return true;
      },

      deleteHeldCart: (id) => set({ heldCarts: get().heldCarts.filter((h) => h.id !== id) }),

      setCustomer: (customer) => set({ customer }),

      setDiscount: (discount) => set({ discount: { ...get().discount, ...discount } }),

      setNotes: (notes) => set({ notes }),

      newIdempotencyKey: () => {
        const key = generateUuid();
        set({ idempotencyKey: key });
        return key;
      },

      ensureIdempotencyKey: () => {
        const current = get().idempotencyKey;
        if (current) return current;
        return get().newIdempotencyKey();
      },

      consumeIdempotencyKey: () => set({ idempotencyKey: null }),
    }),
    {
      name: `${STORAGE_PREFIX}:anon`,
      storage: createJSONStorage(() => sessionStorage),
      // Rehydrated explicitly on the client (see `hydratePosStore`) to avoid
      // SSR/CSR markup mismatches in the app router.
      skipHydration: true,
      partialize: (state) => ({
        lines: state.lines,
        customer: state.customer,
        discount: state.discount,
        notes: state.notes,
        heldCarts: state.heldCarts,
        idempotencyKey: state.idempotencyKey,
      }),
    },
  ),
);

/** Rehydrates the default (per-tab) scope. Safe to call more than once. */
export function hydratePosStore(): void {
  if (typeof window === 'undefined') return;
  void usePosStore.persist.rehydrate();
}

/**
 * Switches persistence to a per-shop sessionStorage key and rehydrates from it,
 * so carts held for one shop never leak into another shop's session.
 */
export function scopePosStoreToShop(shopId: string): void {
  if (typeof window === 'undefined' || !shopId) return;
  const name = `${STORAGE_PREFIX}:${shopId}`;
  if (usePosStore.persist.getOptions().name === name) return;
  usePosStore.persist.setOptions({ name });
  void usePosStore.persist.rehydrate();
}
