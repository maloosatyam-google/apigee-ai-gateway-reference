// Budget accounting audit.
//
// QC-DeductBudget is the only thing that moves the developer-budget-counter, and it is
// continueOnError="true" by design so a metering problem can never fail a user's request.
// The cost of that design is that every way it can go wrong is silent:
//
//   1. The step is gated on `flow.tx_cost_micros != null`. If JS-CalculateCost throws, the
//      variable is never set, the step is skipped, and NO fault is raised anywhere. Spend
//      simply never enters the counter.
//   2. If the Quota policy itself faults, continueOnError swallows it. Same outcome.
//   3. QC-EnforceBudgetLimit in the PreFlow is ALSO continueOnError="true" and nothing
//      inspects ratelimit.QC-EnforceBudgetLimit.exceeded, so crossing the cap does not
//      reject anything. The counter is observability, not enforcement.
//
// This script changes none of that. It only names the outcome so it can be logged and
// alerted on. It must stay side-effect free with respect to request handling.

var DEDUCT = "QC-DeductBudget";
var ENFORCE = "QC-EnforceBudgetLimit";

function v(name) {
  var raw = context.getVariable(name);
  if (raw === null || raw === undefined || raw === "") { return null; }
  return String(raw);
}

function num(name) {
  var raw = v(name);
  if (raw === null) { return null; }
  var parsed = parseFloat(raw);
  return isNaN(parsed) ? null : parsed;
}

function usd(micros) {
  if (micros === null) { return null; }
  return (micros / 1000000).toFixed(6);
}

var isCached = v("flow.cached") === "true";
var costMicros = num("flow.tx_cost_micros");

// Apigee sets <policy>.failed only when the policy actually raised. Read it as a string:
// the variable is a boolean and getVariable can hand back either a Boolean or "true".
var deductFailed = v(DEDUCT + ".failed") === "true";

// Quota populates these whenever it executed, even if it then raised QuotaViolation. Their
// presence is therefore the reliable signal that the counter was actually touched - far more
// dependable than fault.name, which reflects the most recent fault from anywhere in the flow.
var usedMicros = num("ratelimit." + DEDUCT + ".used.count");
var allowedMicros = num("ratelimit." + DEDUCT + ".allowed.count");
var availableMicros = num("ratelimit." + DEDUCT + ".available.count");

// Fall back to the enforcer's view of the shared counter. Both policies share
// SharedName developer-budget-counter, so these describe the same bucket. This is what
// keeps used/limit reportable on a cache hit, when the deduct step never runs.
if (usedMicros === null) { usedMicros = num("ratelimit." + ENFORCE + ".used.count"); }
if (allowedMicros === null) { allowedMicros = num("ratelimit." + ENFORCE + ".allowed.count"); }
if (availableMicros === null) { availableMicros = num("ratelimit." + ENFORCE + ".available.count"); }

var status;
if (deductFailed) {
  // Distinguish "rejected us because the cap is now crossed" from "did not work". In the
  // first case the counter DID record the spend and the budget is simply exhausted; in the
  // second the spend is lost and the counter is now understated forever.
  status = (usedMicros !== null) ? "violation" : "error";
} else if (isCached) {
  status = "skipped_cached";       // deliberate: a cached answer must not spend budget
} else if (costMicros === null) {
  status = "skipped_no_cost";      // THE silent failure - costing did not produce a weight
} else if (usedMicros === null) {
  status = "skipped_not_run";      // step condition matched nothing, or policy disabled
} else {
  status = "ok";
}

context.setVariable("flow.budget_status", status);

// True whenever the shared counter is exhausted.
//
// NOTE: there is no `ratelimit.<policy>.exceeded` variable. Apigee exposes `.exceed.count`
// (how many requests in this window were refused) and `.failed`. Reading the non-existent
// name silently yields null, which made this report "false" unconditionally - verified on
// dev by dumping all the candidates to response headers with the cap forced to 2 micros:
//   exceeded='' exceed.count=1 failed=true allowed=2 used=235 available=0
function exceedCount(policy) {
  var n = num("ratelimit." + policy + ".exceed.count");
  return n === null ? 0 : n;
}
var isExceeded = exceedCount(ENFORCE) > 0 || exceedCount(DEDUCT) > 0;
context.setVariable("flow.budget_exceeded", isExceeded ? "true" : "false");

if (usedMicros !== null) { context.setVariable("flow.budget_used_usd", usd(usedMicros)); }
if (allowedMicros !== null) { context.setVariable("flow.budget_limit_usd", usd(allowedMicros)); }
if (availableMicros !== null) { context.setVariable("flow.budget_available_usd", usd(availableMicros)); }
