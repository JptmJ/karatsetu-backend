/**
 * A thin helper over `tx.query` for the boring 80% — insert a row, update a
 * row, fetch by id — with tenant_id and the audit columns filled in for you.
 *
 * Anything interesting (joins, aggregates, reports) is written as plain SQL.
 * This is not an ORM and is not trying to become one.
 */
import type { QueryResultRow } from 'pg';
import type { Tx } from './client.js';
import { getTable } from './schema/registry.js';
import { quoteIdent } from './schema/sql.js';
import { newId } from '../util/id.js';
import { NotFoundError } from '../errors/app-error.js';

type Row = Record<string, unknown>;

function tableMeta(table: string) {
  const def = getTable(table);
  if (!def) throw new Error(`Unknown table "${table}" — is its module imported in bootstrap.ts?`);
  return def;
}

export function repo<T extends QueryResultRow = QueryResultRow>(tx: Tx, table: string) {
  const def = tableMeta(table);
  const t = quoteIdent(table);
  const aliveClause = def.softDelete ? ' and deleted_at is null' : '';

  return {
    async insert(values: Row): Promise<T> {
      const row: Row = { id: values.id ?? newId(), ...values };
      if (def.tenantScoped) row.tenant_id = tx.context.tenantId;
      if (def.timestamps) {
        row.created_by = values.created_by ?? tx.context.userId;
        row.updated_by = values.updated_by ?? tx.context.userId;
      }

      const columns = Object.keys(row).filter((c) => c in def.columns);
      const placeholders = columns.map((_, i) => `$${i + 1}`);
      return tx.one<T>(
        `insert into ${t} (${columns.map(quoteIdent).join(', ')})
         values (${placeholders.join(', ')})
         returning *`,
        columns.map((c) => row[c]),
      );
    },

    async insertMany(rows: Row[]): Promise<T[]> {
      if (rows.length === 0) return [];
      const prepared = rows.map((values) => {
        const row: Row = { id: values.id ?? newId(), ...values };
        if (def.tenantScoped) row.tenant_id = tx.context.tenantId;
        if (def.timestamps) {
          row.created_by = values.created_by ?? tx.context.userId;
          row.updated_by = values.updated_by ?? tx.context.userId;
        }
        return row;
      });

      // Union of keys, so callers may omit optional fields on some rows.
      const columns = [...new Set(prepared.flatMap(Object.keys))].filter((c) => c in def.columns);
      const params: unknown[] = [];
      const tuples = prepared.map((row) => {
        const slots = columns.map((c) => {
          params.push(row[c] ?? null);
          return `$${params.length}`;
        });
        return `(${slots.join(', ')})`;
      });

      return tx.query<T>(
        `insert into ${t} (${columns.map(quoteIdent).join(', ')})
         values ${tuples.join(', ')}
         returning *`,
        params,
      );
    },

    async update(id: string, values: Row): Promise<T> {
      const row: Row = { ...values };
      delete row.id;
      delete row.tenant_id;
      if (def.timestamps) {
        row.updated_at = 'now()';
        row.updated_by = tx.context.userId;
      }

      const columns = Object.keys(row).filter((c) => c in def.columns && c !== 'updated_at');
      const params: unknown[] = [];
      const assignments = columns.map((c) => {
        params.push(row[c]);
        return `${quoteIdent(c)} = $${params.length}`;
      });
      if (def.timestamps) assignments.push(`${quoteIdent('updated_at')} = now()`);

      params.push(id);
      const updated = await tx.maybeOne<T>(
        `update ${t} set ${assignments.join(', ')}
          where id = $${params.length}${aliveClause}
         returning *`,
        params,
      );
      if (!updated) throw new NotFoundError(table, id);
      return updated;
    },

    findById(id: string): Promise<T | null> {
      return tx.maybeOne<T>(`select * from ${t} where id = $1${aliveClause}`, [id]);
    },

    async getById(id: string): Promise<T> {
      const row = await this.findById(id);
      if (!row) throw new NotFoundError(table, id);
      return row;
    },

    findWhere(where: Row, options: { limit?: number; offset?: number; orderBy?: string } = {}): Promise<T[]> {
      const params: unknown[] = [];
      const clauses = Object.entries(where).map(([column, value]) => {
        if (value === null) return `${quoteIdent(column)} is null`;
        params.push(value);
        return `${quoteIdent(column)} = $${params.length}`;
      });
      if (def.softDelete) clauses.push('deleted_at is null');

      const parts = [`select * from ${t}`];
      if (clauses.length) parts.push(`where ${clauses.join(' and ')}`);
      parts.push(`order by ${options.orderBy ?? 'created_at desc'}`);
      if (options.limit) parts.push(`limit ${Number(options.limit)}`);
      if (options.offset) parts.push(`offset ${Number(options.offset)}`);

      return tx.query<T>(parts.join(' '), params);
    },

    async findOneWhere(where: Row): Promise<T | null> {
      const rows = await this.findWhere(where, { limit: 2 });
      if (rows.length > 1) throw new Error(`Expected at most 1 row in ${table}, got ${rows.length}`);
      return rows[0] ?? null;
    },

    /**
     * Soft delete where the table supports it, hard delete otherwise.
     * Business documents are never hard-deleted — they are cancelled, so their
     * number stays used and the audit trail stays intact.
     */
    async remove(id: string): Promise<void> {
      const sql = def.softDelete
        ? `update ${t} set deleted_at = now(), updated_by = $2 where id = $1 and deleted_at is null`
        : `delete from ${t} where id = $1`;
      const params = def.softDelete ? [id, tx.context.userId] : [id];
      await tx.query(sql, params);
    },
  };
}
