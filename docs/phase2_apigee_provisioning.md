# Phase 2: provision Apigee for projects that don't have it (planned)

`scripts/bootstrap.sh` assumes an existing Apigee X org. Phase 2 adds
`scripts/provision_apigee.sh` for customers starting from a bare GCP project, following
[Install Apigee using the CLI: non-VPC-peered, Pay-as-you-go](https://docs.cloud.google.com/apigee/docs/api-platform/get-started/install-cli-non-peered-paygo).

Target topology:

| Item | Choice |
| :--- | :--- |
| Billing | Pay-as-you-go |
| Networking | Non-VPC-peered (Private Service Connect), no VPC peering range |
| Environments | `dev` and `prod`, type **Intermediate** |
| Add-ons | API Analytics enabled |
| Runtime location | `GCP_REGION` from `.env` |
| Northbound | Global external HTTPS load balancer -> PSC NEG -> Apigee instance service attachment, Google-managed cert for `APIGEE_HOST_PROD` / `APIGEE_HOST_DEV` |
| Southbound | Cloud Run backends reached over HTTPS with Google ID tokens (no PSC needed) |

Planned steps (each idempotent, polling long-running operations):

1. Enable `apigee.googleapis.com`, `compute.googleapis.com`, `cloudkms.googleapis.com`.
2. Create the PAYG org with `disableVpcPeering: true` and the runtime location.
3. Create the instance (no `ipRange`), wait for `ACTIVE` (~30-45 min).
4. Create `dev` and `prod` environments (`type: INTERMEDIATE`), attach them to the instance.
5. Create the environment groups with the two hostnames and attach the environments.
6. Enable the Analytics add-on for both environments.
7. Northbound: PSC NEG on the instance's `serviceAttachment`, backend service, URL map,
   managed SSL certificate, target HTTPS proxy, global address, forwarding rule. Print the IP
   for the DNS A records.
8. Hand off to `scripts/bootstrap.sh`.
