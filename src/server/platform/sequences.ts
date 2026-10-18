import { sql } from "drizzle-orm";
import type { Tx } from "../db/client";

const PREFIX = {
  stock_document: "MOV",
  purchase_order: "OC",
  goods_receipt: "REC",
  sale: "VEN",
  sale_return: "DEV",
} as const;
export type SequenceKey = keyof typeof PREFIX;

/**
 * Numeración consecutiva por empresa y tipo. El UPSERT bloquea la fila del contador hasta el fin de la
 * transacción, así que dos transacciones concurrentes nunca obtienen el mismo número.
 */
export async function nextNumber(tx: Tx, organizationId: string, key: SequenceKey): Promise<string> {
  const result = await tx.execute<{ value: string }>(sql`
    insert into document_sequences (organization_id, key, next_value) values (${organizationId}, ${key}, 2)
    on conflict (organization_id, key) do update set next_value = document_sequences.next_value + 1
    returning next_value - 1 as value`);
  const value = Number(result.rows[0]?.value);
  return `${PREFIX[key]}-${String(value).padStart(6, "0")}`;
}
