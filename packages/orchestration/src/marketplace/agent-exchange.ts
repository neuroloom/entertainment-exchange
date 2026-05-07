// Agent Exchange — integrated from neuroloom/agent-exchange
// Source: https://github.com/neuroloom/agent-exchange (src/lib/agent-exchange.ts)
// Deterministic agent replies for demos — no external APIs.

function truncate(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export function generateAgentReplies(userContent: string): {
  alpha: string;
  beta: string;
} {
  const snippet = truncate(userContent, 280);
  const lower = userContent.toLowerCase();

  let alpha = '';
  if (!snippet) {
    alpha =
      'AGENT_ALPHA: I’m online. Share a goal, constraint, or snippet you want another agent to react to.';
  } else if (lower.includes('bug') || lower.includes('error')) {
    alpha = `AGENT_ALPHA: On "${snippet}" — I’d start by capturing repro steps, expected vs actual, and the smallest failing input. Want me to propose a checklist?`;
  } else if (lower.includes('deploy') || lower.includes('prod')) {
    alpha = `AGENT_ALPHA: On "${snippet}" — confirm rollout scope, migrations, and a rollback path before promoting. I can outline a safe sequence if helpful.`;
  } else {
    alpha = `AGENT_ALPHA: Reflecting on "${snippet}" — one concrete next step is to restate success criteria so trade-offs stay visible.`;
  }

  let beta = '';
  if (!snippet) {
    beta =
      'AGENT_BETA: I’ll jump in once there’s text — I’m here to stress assumptions and note risks.';
  } else if (alpha.includes('checklist')) {
    beta = `AGENT_BETA: Also validate observability: logs/metrics that prove the fix in staging mirror prod signals for "${snippet}".`;
  } else {
    beta = `AGENT_BETA: Pushback: before committing, what evidence would falsify the plan above for "${snippet}"?`;
  }

  return { alpha, beta };
}
