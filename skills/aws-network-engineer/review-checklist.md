# Network IaC review checklist

Report findings as: severity (high / medium / low), file:line, what is wrong, the fix.

## Security

- [ ] No security group ingress from `0.0.0.0/0` or `::/0` except 80/443 on an internet-facing load balancer.
- [ ] No SSH (22) / RDP (3389) / database ports open to broad CIDRs; prefer SSM Session Manager.
- [ ] SG rules reference other SGs instead of CIDRs where possible within a VPC.
- [ ] Egress is not wide open where the workload has a known, small set of destinations (or there is a reason).
- [ ] Default security group of each VPC restricts all traffic.
- [ ] NACLs, if customised, allow return traffic on ephemeral ports 1024-65535.
- [ ] VPC Flow Logs enabled (at least REJECT) to CloudWatch Logs or S3.
- [ ] Public subnets do not auto-assign public IPs unless intended (`map_public_ip_on_launch`).
- [ ] Databases and caches in private subnets with `publicly_accessible = false`.

## Resilience

- [ ] Subnets in at least 2 AZs (3 for production) with matching resources in each.
- [ ] Per-AZ NAT Gateway and route tables in production.
- [ ] TGW attachments and interface endpoints have a subnet in every AZ that uses them.
- [ ] VPN has both tunnels configured; DX has a redundant connection or VPN backup.

## Correctness

- [ ] CIDRs do not overlap any other VPC, on-prem or peered range (check against IPAM).
- [ ] Every private subnet route table has the intended default route (NAT, TGW or none).
- [ ] Peering / TGW routes exist in both directions.
- [ ] `enable_dns_support` and `enable_dns_hostnames` are true when using private hosted zones or PrivateLink private DNS.
- [ ] Route 53 private zones are associated with every VPC that needs them.
- [ ] Load balancer health check path/port matches the target; target SG allows the LB.

## Cost

- [ ] Interface endpoints are not duplicated in every VPC when they could be centralised.
- [ ] Gateway endpoints used for S3 and DynamoDB instead of NAT.
- [ ] Cross-AZ and inter-region traffic is intentional.
- [ ] Unused Elastic IPs, NAT gateways or TGW attachments removed.

## Maintainability

- [ ] CIDRs and AZs come from variables / IPAM, not hard-coded in many places.
- [ ] Consistent tagging (Name, Environment, Owner, CostCenter).
- [ ] `lifecycle { create_before_destroy = true }` on security groups that are referenced elsewhere, to avoid replacement deadlocks.
