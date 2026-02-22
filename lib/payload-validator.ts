import { z } from 'zod';

// This schema represents the *expected* shape of order.raw_payload coming
// from RetailCRM. It is intentionally permissive (passthrough) but lists all
// known keys. If a new `raw_payload` has completely unexpected properties we
// log a warning so that the schema can be updated.

const CustomerSchema = z
  .object({
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    companyName: z.string().optional(),
    nickName: z.string().optional(),
    name: z.string().optional(),
    type: z.string().optional(),
  })
  .passthrough();

const ContactPhoneSchema = z.object({ number: z.string().optional() }).passthrough();
const ContactSchema = z
  .object({
    name: z.string().optional(),
    phones: z.array(ContactPhoneSchema).optional(),
  })
  .passthrough();

const CustomFieldsSchema = z
  .object({
    tovarnaya_kategoriya: z.any().optional(),
    product_category: z.any().optional(),
    category: z.any().optional(),
    purchase_form: z.any().optional(),
    forma_zakupki: z.any().optional(),
    expected_amount: z.any().optional(),
    ozhidaemaya_summa: z.any().optional(),
    sphere_of_activity: z.any().optional(),
    sfera_deyatelnosti: z.any().optional(),
    // etc. Add new known custom fields here for documentation
  })
  .passthrough();

export const OrderPayloadSchema = z
  .object({
    company: z.object({ name: z.string().optional() }).passthrough().optional(),
    contact: ContactSchema.optional(),
    customer: CustomerSchema.optional(),
    phone: z.string().optional(),
    additionalPhone: z.string().optional(),
    email: z.string().optional(),
    customFields: CustomFieldsSchema.optional(),
    category: z.any().optional(),
    totalSumm: z.number().optional(),
    managerComment: z.string().optional(),
    customerComment: z.string().optional(),
  })
  .passthrough();

/**
 * Normalize a raw payload into a small bag of canonical values that the
 * evaluator can use without worrying about alternative key names.
 */
export function normalizeOrderPayload(raw: any) {
  const payload = OrderPayloadSchema.parse(raw || {});

  const buyerCandidates = [
    payload.company?.name,
    payload.contact?.name,
    payload.customer?.firstName,
    payload.customer?.lastName,
    payload.customer?.companyName,
    payload.customer?.nickName,
    payload.customer?.name,
    payload.customer?.type ? payload.customer.type : null,
  ];

  const normalized = {
    buyerExists: buyerCandidates.some(v => !!v),
    buyerType:
      payload.customer?.type === 'customer'
        ? 'customer'
        : payload.customer?.type === 'customer_corporate'
        ? 'corporate'
        : null,
    productCategory:
      payload.customFields?.tovarnaya_kategoriya ||
      payload.customFields?.product_category ||
      payload.customFields?.category ||
      payload.category ||
      // fallback: any custom field containing "kategori" or "катег" in its name
      (() => {
        if (payload.customFields && typeof payload.customFields === 'object') {
          for (const key of Object.keys(payload.customFields)) {
            const low = key.toLowerCase();
            if (low.includes('kategori') || low.includes('катег')) {
              return payload.customFields[key];
            }
          }
        }
        return null;
      })() ||
      null,
    contactDataExists:
      !!(payload.phone || payload.email || (payload.contact?.phones?.length > 0)),
    expectedAmount:
      payload.customFields?.expected_amount || payload.customFields?.ozhidaemaya_summa ||
      payload.totalSumm || null,
    purchaseForm:
      payload.customFields?.purchase_form || payload.customFields?.forma_zakupki || null,
    sphere:
      payload.customFields?.sphere_of_activity ||
      payload.customFields?.sfera_deyatelnosti ||
      null,
    // keep original for any further custom checks
    original: payload,
  };

  return normalized;
}

/**
 * Run the schema in 'strict' mode to detect totally unknown keys and log them.
 * This function is useful during development/QA to alert about payload drift.
 */
export function validateOrderPayload(raw: any) {
  try {
    OrderPayloadSchema.strict().parse(raw || {});
  } catch (e: any) {
    console.warn('[Payload Validator] unexpected structure:', e.errors || e.message);
    // don't throw – just warn so the app continues working
  }
}
