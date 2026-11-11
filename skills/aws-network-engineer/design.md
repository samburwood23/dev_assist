# VPC and topology design

## CIDR planning

- Get the organisation's IPAM plan (or AWS VPC IPAM pools) first. Never pick CIDRs that overlap on-prem,
  other VPCs or partner networks: overlaps block peering, TGW routing and VPN later.
- Default VPC size /16 to /20 per environment per region. Leave room: you can add secondary CIDRs, but
  not shrink, and some ranges (e.g. 172.17.0.0/16 used by Docker) cause local conflicts.
- Subnets per tier per AZ, sized for the largest consumer: EKS pods with the VPC CNI consume one IP each,
  so give them large private subnets or a secondary CIDR (100.64.0.0/10 is common for pods).
- AWS reserves 5 IPs in every subnet.

## Standard layout (per VPC)

- At least 2 AZs, 3 for production.
- Tiers: public (ALB, NAT GW), private app, private data, and optionally a small subnet for TGW attachments.
- One route table per tier per AZ when routing differs by AZ (per-AZ NAT); otherwise per tier.
- NAT Gateway per AZ for production (avoid cross-AZ dependency); one shared NAT is acceptable for dev to save cost.
- Gateway endpoints for S3 and DynamoDB (free). Interface endpoints for ECR, STS, SSM, CloudWatch Logs and
  Secrets Manager when workloads are private or egress is restricted; consider centralising them in a
  shared-services VPC with Route 53 private hosted zones.

## Connecting VPCs

| Need                                              | Choose                                    |
|---------------------------------------------------|-------------------------------------------|
| A handful of VPCs, simple, lowest latency/cost    | VPC peering (non-transitive)              |
| Many VPCs / accounts, central inspection, hybrid  | Transit Gateway, one route table per security domain (prod, non-prod, shared, inspection) |
| Expose one service to many consumers, overlapping CIDRs OK | PrivateLink (NLB/GWLB + endpoint service) |
| Service-to-service across accounts at app layer   | VPC Lattice                               |
| Share subnets across accounts in an org           | RAM-shared subnets (VPC sharing)          |

## Hybrid

- Site-to-Site VPN: two tunnels per connection, BGP preferred over static; terminate on TGW for multi-VPC.
- Direct Connect: redundant connections in separate locations for production; DX gateway + transit VIF to TGW;
  VPN over DX or MACsec if encryption in transit is required.
- DNS: Route 53 Resolver inbound endpoints for on-prem to resolve AWS private zones, outbound endpoints and
  rules for AWS to resolve on-prem domains. Share rules through RAM.

## Egress and inspection

- Centralised egress VPC with NAT + AWS Network Firewall behind TGW, appliance mode enabled on that attachment.
- Ingress through ALB/NLB in the workload VPC with WAF on the ALB; avoid routing ingress through central inspection unless required.
- IPv6: egress-only internet gateway for outbound-only IPv6; DNS64/NAT64 for IPv6-only subnets.

## Deliverable

When proposing a design, give: a CIDR table (VPC, subnets per AZ and tier), a route table summary per tier,
a connectivity diagram in Mermaid, the cost drivers, and the IaC module structure.
