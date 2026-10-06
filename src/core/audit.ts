import type { Tx } from './db/client.js';
import { repo } from './db/repository.js';

/** One audit_log row, in the caller's transaction — if the change rolls back, so does its record. */
export async function recordAudit(
  tx: Tx, action: string, entityTable: string, entityId: string, changes?: unknown,
): Promise<void> {
  await repo(tx, 'audit_log').insert({
    user_id: tx.context.userId,
    branch_id: tx.context.branchId,
    action,
    entity_table: entityTable,
    entity_id: entityId,
    changes: changes === undefined ? null : JSON.stringify(changes),
    request_id: tx.context.requestId,
    // Null for ordinary staff work; set when a support session is doing this.
    support_session_id: tx.context.support?.sessionId ?? null,
  });
}
