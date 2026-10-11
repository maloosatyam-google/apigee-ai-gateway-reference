// Converts Anthropic Claude response to standard Gemini candidates structure
// if flow.convert_claude_to_gemini_resp is true
//
// Handles both plain text replies and tool calls. Anthropic returns a list of
// content blocks; "text" blocks become Gemini text parts and "tool_use" blocks
// become Gemini functionCall parts so that a caller written against the Gemini
// API can drive a tool loop against Claude without knowing the difference.
//
// Note: Apigee runs Rhino (ES5). No let/const/arrow functions.
try {
  var needConversion = context.getVariable("flow.convert_claude_to_gemini_resp");
  if (needConversion === "true" || needConversion === true) {
    var respContent = context.getVariable("response.content") || "";
    if (respContent) {
      var claudeJson = JSON.parse(respContent);
      var isArray = function (v) {
        return Object.prototype.toString.call(v) === "[object Array]";
      };

      if (claudeJson.content && isArray(claudeJson.content)) {
        var parts = [];
        var textResult = "";

        for (var i = 0; i < claudeJson.content.length; i++) {
          var block = claudeJson.content[i] || {};

          if (block.type === "text" && block.text) {
            // Coalesce consecutive text blocks into a single part, matching
            // what Gemini itself returns for a plain answer.
            textResult += block.text;
          } else if (block.type === "tool_use") {
            // Flush any text accumulated before this tool call so ordering is
            // preserved, then emit the call itself.
            if (textResult) {
              parts.push({ text: textResult });
              textResult = "";
            }
            parts.push({
              functionCall: {
                id: block.id || "",
                name: block.name || "",
                args: block.input || {}
              }
            });
          }
          // Other block types (e.g. "thinking") are intentionally dropped:
          // they have no Gemini equivalent the caller can act on.
        }

        if (textResult) {
          parts.push({ text: textResult });
        }
        if (parts.length === 0) {
          // Gemini always returns at least one part; an empty parts array
          // breaks naive clients that read parts[0].
          parts.push({ text: "" });
        }

        // Gemini reports STOP even when the turn ends in a functionCall, so
        // Anthropic's tool_use maps to STOP rather than a distinct reason.
        var stopReason = claudeJson.stop_reason;
        var finishReason = "STOP";
        if (stopReason === "max_tokens") {
          finishReason = "MAX_TOKENS";
        } else if (stopReason === "refusal") {
          finishReason = "SAFETY";
        }

        var promptTokens = (claudeJson.usage && claudeJson.usage.input_tokens) || 0;
        var compTokens = (claudeJson.usage && claudeJson.usage.output_tokens) || 0;
        var geminiCandidate = {
          candidates: [
            {
              content: {
                role: "model",
                parts: parts
              },
              finishReason: finishReason
            }
          ],
          usageMetadata: {
            promptTokenCount: promptTokens,
            candidatesTokenCount: compTokens,
            totalTokenCount: promptTokens + compTokens,
            trafficType: "ON_DEMAND"
          },
          modelVersion: claudeJson.model || context.getVariable("flow.target_model") || "claude-opus-5-5"
        };
        context.setVariable("response.content", JSON.stringify(geminiCandidate));
      }
    }
  }
} catch (e) {
  // Continue without conversion on failure
}
