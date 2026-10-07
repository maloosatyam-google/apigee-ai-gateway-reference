/**
 * Canonical persona product definitions, mirrored from apigee/products/*.json.
 *
 * The Docker image ships only dist/, server.js and server/, so the server cannot
 * read apigee/products at runtime. tests/products.unit.test.mjs asserts this copy
 * equals the JSON files, so edit the JSON and regenerate rather than hand-editing.
 *
 * Used as the fallback when a product cannot be read from Apigee.
 */
export const DEFAULT_PRODUCTS = {
  "Engineering and IT": {
    "name": "Engineering and IT",
    "displayName": "Engineering & IT",
    "description": "Engineering & IT persona: every model including Claude Opus and Gemini Pro for coding and deep reasoning.",
    "approvalType": "auto",
    "environments": [
      "prod"
    ],
    "attributes": [
      {
        "name": "access",
        "value": "private"
      },
      {
        "name": "developer.budget.limit",
        "value": "20000000"
      },
      {
        "name": "developer.budget.interval",
        "value": "1"
      },
      {
        "name": "developer.budget.timeunit",
        "value": "month"
      },
      {
        "name": "routing.model.coding",
        "value": "claude-opus-4-5@20251101"
      },
      {
        "name": "routing.model.deep_reasoning",
        "value": "gemini-3.1-pro-preview"
      },
      {
        "name": "routing.model.simple",
        "value": "gemini-3.1-flash-lite"
      },
      {
        "name": "routing.model.general",
        "value": "gemini-3-flash-preview"
      },
      {
        "name": "persona",
        "value": "Engineering & IT"
      }
    ],
    "llmOperationGroup": {
      "operationConfigs": [
        {
          "apiSource": "ai-gateway-v1",
          "llmOperations": [
            {
              "resource": "/auto",
              "methods": [
                "POST"
              ],
              "model": "auto"
            }
          ],
          "llmTokenQuota": {
            "limit": "50000",
            "interval": "1",
            "timeUnit": "minute"
          }
        },
        {
          "apiSource": "ai-gateway-v1",
          "llmOperations": [
            {
              "resource": "/auto:*",
              "methods": [
                "POST"
              ],
              "model": "auto"
            }
          ],
          "llmTokenQuota": {
            "limit": "50000",
            "interval": "1",
            "timeUnit": "minute"
          }
        },
        {
          "apiSource": "ai-gateway-v1",
          "llmOperations": [
            {
              "resource": "/models/gemini-3.1-flash-lite:*",
              "methods": [
                "POST"
              ],
              "model": "gemini-3.1-flash-lite"
            }
          ],
          "llmTokenQuota": {
            "limit": "10000",
            "interval": "1",
            "timeUnit": "minute"
          }
        },
        {
          "apiSource": "ai-gateway-v1",
          "llmOperations": [
            {
              "resource": "/models/gemini-3-flash-preview:*",
              "methods": [
                "POST"
              ],
              "model": "gemini-3-flash-preview"
            }
          ],
          "llmTokenQuota": {
            "limit": "10000",
            "interval": "1",
            "timeUnit": "minute"
          }
        },
        {
          "apiSource": "ai-gateway-v1",
          "llmOperations": [
            {
              "resource": "/models/gemini-3.1-pro-preview:*",
              "methods": [
                "POST"
              ],
              "model": "gemini-3.1-pro-preview"
            }
          ],
          "llmTokenQuota": {
            "limit": "10000",
            "interval": "1",
            "timeUnit": "minute"
          }
        },
        {
          "apiSource": "ai-gateway-v1",
          "llmOperations": [
            {
              "resource": "/models/claude-haiku-4-5@20251001:*",
              "methods": [
                "POST"
              ],
              "model": "claude-haiku-4-5@20251001"
            }
          ],
          "llmTokenQuota": {
            "limit": "300",
            "interval": "1",
            "timeUnit": "minute"
          }
        },
        {
          "apiSource": "ai-gateway-v1",
          "llmOperations": [
            {
              "resource": "/models/claude-opus-4-5@20251101:*",
              "methods": [
                "POST"
              ],
              "model": "claude-opus-4-5@20251101"
            }
          ],
          "llmTokenQuota": {
            "limit": "10000",
            "interval": "1",
            "timeUnit": "minute"
          }
        },
        {
          "apiSource": "ai-gateway-v1",
          "llmOperations": [
            {
              "resource": "/models/gemini-3.7-flash:*",
              "methods": [
                "POST"
              ],
              "model": "gemini-3.7-flash"
            }
          ],
          "llmTokenQuota": {
            "limit": "10000",
            "interval": "1",
            "timeUnit": "minute"
          }
        },
        {
          "apiSource": "ai-gateway-v1",
          "llmOperations": [
            {
              "resource": "/models/gemini-3.8-flash:*",
              "methods": [
                "POST"
              ],
              "model": "gemini-3.8-flash"
            }
          ],
          "llmTokenQuota": {
            "limit": "10000",
            "interval": "1",
            "timeUnit": "minute"
          }
        }
      ]
    }
  },
  "Analysts and Knowledge Workers": {
    "name": "Analysts and Knowledge Workers",
    "displayName": "Analysts & Knowledge Workers",
    "description": "Analysts & Knowledge Workers persona: Gemini Pro and Flash family for research and analysis; no Claude.",
    "approvalType": "auto",
    "environments": [
      "prod"
    ],
    "attributes": [
      {
        "name": "access",
        "value": "private"
      },
      {
        "name": "developer.budget.limit",
        "value": "10000000"
      },
      {
        "name": "developer.budget.interval",
        "value": "1"
      },
      {
        "name": "developer.budget.timeunit",
        "value": "month"
      },
      {
        "name": "routing.model.coding",
        "value": "gemini-3.1-pro-preview"
      },
      {
        "name": "routing.model.deep_reasoning",
        "value": "gemini-3.1-pro-preview"
      },
      {
        "name": "routing.model.simple",
        "value": "gemini-3.1-flash-lite"
      },
      {
        "name": "routing.model.general",
        "value": "gemini-3-flash-preview"
      },
      {
        "name": "persona",
        "value": "Analysts & Knowledge Workers"
      }
    ],
    "llmOperationGroup": {
      "operationConfigs": [
        {
          "apiSource": "ai-gateway-v1",
          "llmOperations": [
            {
              "resource": "/auto",
              "methods": [
                "POST"
              ],
              "model": "auto"
            }
          ],
          "llmTokenQuota": {
            "limit": "30000",
            "interval": "1",
            "timeUnit": "minute"
          }
        },
        {
          "apiSource": "ai-gateway-v1",
          "llmOperations": [
            {
              "resource": "/auto:*",
              "methods": [
                "POST"
              ],
              "model": "auto"
            }
          ],
          "llmTokenQuota": {
            "limit": "30000",
            "interval": "1",
            "timeUnit": "minute"
          }
        },
        {
          "apiSource": "ai-gateway-v1",
          "llmOperations": [
            {
              "resource": "/models/gemini-3.1-pro-preview:*",
              "methods": [
                "POST"
              ],
              "model": "gemini-3.1-pro-preview"
            }
          ],
          "llmTokenQuota": {
            "limit": "5000",
            "interval": "1",
            "timeUnit": "minute"
          }
        },
        {
          "apiSource": "ai-gateway-v1",
          "llmOperations": [
            {
              "resource": "/models/gemini-3.1-flash-lite:*",
              "methods": [
                "POST"
              ],
              "model": "gemini-3.1-flash-lite"
            }
          ],
          "llmTokenQuota": {
            "limit": "5000",
            "interval": "1",
            "timeUnit": "minute"
          }
        },
        {
          "apiSource": "ai-gateway-v1",
          "llmOperations": [
            {
              "resource": "/models/gemini-3-flash-preview:*",
              "methods": [
                "POST"
              ],
              "model": "gemini-3-flash-preview"
            }
          ],
          "llmTokenQuota": {
            "limit": "5000",
            "interval": "1",
            "timeUnit": "minute"
          }
        },
        {
          "apiSource": "ai-gateway-v1",
          "llmOperations": [
            {
              "resource": "/models/gemini-3.7-flash:*",
              "methods": [
                "POST"
              ],
              "model": "gemini-3.7-flash"
            }
          ],
          "llmTokenQuota": {
            "limit": "5000",
            "interval": "1",
            "timeUnit": "minute"
          }
        },
        {
          "apiSource": "ai-gateway-v1",
          "llmOperations": [
            {
              "resource": "/models/gemini-3.8-flash:*",
              "methods": [
                "POST"
              ],
              "model": "gemini-3.8-flash"
            }
          ],
          "llmTokenQuota": {
            "limit": "5000",
            "interval": "1",
            "timeUnit": "minute"
          }
        }
      ]
    }
  },
  "Customer Support and Sales": {
    "name": "Customer Support and Sales",
    "displayName": "Customer Support & Sales",
    "description": "Customer Support & Sales persona: fast, low-cost models (Gemini Flash-Lite, Gemini Flash, Claude Haiku), with Gemini Pro on /auto only for questions that need deep reasoning.",
    "approvalType": "auto",
    "environments": [
      "prod"
    ],
    "attributes": [
      {
        "name": "access",
        "value": "private"
      },
      {
        "name": "developer.budget.limit",
        "value": "5000000"
      },
      {
        "name": "developer.budget.interval",
        "value": "1"
      },
      {
        "name": "developer.budget.timeunit",
        "value": "month"
      },
      {
        "name": "routing.model.coding",
        "value": "claude-haiku-4-5@20251001"
      },
      {
        "name": "routing.model.deep_reasoning",
        "value": "gemini-3.1-pro-preview"
      },
      {
        "name": "routing.model.simple",
        "value": "gemini-3.1-flash-lite"
      },
      {
        "name": "routing.model.general",
        "value": "gemini-3-flash-preview"
      },
      {
        "name": "persona",
        "value": "Customer Support & Sales"
      }
    ],
    "llmOperationGroup": {
      "operationConfigs": [
        {
          "apiSource": "ai-gateway-v1",
          "llmOperations": [
            {
              "resource": "/auto",
              "methods": [
                "POST"
              ],
              "model": "auto"
            }
          ],
          "llmTokenQuota": {
            "limit": "20000",
            "interval": "2",
            "timeUnit": "minute"
          }
        },
        {
          "apiSource": "ai-gateway-v1",
          "llmOperations": [
            {
              "resource": "/auto:*",
              "methods": [
                "POST"
              ],
              "model": "auto"
            }
          ],
          "llmTokenQuota": {
            "limit": "20000",
            "interval": "2",
            "timeUnit": "minute"
          }
        },
        {
          "apiSource": "ai-gateway-v1",
          "llmOperations": [
            {
              "resource": "/models/gemini-3.1-flash-lite:*",
              "methods": [
                "POST"
              ],
              "model": "gemini-3.1-flash-lite"
            }
          ],
          "llmTokenQuota": {
            "limit": "2000",
            "interval": "1",
            "timeUnit": "minute"
          }
        },
        {
          "apiSource": "ai-gateway-v1",
          "llmOperations": [
            {
              "resource": "/models/gemini-3-flash-preview:*",
              "methods": [
                "POST"
              ],
              "model": "gemini-3-flash-preview"
            }
          ],
          "llmTokenQuota": {
            "limit": "2000",
            "interval": "1",
            "timeUnit": "minute"
          }
        },
        {
          "apiSource": "ai-gateway-v1",
          "llmOperations": [
            {
              "resource": "/models/claude-haiku-4-5@20251001:*",
              "methods": [
                "POST"
              ],
              "model": "claude-haiku-4-5@20251001"
            }
          ],
          "llmTokenQuota": {
            "limit": "300",
            "interval": "1",
            "timeUnit": "minute"
          }
        }
      ]
    }
  }
};
