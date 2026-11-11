# Connectivity troubleshooting: walk the packet path

Work through the hops in order and stop at the first one that drops the traffic. Check BOTH directions:
security groups are stateful, NACLs and route tables are not.

## 0. Read the symptom

| Symptom                         | Most likely layer                                                  |
|---------------------------------|--------------------------------------------------------------------|
| Timeout / hangs                 | Security group, NACL, route, missing NAT/IGW, firewall appliance   |
| Connection refused (RST)        | Reached the host; service not listening or bound to 127.0.0.1      |
| NXDOMAIN / resolves to wrong IP | DNS: private hosted zone association, resolver rules, split-horizon |
| Works from some AZs/subnets only| Per-subnet route table or NACL, per-AZ NAT or endpoint             |
| Intermittent                    | Asymmetric routing, ephemeral ports in NACL, conntrack/NLB idle timeout, MTU |
| Large transfers stall, small OK | MTU / PMTUD: ICMP "fragmentation needed" (type 3 code 4) blocked, often over VPN or TGW (8500 MTU) |

## 1. Name resolution

- `dig <name>` / `nslookup <name>` from the source. Private IP expected?
- Private hosted zone associated with the source VPC (and cross-account authorization done)?
- VPC attributes `enableDnsSupport` and `enableDnsHostnames` both true (required for PrivateLink private DNS)?
- Hybrid: Route 53 Resolver inbound/outbound endpoints and forwarding rules shared (RAM) and associated?
- Interface endpoint with private DNS on: the public service name should resolve to the endpoint ENI IPs.

## 2. Source side

- Source ENI's security group: outbound rule allowing destination port/CIDR (or SG)?
- Source subnet NACL: outbound to destination port AND inbound for return traffic on ephemeral ports 1024-65535.
- Source subnet route table: longest-prefix match for the destination. Target is what you expect
  (local, pcx-, tgw-, nat-, igw-, vgw-, vpce-, eni-)? Any blackhole routes?
- Lambda / Fargate / EKS pods: they use the ENI's SG and subnet; EKS custom networking or security
  groups for pods change which SG applies.

## 3. In between

- **Peering**: routes on both sides, no overlapping CIDRs, no transitive routing (A-B-C does not work),
  SG references across peering need same region.
- **Transit Gateway**: attachment exists in a subnet in each AZ used; attachment associated with the right TGW
  route table; destination propagated or statically routed there; return path in the other route table;
  appliance mode on for stateful inspection VPCs.
- **NAT Gateway**: in a public subnet whose route table has 0.0.0.0/0 to an IGW; private subnet routes 0.0.0.0/0 to it.
- **VPN / Direct Connect**: BGP up and advertising the prefixes (`describe-vpn-connections` tunnel status),
  route propagation enabled on the VPC route table, on-prem firewall allows return traffic, prefix limits not exceeded.
- **Network Firewall / third-party appliances**: symmetric routing through the same AZ endpoint; check its logs.

## 4. Destination side

- Destination SG inbound allows source CIDR or source SG (SG references do not work across TGW or VPN; use CIDRs).
- Destination subnet NACL inbound on the port and outbound on ephemeral ports.
- Load balancer: listener port, target group health checks passing, targets' SG allows the LB's SG (ALB) or
  the client IPs (NLB with client IP preservation), cross-zone settings.
- Service actually listening on the right interface: `ss -lntp` on the host.

## 5. Prove it

- **Reachability Analyzer** (static config analysis, no packets sent):
  ```bash
  aws ec2 create-network-insights-path --source <eni-or-instance-id> --destination <id> --protocol tcp --destination-port <port>
  aws ec2 start-network-insights-analysis --network-insights-path-id <nip-id>
  aws ec2 describe-network-insights-analyses --network-insights-analysis-ids <nia-id>
  ```
  The `ExplanationCode` on a failed analysis names the blocking component. Creating a path is a write (cheap,
  but say so), and each analysis is billed.
- **VPC Flow Logs**: `REJECT` means SG or NACL dropped it; `ACCEPT` outbound with no matching return means
  the far side or return path is the problem. No record at all usually means routing never got it there.
- **From the host**: `nc -vz <host> <port>`, `curl -v`, `traceroute -T -p <port>`, `tracepath` for MTU.
  Use SSM Session Manager to get a shell without opening SSH.
