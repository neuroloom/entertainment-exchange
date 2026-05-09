// IP allowlisting — tenant-level IP/CIDR restrictions for API key access
export interface IpAllowlist {
  tenantId: string;
  entries: IpEntry[];
  defaultMode: 'allow' | 'deny';  // allow=whitelist, deny=blacklist
  enabled: boolean;
}

export interface IpEntry {
  cidr: string;
  description: string;
  addedAt: string;
}

const allowlists = new Map<string, IpAllowlist>();

function ipToNumber(ip: string): number {
  const parts = ip.split('.').map(Number);
  return ((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3];
}

function cidrMatch(ip: string, cidr: string): boolean {
  const [range, bits] = cidr.split('/');
  const mask = ~((1 << (32 - parseInt(bits, 10))) - 1);
  const ipNum = ipToNumber(ip);
  const rangeNum = ipToNumber(range);
  return (ipNum & mask) === (rangeNum & mask);
}

export const ipAllowlist = {
  get(tenantId: string): IpAllowlist {
    return allowlists.get(tenantId) ?? { tenantId, entries: [], defaultMode: 'allow', enabled: false };
  },

  addEntry(tenantId: string, cidr: string, description: string): IpAllowlist {
    const list = this.get(tenantId);
    if (list.entries.find(e => e.cidr === cidr)) return list;
    list.entries.push({ cidr, description, addedAt: new Date().toISOString() });
    allowlists.set(tenantId, list);
    return list;
  },

  removeEntry(tenantId: string, cidr: string): boolean {
    const list = this.get(tenantId);
    const idx = list.entries.findIndex(e => e.cidr === cidr);
    if (idx === -1) return false;
    list.entries.splice(idx, 1);
    return true;
  },

  setMode(tenantId: string, mode: 'allow' | 'deny', enabled: boolean): IpAllowlist {
    const list = this.get(tenantId);
    list.defaultMode = mode;
    list.enabled = enabled;
    allowlists.set(tenantId, list);
    return list;
  },

  isAllowed(tenantId: string, ip: string): boolean {
    const list = this.get(tenantId);
    if (!list.enabled || list.entries.length === 0) return true;

    const matched = list.entries.some(e => cidrMatch(ip, e.cidr));

    if (list.defaultMode === 'allow') {
      // Whitelist: must match an entry
      return matched;
    } else {
      // Blacklist: must NOT match any entry
      return !matched;
    }
  },
};
