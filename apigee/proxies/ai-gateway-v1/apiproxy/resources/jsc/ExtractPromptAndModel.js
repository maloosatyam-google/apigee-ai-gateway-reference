// Extract Prompt and Model from Request Payload for Model Armor & Routing

// The model id the LLM token quota is keyed on. Persona products grant /auto as an
// llmOperation with model "auto", but JS-AutoRouting later overwrites flow.model with
// the routed model (e.g. gemini-3.1-flash-lite). LTQ-TokenCount / LTQ-TokenEnforce
// resolved their limit from {flow.model}, found no matching operation, and failed
// silently (ratelimit.failed=true) - so /auto was never counted or limited. They now
// read flow.quota_model first; direct model paths leave it unset and fall back to
// flow.model.
if (/^\/auto/.test(context.getVariable("proxy.pathsuffix") || "")) {
  context.setVariable("flow.quota_model", "auto");
}

var reqContent = context.getVariable("request.content") || "";
if (reqContent) {
  try {
    var payload = JSON.parse(reqContent);
    var prompt = "";

    // 1. Google Gemini format: contents[].parts[].text
    if (payload.contents && Array.isArray(payload.contents) && payload.contents.length > 0) {
      var lastContent = payload.contents[payload.contents.length - 1];
      if (lastContent && lastContent.parts && Array.isArray(lastContent.parts)) {
        var partsText = [];
        for (var p = 0; p < lastContent.parts.length; p++) {
          if (lastContent.parts[p] && lastContent.parts[p].text) {
            partsText.push(lastContent.parts[p].text);
          }
        }
        prompt = partsText.join(" ");
      }
    }
    // 2. Anthropic Claude / OpenAI format: messages[].content
    else if (payload.messages && Array.isArray(payload.messages) && payload.messages.length > 0) {
      var lastMsg = payload.messages[payload.messages.length - 1];
      if (lastMsg) {
        if (typeof lastMsg.content === "string") {
          prompt = lastMsg.content;
        } else if (Array.isArray(lastMsg.content)) {
          var msgParts = [];
          for (var m = 0; m < lastMsg.content.length; m++) {
            if (lastMsg.content[m] && lastMsg.content[m].text) {
              msgParts.push(lastMsg.content[m].text);
            }
          }
          prompt = msgParts.join(" ");
        }
      }
    }
    // 3. Flat prompt format
    else if (payload.prompt) {
      prompt = (typeof payload.prompt === "string") ? payload.prompt : JSON.stringify(payload.prompt);
    }

    if (prompt) {
      context.setVariable("flow.userPrompt", prompt);
    }
    if (payload.model) {
      context.setVariable("flow.payloadModel", payload.model);
      var currentModel = context.getVariable("flow.model");
      if (!currentModel) {
        context.setVariable("flow.model", payload.model);
      }
      var currentTargetModel = context.getVariable("flow.target_model");
      if (!currentTargetModel) {
        context.setVariable("flow.target_model", payload.model);
      }
    }
  } catch (e) {
    // Non-JSON or parsing error; continue flow
  }
}
