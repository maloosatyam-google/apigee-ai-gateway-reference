// Private API: only the Apigee MCP server (or anything egressing from this org's NAT IPs)
// may call it. Everything after the last public IP in X-Forwarded-For was appended by Google
// infrastructure, so the client cannot forge it (spoofed entries land before its own IP).
//   direct call : "<client>, <lb>, 10.148.x.x"                               -> 1 internal hop
//   via /mcp    : "<client>, <lb>, 10.148.x.x, 10.0.32.3, 10.0.0.2, 7.0.4.3"   -> 4 internal hops
// The MCP server calls the REST proxy over Apigee's internal network, so it is recognised by
// having 2+ trailing internal hops. 7.0.0.0/8 is the Apigee runtime's internal hop range.
function isInternalHop(ip) {
  var o = ip.split('.').map(Number);
  if (o.length !== 4) { return false; }
  return o[0] === 10 || o[0] === 7 || (o[0] === 172 && o[1] >= 16 && o[1] <= 31) ||
    (o[0] === 192 && o[1] === 168) || (o[0] === 100 && o[1] >= 64 && o[1] <= 127);
}
var xff = String(context.getVariable('request.header.X-Forwarded-For.values.string') || context.getVariable('request.header.X-Forwarded-For') || '');
var parts = xff.split(',').map(function (p) { return p.trim(); }).filter(function (p) { return p; });
var hops = 0;
while (hops < parts.length && isInternalHop(parts[parts.length - 1 - hops])) { hops++; }
var lastPublic = hops < parts.length ? parts.length - 1 - hops : -1;
// With the LB at lastPublic, the IP that reached the LB (the real caller) sits just before it.
var callerIp = lastPublic >= 1 ? parts[lastPublic - 1] : (parts[0] || String(context.getVariable('client.ip') || ''));
var allowed = String(context.getVariable('private.internal.allowedIps') || '34.124.136.14').split(',').map(function (p) { return p.trim(); });
var enforce = String(context.getVariable('private.internal.enforce') || 'true') !== 'false';
var viaMcp = hops >= 2;
var internal = viaMcp || allowed.indexOf(callerIp) >= 0;
context.setVariable('caller.ip', callerIp);
context.setVariable('caller.internalHops', String(hops));
context.setVariable('caller.internal', String(internal));
context.setVariable('caller.blocked', String(enforce && !internal));
