// Dedicated intelligent auto-routing engine
// Leverages TypeSafe AI JEV System One router model and API Product custom attributes
// to dynamically select the optimal model

var category = null;

// Helper to extract category from candidate JSON text (Gemini fallback)
function extractCategory(raw) {
  if (!raw) return null;
  var cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  try {
    var obj = JSON.parse(cleaned);
    if (obj && obj.category) {
      return String(obj.category).toLowerCase().trim();
    }
  } catch (e) {
    var m = cleaned.match(/"category"\s*:\s*"([^"]+)"/i);
    if (m && m[1]) {
      return m[1].toLowerCase().trim();
    }
  }
  return null;
}

// 1. Inspect response from router ServiceCallout (SC-ModelRouter)
try {
  var routerResponseContent = context.getVariable("routerResponse.content");
  if (routerResponseContent) {
    var parsedResp = JSON.parse(routerResponseContent);
    // Support TypeSafe AI JEV System One response format
    if (parsedResp.answers && parsedResp.answers.category) {
      var ans = parsedResp.answers.category;
      if (ans.choice) {
        category = String(ans.choice).toLowerCase().trim();
      }
      if (ans.confidence !== undefined && ans.confidence !== null) {
        context.setVariable("flow.routerConfidence", String(ans.confidence));
      }
      if (parsedResp.model) {
        context.setVariable("flow.routerEngine", String(parsedResp.model));
      }
    }
    // Support Google Gemini format for backwards compatibility / fallback
    else if (parsedResp.candidates && parsedResp.candidates.length > 0) {
      var cand = parsedResp.candidates[0];
      if (cand.content && cand.content.parts && cand.content.parts.length > 0) {
        category = extractCategory(cand.content.parts[0].text);
      }
      if (parsedResp.modelVersion) {
        context.setVariable("flow.routerEngine", String(parsedResp.modelVersion));
      }
    }
    // Fallback: direct category field if top-level
    else if (parsedResp.category) {
      category = String(parsedResp.category).toLowerCase().trim();
      if (parsedResp.model) {
        context.setVariable("flow.routerEngine", String(parsedResp.model));
      }
    }
  }
} catch (e) {
  // ServiceCallout failed, timed out, or response was unparseable
}


// 2. Resolve target model dynamically from the API Product custom attributes:
// verifyapikey.VA-VerifyAPIKey.apiproduct.routing.model.<category>
var targetModel = null;
if (category) {
  targetModel = context.getVariable("verifyapikey.VA-VerifyAPIKey.apiproduct.routing.model." + category);
}

// Fallback to general category model attribute if specific category attribute is missing
if (!targetModel) {
  targetModel = context.getVariable("verifyapikey.VA-VerifyAPIKey.apiproduct.routing.model.general");
}

// The persona product that supplied the routing map (e.g. "Engineering and IT").
// Trace-only: routing itself is driven by the product's routing.model.* attributes.
var productName = context.getVariable("verifyapikey.VA-VerifyAPIKey.apiproduct.name") || "";
context.setVariable("flow.routingTier", productName || "unknown");

var targetProvider = (targetModel && targetModel.indexOf("claude") !== -1) ? "anthropic" : "google";

// Routing selects a MODEL and nothing else. It deliberately does not set
// flow.costTier: cost is derived downstream by CalculateCost.js from the rate
// resolved out of the ai-model-rates KVM, which is the single source of truth.
context.setVariable("flow.routerCategory", category);
context.setVariable("flow.target_model", targetModel);
context.setVariable("flow.model", targetModel);
context.setVariable("flow.target_provider", targetProvider);
context.setVariable("flow.autoRouted", "true");
