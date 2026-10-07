// Prepares request payload for Anthropic Claude on Vertex Model Garden.
//
// Apigee JS is Rhino/ES5: no let/const, arrow functions, or Object.assign.
//
// This bridges the Gemini wire format the gateway exposes onto Anthropic's
// Messages API. It previously translated only plain text, which meant `tools`,
// `systemInstruction`, and any multi-turn tool exchange were silently dropped:
// a caller that sent tools to a Claude model got a cheerful "I don't have
// access to tools" back, with no error anywhere to explain why.
try {
  var targetModel = context.getVariable("flow.target_model") || context.getVariable("flow.model") || "";
  // The claude-3-x generation is no longer published to Vertex in this project.
  // Coerce any legacy or unset ID to the current default rather than 404ing.
  if (!targetModel || targetModel.indexOf("claude-3-") !== -1 || targetModel.indexOf("claude-default") !== -1) {
    targetModel = "claude-opus-4-5@20251101";
  }
  context.setVariable("flow.target_model", targetModel);

  // Anthropic's input_schema is plain JSON Schema (lowercase types). Some Gemini
  // SDKs emit the protobuf spelling ("OBJECT", "STRING"), so normalise rather
  // than hand Vertex a schema it will reject.
  function normalizeSchema(node) {
    if (!node || typeof node !== "object") return node;
    if (Object.prototype.toString.call(node) === "[object Array]") {
      var arr = [];
      for (var i = 0; i < node.length; i++) arr.push(normalizeSchema(node[i]));
      return arr;
    }
    var out = {};
    for (var k in node) {
      if (!Object.prototype.hasOwnProperty.call(node, k)) continue;
      if (k === "type" && typeof node[k] === "string") out[k] = node[k].toLowerCase();
      else out[k] = normalizeSchema(node[k]);
    }
    return out;
  }

  function toClaudeTools(geminiTools) {
    var tools = [];
    for (var t = 0; t < geminiTools.length; t++) {
      var decls = geminiTools[t] && geminiTools[t].functionDeclarations;
      if (!decls) continue;
      for (var d = 0; d < decls.length; d++) {
        var fn = decls[d];
        if (!fn || !fn.name) continue;
        tools.push({
          name: fn.name,
          description: fn.description || "",
          // Anthropic requires an object schema even for a no-arg tool.
          input_schema: normalizeSchema(fn.parameters) || { type: "object", properties: {} }
        });
      }
    }
    return tools;
  }

  var rawContent = context.getVariable("request.content") || "";
  if (rawContent) {
    var body = JSON.parse(rawContent);

    // 1. If payload is in Gemini format (contents), convert to Claude messages format
    if (body.contents && Object.prototype.toString.call(body.contents) === "[object Array]") {
      var claudeMessages = [];
      // Anthropic correlates a tool_result to its tool_use by id. Gemini's
      // functionResponse often omits the id, so remember the last id issued per
      // function name and fall back to that.
      var lastToolUseIdByName = {};
      var syntheticId = 0;

      for (var c = 0; c < body.contents.length; c++) {
        var item = body.contents[c];
        var role = (item.role === "model") ? "assistant" : "user";
        var blocks = [];
        var resultBlocks = [];

        if (item.parts && Object.prototype.toString.call(item.parts) === "[object Array]") {
          for (var p = 0; p < item.parts.length; p++) {
            var part = item.parts[p];
            if (!part) continue;

            if (part.text) {
              blocks.push({ type: "text", text: part.text });
            } else if (part.functionCall) {
              syntheticId++;
              var callId = part.functionCall.id || ("toolu_" + syntheticId);
              lastToolUseIdByName[part.functionCall.name] = callId;
              blocks.push({
                type: "tool_use",
                id: callId,
                name: part.functionCall.name,
                input: part.functionCall.args || {}
              });
            } else if (part.functionResponse) {
              var fr = part.functionResponse;
              var useId = fr.id || lastToolUseIdByName[fr.name] || ("toolu_" + fr.name);
              // Anthropic wants the result as a string; the Gemini shape is an object.
              var payload = fr.response;
              resultBlocks.push({
                type: "tool_result",
                tool_use_id: useId,
                content: (typeof payload === "string") ? payload : JSON.stringify(payload === undefined ? {} : payload)
              });
            }
          }
        }

        // tool_result blocks must be delivered in a user turn, and must not be
        // mixed into an assistant turn.
        if (resultBlocks.length) {
          claudeMessages.push({ role: "user", content: resultBlocks });
          // Any accompanying text rides along in the same user turn.
          if (blocks.length) claudeMessages.push({ role: "user", content: blocks });
          continue;
        }

        if (!blocks.length) continue; // Anthropic rejects an empty content array.
        claudeMessages.push({ role: role, content: blocks });
      }

      // Anthropic requires turns to alternate between user and assistant.
      // Splitting tool_result into its own user turn can produce two user turns
      // in a row, so fold neighbours with the same role back together.
      var mergedMessages = [];
      for (var m = 0; m < claudeMessages.length; m++) {
        var prev = mergedMessages[mergedMessages.length - 1];
        if (prev && prev.role === claudeMessages[m].role) {
          prev.content = prev.content.concat(claudeMessages[m].content);
        } else {
          mergedMessages.push(claudeMessages[m]);
        }
      }

      var claudePayload = {
        anthropic_version: "vertex-2023-10-16",
        messages: mergedMessages,
        max_tokens: 1024
      };

      // systemInstruction was previously dropped entirely, so a Claude model
      // ignored every instruction the caller set.
      if (body.systemInstruction && body.systemInstruction.parts) {
        var sysText = [];
        for (var s = 0; s < body.systemInstruction.parts.length; s++) {
          if (body.systemInstruction.parts[s] && body.systemInstruction.parts[s].text) {
            sysText.push(body.systemInstruction.parts[s].text);
          }
        }
        if (sysText.length) claudePayload.system = sysText.join("\n");
      }

      if (body.generationConfig) {
        if (body.generationConfig.temperature !== undefined) {
          claudePayload.temperature = body.generationConfig.temperature;
        }
        if (body.generationConfig.maxOutputTokens !== undefined) {
          claudePayload.max_tokens = body.generationConfig.maxOutputTokens;
        }
        if (body.generationConfig.topP !== undefined) {
          claudePayload.top_p = body.generationConfig.topP;
        }
        if (body.generationConfig.stopSequences !== undefined) {
          claudePayload.stop_sequences = body.generationConfig.stopSequences;
        }
      }

      if (body.tools && Object.prototype.toString.call(body.tools) === "[object Array]") {
        var mapped = toClaudeTools(body.tools);
        if (mapped.length) {
          claudePayload.tools = mapped;
          // A tool-bearing turn needs room for the tool_use block plus an answer.
          if (claudePayload.max_tokens < 2048) claudePayload.max_tokens = 2048;
        }
      }

      // toolConfig.functionCallingConfig.mode -> tool_choice
      if (body.toolConfig && body.toolConfig.functionCallingConfig && claudePayload.tools) {
        var mode = String(body.toolConfig.functionCallingConfig.mode || "").toUpperCase();
        if (mode === "ANY") claudePayload.tool_choice = { type: "any" };
        else if (mode === "NONE") delete claudePayload.tools;
        else if (mode === "AUTO") claudePayload.tool_choice = { type: "auto" };
      }

      var outStr = JSON.stringify(claudePayload);
      context.setVariable("request.content", outStr);
      request.content = outStr;
      context.setVariable("flow.convert_claude_to_gemini_resp", "true");
    }
    // 2. If already in Anthropic format (messages), ensure vertex headers & fields
    else if (body.messages && Object.prototype.toString.call(body.messages) === "[object Array]") {
      if (!body.anthropic_version) {
        body.anthropic_version = "vertex-2023-10-16";
      }
      if (!body.max_tokens) {
        body.max_tokens = 1024;
      }
      if (body.model !== undefined) {
        delete body.model;
      }
      var outStr2 = JSON.stringify(body);
      context.setVariable("request.content", outStr2);
      request.content = outStr2;
    }
  }
} catch (e) {
  // Allow to proceed
}
