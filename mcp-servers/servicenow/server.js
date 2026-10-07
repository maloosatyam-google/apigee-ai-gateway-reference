const express = require('express');

const app = express();
app.use(express.json());

// In-memory ServiceNow ITSM Data Store
const INCIDENTS = [
  {
    number: "INC0010001",
    sys_id: "9d38c10f84501a20b784e1b43b679410",
    short_description: "Production database connection latency elevated in us-central1",
    description: "Connection pool saturation detected on PostgreSQL primary cluster. P99 latency exceeding 450ms.",
    priority: "1 - Critical",
    urgency: "1 - High",
    state: "In Progress",
    category: "Cloud Infrastructure",
    caller_id: "it.admin@example.com",
    assigned_to: "SRE On-Call Team",
    sys_created_on: "2026-09-23 14:10:00",
    sys_updated_on: "2026-09-23 15:30:00"
  },
  {
    number: "INC0010002",
    sys_id: "a48b921e73412b31c895f2c54c780521",
    short_description: "Apigee AI Gateway TLS certificate rotation scheduled",
    description: "Quarterly TLS certificate rollover for the API gateway domain.",
    priority: "3 - Moderate",
    urgency: "3 - Low",
    state: "New",
    category: "Network",
    caller_id: "admin@example.com",
    assigned_to: "Security Operations",
    sys_created_on: "2026-09-23 10:00:00",
    sys_updated_on: "2026-09-23 10:00:00"
  },
  {
    number: "INC0010003",
    sys_id: "b59c032f84523c42d906a3d65d891632",
    short_description: "Vertex AI quota threshold alert (85% consumed)",
    description: "Gemini 3.1 Pro token consumption approaching allocated quota for enterprise tier.",
    priority: "2 - High",
    urgency: "2 - Medium",
    state: "In Progress",
    category: "Software",
    caller_id: "sre-lead@google.com",
    assigned_to: "Platform Architecture",
    sys_created_on: "2026-09-23 12:25:00",
    sys_updated_on: "2026-09-23 15:45:00"
  }
];

const CHANGE_REQUESTS = [
  {
    number: "CHG0030001",
    short_description: "Scale Cloud SQL read replicas from 2 to 4 in us-central1",
    type: "Standard",
    state: "Scheduled",
    risk: "Low",
    planned_start: "2026-09-24 04:00:00",
    planned_end: "2026-09-24 05:00:00"
  },
  {
    number: "CHG0030002",
    short_description: "Apply Apigee Proxy Policy updates for MCP Governance",
    type: "Normal",
    state: "Approved",
    risk: "Medium",
    planned_start: "2026-09-24 06:00:00",
    planned_end: "2026-09-24 07:00:00"
  }
];

const TOOLS = [
  {
    name: "listIncidents",
    description: "Retrieve a list of active ServiceNow IT incident tickets with optional filtering by priority level and lifecycle state.",
    inputSchema: {
      type: "object",
      properties: {
        priority: {
          type: "string",
          description: "Filter incidents by priority level (e.g., '1 - Critical', '2 - High', '3 - Moderate', '4 - Low')",
          enum: ["1 - Critical", "2 - High", "3 - Moderate", "4 - Low"]
        },
        state: {
          type: "string",
          description: "Filter incidents by ticket state (e.g., 'New', 'In Progress', 'On Hold', 'Resolved', 'Closed')",
          enum: ["New", "In Progress", "On Hold", "Resolved", "Closed"]
        }
      }
    }
  },
  {
    name: "getIncident",
    description: "Look up detailed diagnostic and resolution records for an existing ServiceNow incident by incident number or sys_id.",
    inputSchema: {
      type: "object",
      properties: {
        incidentId: {
          type: "string",
          description: "The ServiceNow incident identifier (e.g. INC0010001 or sys_id)."
        }
      },
      required: ["incidentId"]
    }
  },
  {
    name: "createIncident",
    description: "Submit and create a new incident ticket in ServiceNow ITSM with category, priority, and caller details.",
    inputSchema: {
      type: "object",
      properties: {
        short_description: {
          type: "string",
          description: "Summary or title of the incident issue"
        },
        description: {
          type: "string",
          description: "Full diagnostic description and reproduction steps"
        },
        priority: {
          type: "string",
          description: "Priority level of the incident",
          enum: ["1 - Critical", "2 - High", "3 - Moderate", "4 - Low"]
        },
        urgency: {
          type: "string",
          description: "Urgency rating",
          enum: ["1 - High", "2 - Medium", "3 - Low"]
        },
        category: {
          type: "string",
          description: "IT Category (e.g., Cloud Infrastructure, Network, Software, Database)"
        },
        caller_id: {
          type: "string",
          description: "Email address or username of the reporting user"
        },
        IncidentCreateRequest: {
          type: "object",
          description: "Nested incident creation payload for compatibility"
        }
      }
    }
  },
  {
    name: "updateIncident",
    description: "Partially update an incident's status, work notes, closure notes, or priority level in ServiceNow.",
    inputSchema: {
      type: "object",
      properties: {
        incidentId: {
          type: "string",
          description: "The ServiceNow incident identifier (e.g., INC0010001)."
        },
        state: {
          type: "string",
          description: "Target ticket lifecycle state",
          enum: ["New", "In Progress", "On Hold", "Resolved", "Closed"]
        },
        work_notes: {
          type: "string",
          description: "Internal technician notes or progress updates"
        },
        close_notes: {
          type: "string",
          description: "Resolution notes documenting how the issue was fixed"
        },
        priority: {
          type: "string",
          description: "Updated priority level"
        },
        IncidentUpdateRequest: {
          type: "object",
          description: "Nested incident update payload for compatibility"
        }
      },
      required: ["incidentId"]
    }
  },
  {
    name: "listChangeRequests",
    description: "List scheduled, pending, or approved change requests across IT infrastructure.",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          description: "Filter change requests by type ('Standard', 'Normal', 'Emergency')",
          enum: ["Standard", "Normal", "Emergency"]
        }
      }
    }
  }
];

// Health Check
app.get('/health', (req, res) => {
  res.json({ status: "healthy", service: "servicenow-mcp-server", timestamp: new Date().toISOString() });
});

app.get('/', (req, res) => {
  res.json({ status: "healthy", service: "servicenow-mcp-server", mcp_endpoint: "/mcp" });
});

// OAuth Protected Resource Metadata (RFC 9470)
app.get(['/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-protected-resource/servicenow/mcp'], (req, res) => {
  res.json({
    // Public URL of this MCP server behind Apigee. Set APIGEE_HOST_PROD on the Cloud Run service.
    resource: `https://${process.env.APIGEE_HOST_PROD || "api.example.com"}/servicenow/mcp`,
    authorization_servers: ["https://accounts.google.com/"],
    bearer_methods_supported: ["header"],
    scopes_supported: ["https://www.service-now.com/auth/incident"]
  });
});

// MCP JSON-RPC 2.0 Handler
function handleMcpRequest(req, res) {
  const body = req.body || {};
  const { jsonrpc, id, method, params } = body;

  if (jsonrpc !== "2.0") {
    return res.status(400).json({
      jsonrpc: "2.0",
      id: id || null,
      error: { code: -32600, message: "Invalid Request: jsonrpc must be '2.0'" }
    });
  }

  // 1. initialize
  if (method === "initialize") {
    return res.json({
      jsonrpc: "2.0",
      id: id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: { listChanged: false }
        },
        serverInfo: {
          name: "servicenow-mcp-server",
          version: "1.0.0"
        }
      }
    });
  }

  // 2. notifications/initialized
  if (method === "notifications/initialized") {
    return res.status(200).send();
  }

  // 3. ping
  if (method === "ping") {
    return res.json({
      jsonrpc: "2.0",
      id: id,
      result: {}
    });
  }

  // 4. tools/list
  if (method === "tools/list") {
    return res.json({
      jsonrpc: "2.0",
      id: id,
      result: {
        tools: TOOLS
      }
    });
  }

  // 5. tools/call
  if (method === "tools/call") {
    const toolName = params ? params.name : "";
    const rawArgs = (params && params.arguments && typeof params.arguments === "object") ? params.arguments : {};
    // Arguments are produced by an LLM. Coerce the scalar filter/id fields to
    // strings so a numeric value cannot crash the handler (.toLowerCase on a
    // number throws, which Express turns into an HTTP 500).
    const args = { ...rawArgs };
    for (const k of ["priority", "state", "type", "incidentId", "number", "sys_id"]) {
      if (args[k] !== undefined && args[k] !== null && typeof args[k] !== "string") {
        args[k] = String(args[k]);
      }
    }

    // Tool: listIncidents (and snow_list_incidents)
    if (toolName === "listIncidents" || toolName === "snow_list_incidents") {
      let filtered = [...INCIDENTS];
      if (args.priority) {
        filtered = filtered.filter(i => i.priority.toLowerCase().includes(args.priority.toLowerCase()));
      }
      if (args.state) {
        filtered = filtered.filter(i => i.state.toLowerCase() === args.state.toLowerCase());
      }
      return res.json({
        jsonrpc: "2.0",
        id: id,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify({ incidents: filtered, total_count: filtered.length }, null, 2)
            }
          ],
          isError: false
        }
      });
    }

    // Tool: getIncident (and snow_get_incident)
    if (toolName === "getIncident" || toolName === "snow_get_incident") {
      const incId = args.incidentId || args.number || args.sys_id;
      const found = INCIDENTS.find(i => i.number.toLowerCase() === (incId || "").toLowerCase() || i.sys_id === incId);
      if (found) {
        return res.json({
          jsonrpc: "2.0",
          id: id,
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify(found, null, 2)
              }
            ],
            isError: false
          }
        });
      } else {
        return res.json({
          jsonrpc: "2.0",
          id: id,
          result: {
            content: [
              {
                type: "text",
                text: `Incident '${incId}' not found in sys_incident table.`
              }
            ],
            isError: true
          }
        });
      }
    }

    // Tool: createIncident (and snow_create_incident)
    if (toolName === "createIncident" || toolName === "snow_create_incident") {
      const details = args.IncidentCreateRequest || args;
      const randNum = Math.floor(10000 + Math.random() * 90000);
      const newInc = {
        number: `INC00${randNum}`,
        sys_id: Math.random().toString(16).substring(2, 34).padEnd(32, '0'),
        short_description: details.short_description || "Automated Alert Ticket",
        description: details.description || "Reported via Apigee AI Gateway MCP",
        priority: details.priority || "2 - High",
        urgency: details.urgency || "2 - Medium",
        state: "New",
        category: details.category || "Cloud Infrastructure",
        caller_id: details.caller_id || "apigee-agent@google.com",
        assigned_to: "Tier-1 Support Team",
        sys_created_on: new Date().toISOString(),
        sys_updated_on: new Date().toISOString()
      };
      INCIDENTS.push(newInc);

      return res.json({
        jsonrpc: "2.0",
        id: id,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify({ message: "Incident successfully created", incident: newInc }, null, 2)
            }
          ],
          isError: false
        }
      });
    }

    // Tool: updateIncident (and snow_update_incident)
    if (toolName === "updateIncident" || toolName === "snow_update_incident") {
      const rawIncId = args.incidentId || (args.IncidentUpdateRequest && args.IncidentUpdateRequest.incidentId);
      const incId = rawIncId === undefined || rawIncId === null ? rawIncId : String(rawIncId);
      const updates = args.IncidentUpdateRequest || args;
      const existing = INCIDENTS.find(i => i.number.toLowerCase() === (incId || "").toLowerCase() || i.sys_id === incId);

      if (!existing) {
        return res.json({
          jsonrpc: "2.0",
          id: id,
          result: {
            content: [
              {
                type: "text",
                text: `Cannot update: Incident '${incId}' not found.`
              }
            ],
            isError: true
          }
        });
      }

      if (updates.state) existing.state = updates.state;
      if (updates.priority) existing.priority = updates.priority;
      if (updates.work_notes) existing.work_notes = updates.work_notes;
      if (updates.close_notes) existing.close_notes = updates.close_notes;
      existing.sys_updated_on = new Date().toISOString();

      return res.json({
        jsonrpc: "2.0",
        id: id,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify({ message: `Incident ${existing.number} updated successfully`, incident: existing }, null, 2)
            }
          ],
          isError: false
        }
      });
    }

    // Tool: listChangeRequests (and snow_list_change_requests)
    if (toolName === "listChangeRequests" || toolName === "snow_list_change_requests") {
      let filtered = [...CHANGE_REQUESTS];
      if (args.type) {
        filtered = filtered.filter(c => c.type.toLowerCase() === args.type.toLowerCase());
      }
      return res.json({
        jsonrpc: "2.0",
        id: id,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify({ change_requests: filtered, total_count: filtered.length }, null, 2)
            }
          ],
          isError: false
        }
      });
    }

    // Unknown tool
    return res.status(404).json({
      jsonrpc: "2.0",
      id: id,
      error: { code: -32601, message: `Tool not found: ${toolName}` }
    });
  }

  // Unknown method
  return res.status(404).json({
    jsonrpc: "2.0",
    id: id,
    error: { code: -32601, message: `Method not found: ${method}` }
  });
}

app.post('/mcp', handleMcpRequest);
app.post('/', handleMcpRequest);

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`ServiceNow MCP Server listening on port ${PORT}`);
});
