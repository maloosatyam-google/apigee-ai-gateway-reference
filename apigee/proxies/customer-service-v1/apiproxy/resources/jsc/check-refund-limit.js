// Refund limit, enforced at the gateway, for governed callers only.
//
// The Apigee MCP server forwards the caller's x-apikey to this proxy, so AE-CallerKey can
// look up which API products that key holds. The limit applies when the key holds any
// product listed in KVM refund.limitedProducts (comma-separated; default
// "Customer Service Tools MCP"). Keys on other products (e.g. Enterprise Tools MCP, the
// ungoverned all-tools product) are not limited. If the key cannot be resolved the limit
// applies: fail closed.
//
// The amount limit comes from KVM refund.maxAmount (default 50 USD).
var limit = parseFloat(context.getVariable('private.refund.maxAmount'));
if (isNaN(limit) || limit <= 0) { limit = 50; }
var limitedProducts = String(context.getVariable('private.refund.limitedProducts') || 'Customer Service Tools MCP')
  .split(',').map(function (p) { return p.trim(); }).filter(function (p) { return p; });
// AE-CallerKey returns the caller's whole app; only the <Credential> holding this key counts,
// so another key on the same app cannot widen or narrow the rule.
var appXml = String(context.getVariable('AccessEntity.AE-CallerKey') || '');
var key = String(context.getVariable('request.header.x-apikey') || '');
var entity = '';
var creds = appXml.split('<Credential>');
for (var c = 1; c < creds.length && key; c++) {
  var block = creds[c].split('</Credential>')[0];
  if (block.indexOf('<ConsumerKey>' + key + '</ConsumerKey>') !== -1) { entity = block; }
}
var matched = '';
for (var i = 0; i < limitedProducts.length && !matched; i++) {
  if (entity.indexOf(limitedProducts[i]) !== -1) { matched = limitedProducts[i]; }
}
var applies = !entity || !!matched;
var amount = NaN;
try { amount = parseFloat(JSON.parse(context.getVariable('request.content') || '{}').amount); } catch (e) { amount = NaN; }
context.setVariable('refund.maxAmount', String(limit));
context.setVariable('refund.amount', isNaN(amount) ? '0' : String(amount));
context.setVariable('refund.limitApplies', String(applies));
context.setVariable('refund.limitReason', !entity ? 'caller key not resolved (fail closed)' : (matched ? 'product ' + matched : 'no limited product on the key'));
context.setVariable('refund.overLimit', String(applies && !isNaN(amount) && amount > limit));
