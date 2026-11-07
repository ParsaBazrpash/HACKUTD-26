// TEMPORARY Gate 1 module (docs/PLAN.md A1): a public ping table so two
// browsers can prove live sync on Maincloud. Replaced by the real module in A2
// (all tables private, my_* views). Do not ship this table.
import { schema, table, t } from 'spacetimedb/server';

const ping = table(
  { public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    sender: t.identity(),
    at: t.timestamp(),
  },
);

const spacetimedb = schema({ ping });
export default spacetimedb;

export const add_ping = spacetimedb.reducer((ctx) => {
  ctx.db.ping.insert({ id: 0n, sender: ctx.sender, at: ctx.timestamp });
});
