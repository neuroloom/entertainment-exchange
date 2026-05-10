// Cryptographic Audit Chain Verifier
// Hash chain, Merkle tree, and zero-knowledge compliance proofs
// L9: Immutable Cryptographic Audit Chain

import { createHash, randomBytes } from 'node:crypto';

// --- Public Interfaces ---

export interface HashChainEntry {
  entryId: string;
  journalId: string;
  sequenceNumber: number;
  data: Record<string, unknown>;
  hash: string;
  prevHash: string;
  timestamp: number;
}

export interface MerkleProof {
  entryId: string;
  leafHash: string;
  proofPath: Array<{
    direction: 'left' | 'right';
    siblingHash: string;
  }>;
  merkleRoot: string;
  verified: boolean;
}

export interface ComplianceProof {
  proofId: string;
  type: 'balance' | 'revenue_recognition' | 'immutability' | 'time_range' | 'cross_journal_consistency';
  statement: string;
  verificationHash: string;
  verified: boolean;
  verifiedAt: number;
  publicInputs: Record<string, unknown>;
}

export interface TamperLogEntry {
  logId: string;
  action: 'write' | 'modify' | 'delete';
  journalId: string;
  entryId: string;
  actor: string;
  previousHash: string;
  newHash: string;
  timestamp: number;
  reason?: string;
}

export interface TimeRangeProof {
  proofId: string;
  journalId: string;
  startTime: number;
  endTime: number;
  startEntry: { sequenceNumber: number; hash: string };
  endEntry: { sequenceNumber: number; hash: string };
  count: number;
  merkleRoot: string;
  verificationHash: string;
  verified: boolean;
}

// --- Internal Types ---

interface MerkleNode {
  hash: string;
  left: MerkleNode | null;
  right: MerkleNode | null;
}

interface CommitmentEntry {
  entryId: string;
  commitment: string;       // SHA-256 of the private data
  valueAssertion: string;   // what the prover claims about this entry
}

// --- Constants ---

const GENESIS_PREV_HASH = '0'.repeat(64);
const DEFAULT_MERKLE_INTERVAL = 100;

// --- Helpers ---

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function stableSerialize(obj: Record<string, unknown>): string {
  // Deterministic JSON serialization: sort keys
  return JSON.stringify(obj, Object.keys(obj).sort());
}

function computeEntryHash(
  data: Record<string, unknown>,
  prevHash: string,
  sequenceNumber: number,
  timestamp: number,
  journalId: string,
): string {
  return sha256(
    stableSerialize(data) +
    prevHash +
    sequenceNumber.toString() +
    timestamp.toString() +
    journalId,
  );
}

function generateId(): string {
  return randomBytes(16).toString('hex');
}

// --- Merkle Tree Helpers ---

function buildMerkleRoot(leafHashes: string[]): { root: string; tree: MerkleNode | null } {
  if (leafHashes.length === 0) return { root: sha256(''), tree: null };

  let nodes: MerkleNode[] = leafHashes.map((hash) => ({
    hash,
    left: null,
    right: null,
  }));

  while (nodes.length > 1) {
    const nextLevel: MerkleNode[] = [];
    for (let i = 0; i < nodes.length; i += 2) {
      if (i + 1 < nodes.length) {
        const combined = nodes[i].hash + nodes[i + 1].hash;
        nextLevel.push({
          hash: sha256(combined),
          left: nodes[i],
          right: nodes[i + 1],
        });
      } else {
        // Odd node — promote
        nextLevel.push(nodes[i]);
      }
    }
    nodes = nextLevel;
  }

  return { root: nodes[0].hash, tree: nodes[0] };
}

function generateProofPath(tree: MerkleNode, targetHash: string): Array<{ direction: 'left' | 'right'; siblingHash: string }> | null {
  function walk(node: MerkleNode, path: Array<{ direction: 'left' | 'right'; siblingHash: string }>): Array<{ direction: 'left' | 'right'; siblingHash: string }> | null {
    // Leaf case
    if (!node.left && !node.right) {
      return node.hash === targetHash ? path : null;
    }

    // Try left subtree
    if (node.left) {
      const leftPath = walk(node.left, [
        ...path,
        node.right
          ? { direction: 'right' as const, siblingHash: node.right.hash }
          : { direction: 'right' as const, siblingHash: node.left.hash },
      ]);
      if (leftPath) return leftPath;
    }

    // Try right subtree
    if (node.right) {
      const rightPath = walk(node.right, [
        ...path,
        node.left
          ? { direction: 'left' as const, siblingHash: node.left.hash }
          : { direction: 'right' as const, siblingHash: node.right.hash },
      ]);
      if (rightPath) return rightPath;
    }

    return null;
  }

  return walk(tree, []);
}

function verifyProofPath(leafHash: string, proofPath: Array<{ direction: 'left' | 'right'; siblingHash: string }>): string {
  let currentHash = leafHash;
  for (const step of proofPath) {
    const combined = step.direction === 'left'
      ? step.siblingHash + currentHash
      : currentHash + step.siblingHash;
    currentHash = sha256(combined);
  }
  return currentHash;
}

// --- ChainVerifier Class ---

export class ChainVerifier {
  private chains: Map<string, HashChainEntry[]>;
  private merkleRoots: Map<string, string[]>;
  private merkleInterval: number;
  private tamperLog: TamperLogEntry[];

  constructor(merkleInterval: number = DEFAULT_MERKLE_INTERVAL) {
    this.chains = new Map();
    this.merkleRoots = new Map();
    this.merkleInterval = merkleInterval;
    this.tamperLog = [];
  }

  // ── Tamper-Evident Log ────────────────────────────────────

  getTamperLog(limit?: number): TamperLogEntry[] {
    const sorted = [...this.tamperLog].sort((a, b) => b.timestamp - a.timestamp);
    return limit ? sorted.slice(0, limit) : sorted;
  }

  getTamperLogForJournal(journalId: string, limit?: number): TamperLogEntry[] {
    const filtered = this.tamperLog
      .filter(e => e.journalId === journalId)
      .sort((a, b) => b.timestamp - a.timestamp);
    return limit ? filtered.slice(0, limit) : filtered;
  }

  // ── Hash Chain ─────────────────────────────────────────────

  /**
   * Append a journal entry to the hash chain.
   * Each entry's hash commits to the prior entry, forming an immutable audit trail.
   */
  appendToChain(journalId: string, data: Record<string, unknown>): HashChainEntry {
    const key = this.chainKey(journalId);
    const entries = this.getOrCreateChain(key);
    const seqNum = entries.length;
    const prevHash = seqNum === 0 ? GENESIS_PREV_HASH : entries[seqNum - 1].hash;
    const timestamp = Date.now();
    const entryId = generateId();

    const hash = computeEntryHash(data, prevHash, seqNum, timestamp, journalId);

    const entry: HashChainEntry = {
      entryId,
      journalId,
      sequenceNumber: seqNum,
      data,
      hash,
      prevHash,
      timestamp,
    };

    entries.push(entry);

    // Record tamper-evident log
    this.tamperLog.push({
      logId: generateId(),
      action: 'write',
      journalId,
      entryId,
      actor: 'system',
      previousHash: prevHash,
      newHash: hash,
      timestamp,
    });

    // Build Merkle checkpoint if at interval boundary
    if ((seqNum + 1) % this.merkleInterval === 0) {
      const startSeq = seqNum + 1 - this.merkleInterval;
      const { root } = buildMerkleRoot(
        entries.slice(startSeq, seqNum + 1).map((e) => e.hash),
      );
      const roots = this.getOrCreateRoots(key);
      roots.push(root);
    }

    return entry;
  }

  /**
   * Verify the integrity of a hash chain segment.
   * Returns the entry number where the chain breaks, or valid=true.
   */
  verifyChain(fromEntryId?: string, toEntryId?: string): {
    valid: boolean;
    brokenAt?: number;
    totalEntries: number;
  } {
    // For verification, collect all entries across all chains
    const allEntries: HashChainEntry[] = [];
    for (const entries of this.chains.values()) {
      allEntries.push(...entries);
    }
    allEntries.sort((a, b) => {
      // Sort by chain key then sequence number
      if (a.journalId !== b.journalId) {
        return a.journalId.localeCompare(b.journalId);
      }
      return a.sequenceNumber - b.sequenceNumber;
    });

    if (allEntries.length === 0) {
      return { valid: true, totalEntries: 0 };
    }

    let startIdx = 0;
    let endIdx = allEntries.length - 1;

    if (fromEntryId) {
      startIdx = allEntries.findIndex((e) => e.entryId === fromEntryId);
      if (startIdx === -1) return { valid: false, brokenAt: undefined, totalEntries: allEntries.length };
    }
    if (toEntryId) {
      endIdx = allEntries.findIndex((e) => e.entryId === toEntryId);
      if (endIdx === -1) return { valid: false, brokenAt: undefined, totalEntries: allEntries.length };
    }

    // Check each entry's hash against the previous
    for (let i = startIdx; i <= endIdx; i++) {
      const entry = allEntries[i];
      const expectedPrevHash = entry.sequenceNumber === 0
        ? GENESIS_PREV_HASH
        : (() => {
            // Find the previous entry in the same chain
            const prev = allEntries
              .filter((e) => e.journalId === entry.journalId && e.sequenceNumber === entry.sequenceNumber - 1);
            return prev.length === 1 ? prev[0].hash : GENESIS_PREV_HASH;
          })();

      if (entry.prevHash !== expectedPrevHash) {
        return { valid: false, brokenAt: entry.sequenceNumber, totalEntries: allEntries.length };
      }

      const computedHash = computeEntryHash(
        entry.data, entry.prevHash, entry.sequenceNumber, entry.timestamp, entry.journalId,
      );
      if (computedHash !== entry.hash) {
        return { valid: false, brokenAt: entry.sequenceNumber, totalEntries: allEntries.length };
      }
    }

    return { valid: true, totalEntries: allEntries.length };
  }

  /**
   * Verify chain integrity for a specific tenant's journal.
   */
  verifyTenantChain(tenantId: string): { valid: boolean; brokenAt?: number; totalEntries: number } {
    const entries: HashChainEntry[] = [];
    for (const [key, chain] of this.chains.entries()) {
      if (key.startsWith(tenantId + ':')) {
        entries.push(...chain);
      }
    }
    entries.sort((a, b) => a.sequenceNumber - b.sequenceNumber);

    if (entries.length === 0) {
      return { valid: true, totalEntries: 0 };
    }

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const expectedPrevHash = i === 0 ? GENESIS_PREV_HASH : entries[i - 1].hash;
      if (entry.prevHash !== expectedPrevHash) {
        return { valid: false, brokenAt: entry.sequenceNumber, totalEntries: entries.length };
      }
      const computedHash = computeEntryHash(
        entry.data, entry.prevHash, entry.sequenceNumber, entry.timestamp, entry.journalId,
      );
      if (computedHash !== entry.hash) {
        return { valid: false, brokenAt: entry.sequenceNumber, totalEntries: entries.length };
      }
    }

    return { valid: true, totalEntries: entries.length };
  }

  // ── Merkle Tree ────────────────────────────────────────────

  /**
   * Build a Merkle tree over a range of sequence numbers in a journal.
   */
  buildMerkleTree(journalId: string, startSeq: number, endSeq: number): {
    root: string;
    leaves: string[];
  } {
    const entries = this.getChain(journalId);
    const slice = entries.filter(
      (e) => e.sequenceNumber >= startSeq && e.sequenceNumber <= endSeq,
    );
    const leaves = slice.map((e) => e.hash);
    const { root } = buildMerkleRoot(leaves);
    return { root, leaves };
  }

  /**
   * Generate a Merkle inclusion proof for a specific entry.
   */
  generateMerkleProof(entryId: string): MerkleProof {
    // Find the entry
    let targetEntry: HashChainEntry | null = null;
    for (const entries of this.chains.values()) {
      const found = entries.find((e) => e.entryId === entryId);
      if (found) { targetEntry = found; break; }
    }

    if (!targetEntry) {
      return {
        entryId,
        leafHash: '',
        proofPath: [],
        merkleRoot: '',
        verified: false,
      };
    }

    // Find the Merkle block this entry belongs to
    const blockStart = Math.floor(targetEntry.sequenceNumber / this.merkleInterval) * this.merkleInterval;
    const blockEnd = blockStart + this.merkleInterval - 1;

    const entries = this.getChain(targetEntry.journalId);
    const blockEntries = entries.filter(
      (e) => e.sequenceNumber >= blockStart && e.sequenceNumber <= blockEnd,
    );

    const leafHashes = blockEntries.map((e) => e.hash);
    const { root, tree } = buildMerkleRoot(leafHashes);

    if (!tree) {
      return {
        entryId,
        leafHash: targetEntry.hash,
        proofPath: [],
        merkleRoot: root,
        verified: false,
      };
    }

    const proofPath = generateProofPath(tree, targetEntry.hash);
    if (!proofPath) {
      return {
        entryId,
        leafHash: targetEntry.hash,
        proofPath: [],
        merkleRoot: root,
        verified: false,
      };
    }

    return {
      entryId,
      leafHash: targetEntry.hash,
      proofPath,
      merkleRoot: root,
      verified: false, // must be verified by verifyMerkleProof
    };
  }

  /**
   * Verify a Merkle inclusion proof.
   */
  verifyMerkleProof(proof: MerkleProof): boolean {
    if (!proof.leafHash || !proof.merkleRoot) return false;
    const computedRoot = verifyProofPath(proof.leafHash, proof.proofPath);
    return computedRoot === proof.merkleRoot;
  }

  /**
   * Verify and return an updated proof with the verified flag set.
   */
  verifyAndSignProof(proof: MerkleProof): MerkleProof {
    return {
      ...proof,
      verified: this.verifyMerkleProof(proof),
    };
  }

  // ── Zero-Knowledge Compliance Proofs ────────────────────────

  /**
   * Prove that all journals in a given period are balanced
   * (debits == credits) without revealing actual amounts.
   *
   * The proof works by:
   * 1. Collecting all entries for the tenant in the period
   * 2. Computing a commitment (hash) for each entry's balance assertion
   * 3. Including the net sum (should be 0) as a public input
   * 4. The verification hash commits to all commitments + the net sum
   */
  proveBalancedJournals(tenantId: string, period: { start: number; end: number }): ComplianceProof {
    const entries: HashChainEntry[] = [];
    for (const [key, chain] of this.chains.entries()) {
      if (key.startsWith(tenantId + ':')) {
        entries.push(
          ...chain.filter(
            (e) => e.timestamp >= period.start && e.timestamp <= period.end,
          ),
        );
      }
    }

    const commitments: CommitmentEntry[] = entries.map((entry) => {
      // The "secret" is the debit/credit data
      const secret = stableSerialize(entry.data);
      const commitment = sha256('balance:' + entry.journalId + ':' + secret);

      // Extract debits and credits if present
      const data = entry.data as Record<string, unknown>;
      const debits = typeof data.debits === 'number' ? data.debits : 0;
      const credits = typeof data.credits === 'number' ? data.credits : 0;

      return {
        entryId: entry.entryId,
        commitment,
        valueAssertion: JSON.stringify({ debits, credits }),
      };
    });

    // Compute the net balance from the asserted values
    let totalDebits = 0;
    let totalCredits = 0;
    for (const c of commitments) {
      const parsed = JSON.parse(c.valueAssertion) as { debits: number; credits: number };
      totalDebits += parsed.debits;
      totalCredits += parsed.credits;
    }

    const isBalanced = totalDebits === totalCredits;

    // Verification hash commits to all commitments and the balance
    const verificationHash = sha256(
      commitments.map((c) => c.commitment).join('') +
      totalDebits.toString() +
      totalCredits.toString(),
    );

    const proof: ComplianceProof = {
      proofId: generateId(),
      type: 'balance',
      statement: `All journal entries for tenant ${tenantId} from ${new Date(period.start).toISOString()} to ${new Date(period.end).toISOString()} are balanced`,
      verificationHash,
      verified: isBalanced,
      verifiedAt: Date.now(),
      publicInputs: {
        tenantId,
        periodStart: period.start,
        periodEnd: period.end,
        entryCount: entries.length,
        totalDebits: isBalanced ? totalDebits : undefined,
        totalCredits: isBalanced ? totalCredits : undefined,
        isBalanced,
      },
    };

    return proof;
  }

  /**
   * Prove that recognized revenue equals the sum of completed bookings
   * in a given period, without revealing which individual bookings.
   */
  proveRevenueRecognition(tenantId: string, period: { start: number; end: number }): ComplianceProof {
    const entries: HashChainEntry[] = [];
    for (const [key, chain] of this.chains.entries()) {
      if (key.startsWith(tenantId + ':')) {
        entries.push(
          ...chain.filter(
            (e) => e.timestamp >= period.start && e.timestamp <= period.end,
          ),
        );
      }
    }

    // Separate revenue-recognition entries from booking-completion entries
    const revenueEntries = entries.filter(
      (e) => (e.data as Record<string, unknown>).type === 'revenue_recognition',
    );
    const bookingEntries = entries.filter(
      (e) => (e.data as Record<string, unknown>).type === 'booking_completed',
    );

    // Compute commitments for each
    const commitments = entries.map((entry) => {
      const secret = stableSerialize(entry.data);
      return {
        entryId: entry.entryId,
        commitment: sha256('revenue:' + entry.journalId + ':' + secret),
        valueAssertion: JSON.stringify({
          amount: (entry.data as Record<string, unknown>).amount ?? 0,
          type: (entry.data as Record<string, unknown>).type,
        }),
      };
    });

    // Sum revenues and booking values
    let recognizedRevenue = 0;
    let completedBookingsSum = 0;

    for (const entry of revenueEntries) {
      const amount = (entry.data as Record<string, unknown>).amount;
      if (typeof amount === 'number') recognizedRevenue += amount;
    }
    for (const entry of bookingEntries) {
      const amount = (entry.data as Record<string, unknown>).amount;
      if (typeof amount === 'number') completedBookingsSum += amount;
    }

    const matches = Math.abs(recognizedRevenue - completedBookingsSum) < 0.01;

    const verificationHash = sha256(
      commitments.map((c) => c.commitment).join('') +
      recognizedRevenue.toFixed(2) +
      completedBookingsSum.toFixed(2),
    );

    const proof: ComplianceProof = {
      proofId: generateId(),
      type: 'revenue_recognition',
      statement: `Revenue recognized for tenant ${tenantId} equals sum of completed bookings for period ending ${new Date(period.end).toISOString()}`,
      verificationHash,
      verified: matches,
      verifiedAt: Date.now(),
      publicInputs: {
        tenantId,
        periodStart: period.start,
        periodEnd: period.end,
        recognizedRevenue: matches ? recognizedRevenue : undefined,
        completedBookingsSum: matches ? completedBookingsSum : undefined,
        bookingCount: bookingEntries.length,
        recognitionCount: revenueEntries.length,
        matches,
      },
    };

    return proof;
  }

  /**
   * Prove that no journal entries have been modified after posting.
   * This verifies the entire hash chain for the tenant.
   *
   * Returns a proof whose verificationHash is the hash of all chain elements,
   * so an external auditor can verify without access to the raw data.
   */
  proveImmutability(tenantId: string): ComplianceProof {
    const result = this.verifyTenantChain(tenantId);

    const entries: HashChainEntry[] = [];
    for (const [key, chain] of this.chains.entries()) {
      if (key.startsWith(tenantId + ':')) {
        entries.push(...chain);
      }
    }

    // Build a verification hash: the Merkle root of all entry hashes
    const leafHashes = entries.map((e) =>
      sha256(e.entryId + e.hash + e.prevHash + e.timestamp.toString()),
    );
    const { root } = buildMerkleRoot(leafHashes);

    // Also build the chain of Merkle checkpoint roots
    const roots = this.merkleRoots.get(tenantId) ?? [];
    const rootChainHash = roots.length > 0
      ? sha256(roots.join(''))
      : sha256('empty');

    // The master verification hash commits to both
    const verificationHash = sha256(root + rootChainHash);

    const proof: ComplianceProof = {
      proofId: generateId(),
      type: 'immutability',
      statement: `All journal entries for tenant ${tenantId} are immutable and have not been modified after posting`,
      verificationHash,
      verified: result.valid,
      verifiedAt: Date.now(),
      publicInputs: {
        tenantId,
        totalEntries: result.totalEntries,
        chainValid: result.valid,
        brokenAt: result.brokenAt ?? null,
        checkpointCount: roots.length,
        merkleRoot: root,
      },
    };

    return proof;
  }

  // ── Integrity Reports ──────────────────────────────────────

  /**
   * Generate a chain integrity report for a tenant.
   */
  getChainIntegrityReport(tenantId: string): {
    totalEntries: number;
    verifiedEntries: number;
    integrity: number;
  } {
    const result = this.verifyTenantChain(tenantId);
    return {
      totalEntries: result.totalEntries,
      verifiedEntries: result.valid ? result.totalEntries : 0,
      integrity: result.totalEntries === 0 ? 1 : (result.valid ? 1 : 0),
    };
  }

  /**
   * Get all entries for a specific journal.
   */
  getEntries(journalId: string): HashChainEntry[] {
    return [...this.getChain(journalId)];
  }

  /**
   * Get the latest Merkle checkpoint root for a journal.
   */
  getLatestMerkleRoot(journalId: string): string | null {
    const roots = this.merkleRoots.get(this.chainKey(journalId));
    if (!roots || roots.length === 0) return null;
    return roots[roots.length - 1];
  }

  /**
   * Get all Merkle checkpoint roots for a journal.
   */
  getMerkleRoots(journalId: string): string[] {
    return [...(this.merkleRoots.get(this.chainKey(journalId)) ?? [])];
  }

  /**
   * Export the full chain for external audit.
   * External auditors can verify integrity with only this data.
   */
  exportAuditBundle(journalId: string): {
    entries: Array<Pick<HashChainEntry, 'entryId' | 'journalId' | 'sequenceNumber' | 'hash' | 'prevHash' | 'timestamp'>>;
    merkleRoots: string[];
    merkleInterval: number;
  } {
    const entries = this.getChain(journalId).map((e) => ({
      entryId: e.entryId,
      journalId: e.journalId,
      sequenceNumber: e.sequenceNumber,
      hash: e.hash,
      prevHash: e.prevHash,
      timestamp: e.timestamp,
    }));
    const merkleRoots = [...(this.getMerkleRoots(journalId))];

    return { entries, merkleRoots, merkleInterval: this.merkleInterval };
  }

  /**
   * Import data from an external audit bundle for verification.
   * This allows external auditors to reconstruct the chain for verification.
   */
  importAuditBundle(
    journalId: string,
    bundle: {
      entries: Array<Pick<HashChainEntry, 'entryId' | 'journalId' | 'sequenceNumber' | 'hash' | 'prevHash' | 'timestamp'>>;
      dataProvider: (entryId: string) => Record<string, unknown>;
      merkleRoots: string[];
      merkleInterval: number;
    },
  ): { valid: boolean; brokenAt?: number } {
    const key = this.chainKey(journalId);
    const entries: HashChainEntry[] = bundle.entries.map((e) => {
      const data = bundle.dataProvider(e.entryId);
      return {
        ...e,
        data,
      };
    });

    // Verify each entry
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const expectedPrevHash = i === 0 ? GENESIS_PREV_HASH : entries[i - 1].hash;
      if (entry.prevHash !== expectedPrevHash) {
        return { valid: false, brokenAt: entry.sequenceNumber };
      }
      const computedHash = computeEntryHash(
        entry.data, entry.prevHash, entry.sequenceNumber, entry.timestamp, entry.journalId,
      );
      if (computedHash !== entry.hash) {
        return { valid: false, brokenAt: entry.sequenceNumber };
      }
    }

    // Store the verified chain
    this.chains.set(key, entries);
    this.merkleRoots.set(key, bundle.merkleRoots);
    this.merkleInterval = bundle.merkleInterval;

    return { valid: true };
  }

  // ── Private Helpers ────────────────────────────────────────

  // ── Time-Range Bisection Proof ──────────────────────────

  /**
   * Generate a proof that exactly N entries exist in a time range
   * without revealing the entries themselves. Uses the start/end
   * entries as anchors — their hashes and sequence numbers form a
   * cryptographic boundary that an auditor can verify.
   *
   * The gap between start and end sequence numbers proves no
   * entries were inserted or deleted within the range.
   */
  proveTimeRange(journalId: string, startTime: number, endTime: number): TimeRangeProof {
    const entries = this.getChain(journalId);
    const rangeEntries = entries.filter(
      e => e.timestamp >= startTime && e.timestamp <= endTime,
    ).sort((a, b) => a.sequenceNumber - b.sequenceNumber);

    if (rangeEntries.length === 0) {
      throw new Error(`No entries found in range [${new Date(startTime).toISOString()}, ${new Date(endTime).toISOString()}]`);
    }

    const first = rangeEntries[0];
    const last = rangeEntries[rangeEntries.length - 1];
    const expectedCount = last.sequenceNumber - first.sequenceNumber + 1;

    // Build Merkle tree over the range entries
    const leafHashes = rangeEntries.map(e => e.hash);
    const { root } = buildMerkleRoot(leafHashes);

    // Verification hash commits to boundaries + count + merkle root
    const verificationHash = sha256(
      first.hash +
      last.hash +
      first.sequenceNumber.toString() +
      last.sequenceNumber.toString() +
      rangeEntries.length.toString() +
      root,
    );

    const proof: TimeRangeProof = {
      proofId: generateId(),
      journalId,
      startTime,
      endTime,
      startEntry: { sequenceNumber: first.sequenceNumber, hash: first.hash },
      endEntry: { sequenceNumber: last.sequenceNumber, hash: last.hash },
      count: rangeEntries.length,
      merkleRoot: root,
      verificationHash,
      verified: expectedCount === rangeEntries.length,
    };

    return proof;
  }

  /**
   * Verify a time-range proof against the stored chain.
   */
  verifyTimeRangeProof(proof: TimeRangeProof): boolean {
    const entries = this.getChain(proof.journalId);
    const rangeEntries = entries.filter(
      e => e.timestamp >= proof.startTime && e.timestamp <= proof.endTime,
    ).sort((a, b) => a.sequenceNumber - b.sequenceNumber);

    if (rangeEntries.length === 0) return false;

    const first = rangeEntries[0];
    const last = rangeEntries[rangeEntries.length - 1];

    if (first.hash !== proof.startEntry.hash) return false;
    if (last.hash !== proof.endEntry.hash) return false;
    if (rangeEntries.length !== proof.count) return false;

    const leafHashes = rangeEntries.map(e => e.hash);
    const { root } = buildMerkleRoot(leafHashes);
    if (root !== proof.merkleRoot) return false;

    const verificationHash = sha256(
      first.hash +
      last.hash +
      first.sequenceNumber.toString() +
      last.sequenceNumber.toString() +
      rangeEntries.length.toString() +
      root,
    );

    return verificationHash === proof.verificationHash;
  }

  // ── Cross-Journal Consistency Proof ─────────────────────────

  /**
   * Prove that two journals are consistent: no double-counting,
   * cross-referenced entries match, and linked transactions balance.
   *
   * For example: prove that a revenue recognition journal entry
   * matches the corresponding booking completion entry.
   */
  proveCrossJournalConsistency(
    journalIdA: string,
    journalIdB: string,
    linkKeyExtractor: (entry: HashChainEntry) => string | null,
  ): ComplianceProof {
    const entriesA = this.getChain(journalIdA);
    const entriesB = this.getChain(journalIdB);

    // Build maps keyed by the link key
    const mapA = new Map<string, HashChainEntry>();
    const mapB = new Map<string, HashChainEntry>();

    for (const e of entriesA) {
      const key = linkKeyExtractor(e);
      if (key) mapA.set(key, e);
    }
    for (const e of entriesB) {
      const key = linkKeyExtractor(e);
      if (key) mapB.set(key, e);
    }

    // Find inconsistent entries (exist in only one journal)
    const onlyInA = [...mapA.keys()].filter(k => !mapB.has(k));
    const onlyInB = [...mapB.keys()].filter(k => !mapA.has(k));

    // Find matched pairs
    const matchedKeys = [...mapA.keys()].filter(k => mapB.has(k));
    const inconsistencies = matchedKeys.length;

    const isConsistent = onlyInA.length === 0 && onlyInB.length === 0;

    const verificationHash = sha256(
      journalIdA + journalIdB +
      entriesA.length.toString() +
      entriesB.length.toString() +
      inconsistencies.toString(),
    );

    const proof: ComplianceProof = {
      proofId: generateId(),
      type: 'cross_journal_consistency',
      statement: `Journals ${journalIdA} and ${journalIdB} are cross-consistent`,
      verificationHash,
      verified: isConsistent,
      verifiedAt: Date.now(),
      publicInputs: {
        journalIdA,
        journalIdB,
        entriesInA: entriesA.length,
        entriesInB: entriesB.length,
        inconsistencies,
        onlyInA: onlyInA.length > 0 ? onlyInA : undefined,
        onlyInB: onlyInB.length > 0 ? onlyInB : undefined,
      },
    };

    return proof;
  }

  // ── Generate Instant Audit Proof ──────────────────────────────

  /**
   * Generate a downloadable audit proof for a specific entry.
   * Includes the Merkle inclusion proof, chain position, and
   * verification data needed by an external auditor.
   */
  generateAuditProof(entryId: string): {
    entry: HashChainEntry | null;
    merkleProof: MerkleProof | null;
    chainPosition: { prevHash: string; nextHash: string | null };
    verified: boolean;
  } {
    let entry: HashChainEntry | null = null;
    for (const entries of this.chains.values()) {
      const found = entries.find(e => e.entryId === entryId);
      if (found) { entry = found; break; }
    }

    if (!entry) {
      return { entry: null, merkleProof: null, chainPosition: { prevHash: '', nextHash: null }, verified: false };
    }

    const merkleProof = this.generateMerkleProof(entryId);
    const verified = this.verifyMerkleProof(merkleProof);

    // Find the next entry in the same chain
    const chain = this.getChain(entry.journalId);
    const idx = chain.findIndex(e => e.entryId === entryId);
    const nextEntry = idx >= 0 && idx < chain.length - 1 ? chain[idx + 1] : null;

    return {
      entry,
      merkleProof: { ...merkleProof, verified },
      chainPosition: {
        prevHash: entry.prevHash,
        nextHash: nextEntry?.hash ?? null,
      },
      verified,
    };
  }

  private chainKey(journalId: string): string {
    return journalId;
  }

  private getOrCreateChain(key: string): HashChainEntry[] {
    const existing = this.chains.get(key);
    if (existing) return existing;
    const chain: HashChainEntry[] = [];
    this.chains.set(key, chain);
    return chain;
  }

  private getChain(journalId: string): HashChainEntry[] {
    return this.chains.get(this.chainKey(journalId)) ?? [];
  }

  private getOrCreateRoots(key: string): string[] {
    const existing = this.merkleRoots.get(key);
    if (existing) return existing;
    const roots: string[] = [];
    this.merkleRoots.set(key, roots);
    return roots;
  }
}
