/**
 * Request/response validation using zod. Schemas are shared by the API
 * layer so validation errors produce structured 400 responses.
 */

import { z } from 'zod';

const uuid = z.string().uuid();
const isoDate = z.string().datetime();

export const InboundWebhookSchema = z.object({
  eventId: z.string().min(1),
  connectorId: z.string().min(1),
  eventType: z.string().min(1),
  timestamp: isoDate.optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export const BatchIngestSchema = z.object({
  connectorId: z.string().min(1),
  batchId: z.string().min(1),
  records: z.array(z.record(z.string(), z.unknown())).min(1, 'records must not be empty'),
});

export const OutboundPushSchema = z.object({
  connectorId: z.string().min(1),
  resourceType: z.enum(['voucher', 'master', 'irn', 'ewb']),
  payload: z.record(z.string(), z.unknown()).refine((o) => Object.keys(o).length > 0, 'payload must not be empty'),
  idempotencyKey: z.string().min(1),
});

export const BatchPushSchema = z.object({
  connectorId: z.string().min(1),
  items: z.array(OutboundPushSchema).min(1, 'items must not be empty'),
});

export type InboundWebhookInput = z.infer<typeof InboundWebhookSchema>;
export type BatchIngestInput = z.infer<typeof BatchIngestSchema>;
export type OutboundPushInput = z.infer<typeof OutboundPushSchema>;
export type BatchPushInput = z.infer<typeof BatchPushSchema>;

export function validateInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    throw new Error(JSON.stringify({ code: 'VALIDATION_ERROR', message: 'Invalid payload', details }));
  }
  return result.data;
}




