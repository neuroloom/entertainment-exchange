// Slack integration — webhook notifications for key platform events
export interface SlackConfig {
  tenantId: string;
  webhookUrl: string;
  channel?: string;
  events: string[];
  enabled: boolean;
}

const configs: SlackConfig[] = [];

export const slackService = {
  setConfig(config: SlackConfig): void {
    const idx = configs.findIndex(c => c.tenantId === config.tenantId);
    if (idx >= 0) configs[idx] = config;
    else configs.push(config);
  },

  getConfig(tenantId: string): SlackConfig | undefined {
    return configs.find(c => c.tenantId === tenantId);
  },

  deleteConfig(tenantId: string): boolean {
    const idx = configs.findIndex(c => c.tenantId === tenantId);
    if (idx === -1) return false;
    configs.splice(idx, 1);
    return true;
  },

  async notify(tenantId: string, event: string, data: Record<string, unknown>): Promise<boolean> {
    const config = configs.find(c => c.tenantId === tenantId && c.enabled && c.events.includes(event));
    if (!config) return false;

    const blocks = formatSlackMessage(event, data);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(config.webhookUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: config.channel,
          username: 'EntEx',
          icon_emoji: ':ticket:',
          blocks,
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      return res.ok;
    } catch {
      return false;
    }
  },
};

function formatSlackMessage(event: string, data: Record<string, unknown>) {
  const ts = new Date().toISOString();

  switch (event) {
    case 'booking.confirmed':
      return [
        { type: 'header', text: { type: 'plain_text', text: ':white_check_mark: Booking Confirmed', emoji: true } },
        { type: 'section', fields: [
          { type: 'mrkdwn', text: `*Event:*\n${data.eventName ?? data.eventType}` },
          { type: 'mrkdwn', text: `*Date:*\n${data.eventDate}` },
          { type: 'mrkdwn', text: `*Amount:*\n$${(Number(data.quotedAmountCents) / 100).toFixed(2)}` },
          { type: 'mrkdwn', text: `*Status:*\n${data.status}` },
        ] },
        { type: 'context', elements: [{ type: 'plain_text', text: `Booking ID: ${data.id} | ${ts}` }] },
      ];
    case 'booking.cancelled':
      return [
        { type: 'header', text: { type: 'plain_text', text: ':x: Booking Cancelled', emoji: true } },
        { type: 'section', fields: [
          { type: 'mrkdwn', text: `*Event:*\n${data.eventName ?? data.eventType}` },
          { type: 'mrkdwn', text: `*Date:*\n${data.eventDate}` },
        ] },
        { type: 'context', elements: [{ type: 'plain_text', text: `Booking ID: ${data.id} | ${ts}` }] },
      ];
    case 'deal.completed':
      return [
        { type: 'header', text: { type: 'plain_text', text: ':handshake: Deal Closed', emoji: true } },
        { type: 'section', fields: [
          { type: 'mrkdwn', text: `*Amount:*\n$${(Number(data.amountCents) / 100).toFixed(2)}` },
          { type: 'mrkdwn', text: `*Status:*\n${data.status}` },
        ] },
        { type: 'context', elements: [{ type: 'plain_text', text: `Deal ID: ${data.id} | ${ts}` }] },
      ];
    default:
      return [
        { type: 'section', text: { type: 'mrkdwn', text: `*${event}*\n\`\`\`${JSON.stringify(data, null, 2)}\`\`\`` } },
      ];
  }
}
