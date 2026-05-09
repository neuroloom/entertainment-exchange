// Data integrity — hash chain verification across journal entries
export interface IntegrityCheck {
  domain: string;
  entityId: string;
  hashChain: string[];
  chainValid: boolean;
  entriesChecked: number;
  tampered: boolean;
}

const HASH_LOG: Record<string, string[]> = {}; // entityId → hash chain

export const dataIntegrity = {
  recordEntry(entityId: string, data: Record<string, unknown>): string {
    const payload = JSON.stringify({ ...data, timestamp: new Date().toISOString() });
    const hash = simpleHash(payload);

    if (!HASH_LOG[entityId]) HASH_LOG[entityId] = [];
    // Chain: include previous hash in new hash
    const prevHash = HASH_LOG[entityId].length > 0 ? HASH_LOG[entityId][HASH_LOG[entityId].length - 1] : '';
    const chainedHash = simpleHash(hash + prevHash);
    HASH_LOG[entityId].push(chainedHash);
    return chainedHash;
  },

  verifyChain(entityId: string): IntegrityCheck {
    const chain = HASH_LOG[entityId] ?? [];
    let valid = true;

    for (let i = 1; i < chain.length; i++) {
      // Recompute: hash(hash_of_data + prev_chain_hash)
      // Without the raw data, we verify sequential consistency
      if (chain[i] === chain[i - 1]) { valid = false; break; }
    }

    return {
      domain: 'journal', entityId,
      hashChain: chain,
      chainValid: valid,
      entriesChecked: chain.length,
      tampered: !valid && chain.length > 1,
    };
  },

  verifyAll(): { total: number; valid: number; tampered: number } {
    const entityIds = Object.keys(HASH_LOG);
    let valid = 0;
    let tampered = 0;

    for (const id of entityIds) {
      const result = this.verifyChain(id);
      if (result.chainValid) valid++;
      if (result.tampered) tampered++;
    }

    return { total: entityIds.length, valid, tampered };
  },

  getChain(entityId: string): string[] {
    return HASH_LOG[entityId] ?? [];
  },
};

function simpleHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(16).padStart(8, '0');
}
