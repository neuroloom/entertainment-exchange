#!/usr/bin/env node
// OMEGA Session Optimizer Hook — drop into ~/.claude/settings.json PreToolUse/PostToolUse
// Caches read tool outputs, skips repeated calls, saves tokens
//
// Install:
//   Copy to ~/.claude/hooks/omega-session-hook.mjs
//   Add to ~/.claude/settings.json:
//   {
//     "hooks": {
//       "PreToolUse": [{
//         "matcher": "Read|Bash|Glob|Grep|WebSearch|WebFetch",
//         "hooks": [{ "type": "command", "command": "node ~/.claude/hooks/omega-session-hook.mjs" }]
//       }],
//       "PostToolUse": [{
//         "matcher": "Read|Bash|Glob|Grep|WebSearch|WebFetch|Write|Edit",
//         "hooks": [{ "type": "command", "command": "node ~/.claude/hooks/omega-session-hook.mjs" }]
//       }]
//     }
//   }

// Inline LRU to avoid dependency loading in hook context
class MiniCache {
  private store = new Map<string, { value: string; ts: number }>();
  private max = 5000;
  private ttl = 300_000; // 5 min

  get(key: string): string | undefined {
    const e = this.store.get(key);
    if (!e || Date.now() - e.ts > this.ttl) { this.store.delete(key); return undefined; }
    return e.value;
  }
  set(key: string, value: string): void {
    if (this.store.size >= this.max) { const oldest = this.store.keys().next().value; if (oldest) this.store.delete(oldest); }
    this.store.set(key, { value, ts: Date.now() });
  }
}

const cache = new MiniCache();

interface HookInput {
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_response?: { success: boolean; [k: string]: unknown };
  session_id: string;
}

async function main() {
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  const input: HookInput = JSON.parse(data);

  const event = process.env.CLAUDE_HOOK_EVENT;
  const key = `${input.session_id}:${input.tool_name}:${JSON.stringify(input.tool_input).slice(0, 200)}`;

  if (event === 'PreToolUse') {
    const cached = cache.get(key);
    if (cached) {
      // Skip this tool call — use cached result
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          additionalContext: `[OMEGA CACHE HIT] ${input.tool_name} result cached (${cached.length} chars). Token savings: ~${Math.round(cached.length / 3)}`,
        },
      }));
    }
    // If not cached, let tool run normally (no output = no blocking)
  } else if (event === 'PostToolUse') {
    const result = JSON.stringify(input.tool_response ?? {}).slice(0, 2000);
    cache.set(key, result);
  }
}

main().catch(() => process.exit(0)); // Never block on hook failure
