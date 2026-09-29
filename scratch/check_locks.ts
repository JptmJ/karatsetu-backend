import { pool, closePool } from '../src/core/db/pool.js';

async function main() {
  const r = await pool.query(`
    select l.pid, l.locktype, l.mode, l.granted, l.objid,
           a.query, a.state
      from pg_locks l
      left join pg_stat_activity a on a.pid = l.pid
     where l.locktype = 'advisory'
  `);
  console.log('ADVISORY LOCKS:', r.rows);
  await closePool();
}

main().catch(console.error);
