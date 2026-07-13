import { BudgetGovernor } from '../lib/gateway/budget.js';

// `pnpm budget` — prints cumulative spend and asserts it is under cap.
const gov = new BudgetGovernor();
const spent = gov.spent();
const cap = gov.cap();

const capStr = cap === null ? 'unset' : `$${cap.toFixed(2)}`;
console.log(`spend: $${spent.toFixed(4)} / cap ${capStr}`);

if (cap !== null && spent > cap + 1e-9) {
  console.error(`OVER CAP by $${(spent - cap).toFixed(4)}`);
  process.exit(1);
}
console.log('under cap ✓');
