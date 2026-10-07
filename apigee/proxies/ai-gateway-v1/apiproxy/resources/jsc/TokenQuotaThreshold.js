// LLM token-quota threshold signal.
//
// Runs in the PostFlow right after LTQ-TokenCount (the CountOnly half of the shared
// `common-counter`):
//
//   ratelimit.LTQ-TokenCount.used.count   tokens consumed in the current window, this
//                                         response included
//   verifyapikey.VA-VerifyAPIKey.apiproduct.developer.llmQuota.limit
//                                         the product's llmTokenQuota for the matched
//                                         operation - the same value both LTQ policies
//                                         take via countRef
//
// NOT ratelimit.LTQ-TokenCount.allowed.count: a CountOnly policy never enforces, and on
// the runtime it reports Long.MAX_VALUE (9223372036854775807), which made every call read
// as 0%. Verified on dev.
//
// It turns them into a status the client can act on BEFORE LTQ-TokenEnforce starts
// returning 429s. Apigee conditions cannot do arithmetic, which is why this is a script
// rather than a conditional AssignMessage.
//
// Observability only: writes flow variables, never faults a request.
//
//   flow.token_quota_used / flow.token_quota_limit / flow.token_quota_used_pct
//   flow.token_quota_status   "ok" | "near-threshold" | "exhausted"
//   flow.token_quota_warning  human-readable message, set only when status != "ok"

var COUNTER = "LTQ-TokenCount";

function num(name) {
  var raw = context.getVariable(name);
  if (raw === null || raw === undefined || raw === "") { return null; }
  var parsed = parseFloat(String(raw));
  return isFinite(parsed) ? parsed : null;
}

// Fraction of the allocation above which the caller is warned. Policy <Property>, 0 < t < 1.
var threshold = parseFloat(typeof properties !== "undefined" && properties.threshold ? properties.threshold : "0.5");
if (!isFinite(threshold) || threshold <= 0 || threshold >= 1) { threshold = 0.5; }

var used = num("ratelimit." + COUNTER + ".used.count");
var allowed = num("verifyapikey.VA-VerifyAPIKey.apiproduct.developer.llmQuota.limit");
if (allowed === null) {
  // Fallback only if it is a real limit, never the CountOnly Long.MAX sentinel.
  var counterAllowed = num("ratelimit." + COUNTER + ".allowed.count");
  if (counterAllowed !== null && counterAllowed < 1e12) { allowed = counterAllowed; }
}

if (used !== null && allowed !== null && allowed > 0) {
  var pct = Math.round((used / allowed) * 1000) / 10; // one decimal place
  var status = pct >= 100 ? "exhausted" : (pct > threshold * 100 ? "near-threshold" : "ok");

  context.setVariable("flow.token_quota_used", String(used));
  context.setVariable("flow.token_quota_limit", String(allowed));
  context.setVariable("flow.token_quota_used_pct", String(pct));
  context.setVariable("flow.token_quota_threshold_pct", String(Math.round(threshold * 100)));
  context.setVariable("flow.token_quota_status", status);

  if (status === "near-threshold") {
    context.setVariable("flow.token_quota_warning",
      "Nearing token quota threshold: " + pct + "% of " + allowed + " tokens used in the current window");
  } else if (status === "exhausted") {
    context.setVariable("flow.token_quota_warning",
      "Token quota exhausted: " + pct + "% of " + allowed + " tokens used; further requests will be rejected until the window resets");
  }
}
