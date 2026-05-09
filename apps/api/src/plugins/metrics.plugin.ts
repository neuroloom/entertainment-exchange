// Metrics plugin — Prometheus-compatible metrics endpoint at GET /metrics
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

const requestTimers = new WeakMap<FastifyRequest, number>();

interface MetricCounter {
  name: string;
  help: string;
  labels: Map<string, Map<string, Map<string, number>>>; // method -> path -> status -> count
}

interface MetricHistogram {
  name: string;
  help: string;
  buckets: number[];
  samples: Map<string, number[]>; // label combo -> [bucket0, bucket1, ..., bucketN, sum, count]
}

interface MetricGauge {
  name: string;
  help: string;
  value: number;
  getValue: () => number;
}

export async function metricsPlugin(app: FastifyInstance) {
  const startTime = Date.now();

  // --- Counters ---
  const httpRequestsTotal: MetricCounter = {
    name: 'http_requests_total',
    help: 'Total number of HTTP requests',
    labels: new Map(),
  };

  // --- Histograms ---
  const httpRequestDurationMs: MetricHistogram = {
    name: 'http_request_duration_ms',
    help: 'HTTP request duration in milliseconds',
    buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
    samples: new Map(),
  };

  // --- Gauges ---
  const memoryUsageGauge: MetricGauge = {
    name: 'memory_usage_bytes',
    help: 'Process memory usage in bytes',
    value: 0,
    getValue: () => process.memoryUsage().heapUsed,
  };

  const uptimeGauge: MetricGauge = {
    name: 'uptime_seconds',
    help: 'Process uptime in seconds',
    value: 0,
    getValue: () => (Date.now() - startTime) / 1000,
  };

  // Hook to record request metrics
  app.addHook('onRequest', async (req: FastifyRequest) => {
    requestTimers.set(req, Date.now());
  });

  app.addHook('onResponse', async (req: FastifyRequest, reply: FastifyReply) => {
    const method = req.method;
    const path = req.routeOptions?.url ?? req.url.split('?')[0];
    const status = String(reply.statusCode);
    const durationMs = Date.now() - (requestTimers.get(req) ?? Date.now());

    // Increment counter: method -> path -> status -> count
    let methodMap = httpRequestsTotal.labels.get(method);
    if (!methodMap) {
      methodMap = new Map();
      httpRequestsTotal.labels.set(method, methodMap);
    }
    let pathMap = methodMap.get(path);
    if (!pathMap) {
      pathMap = new Map();
      methodMap.set(path, pathMap);
    }
    const currentCount = pathMap.get(status) ?? 0;
    pathMap.set(status, currentCount + 1);

    // Record histogram
    const histKey = `${method}:${path}`;
    let histSamples = httpRequestDurationMs.samples.get(histKey);
    if (!histSamples) {
      // [bucket0, bucket1, ..., bucketN, sum, count]
      histSamples = new Array(httpRequestDurationMs.buckets.length + 2).fill(0);
      httpRequestDurationMs.samples.set(histKey, histSamples);
    }
    // Increment all cumulative buckets (Prometheus cumulative histogram)
    for (let i = 0; i < httpRequestDurationMs.buckets.length; i++) {
      if (durationMs <= httpRequestDurationMs.buckets[i]) {
        for (let j = i; j < httpRequestDurationMs.buckets.length; j++) {
          histSamples[j]++;
        }
        break;
      }
    }
    // If duration exceeds all buckets, it's only in +Inf (no explicit bucket increments needed)
    histSamples[httpRequestDurationMs.buckets.length] += durationMs; // sum
    histSamples[httpRequestDurationMs.buckets.length + 1]++; // count
  });

  // Prometheus text format serializer
  function renderMetrics(): string {
    const lines: string[] = [];

    // Render counters
    lines.push(`# HELP ${httpRequestsTotal.name} ${httpRequestsTotal.help}`);
    lines.push(`# TYPE ${httpRequestsTotal.name} counter`);
    for (const [method, pathMap] of httpRequestsTotal.labels) {
      for (const [path, statusMap] of pathMap) {
        for (const [statusVal, count] of statusMap) {
          lines.push(
            `${httpRequestsTotal.name}{method="${method}",path="${path}",status="${statusVal}"} ${count}`,
          );
        }
      }
    }

    // Render histograms
    lines.push(`# HELP ${httpRequestDurationMs.name} ${httpRequestDurationMs.help}`);
    lines.push(`# TYPE ${httpRequestDurationMs.name} histogram`);
    for (const [label, samples] of httpRequestDurationMs.samples) {
      const colonIdx = label.indexOf(':');
      const method = label.slice(0, colonIdx);
      const path = label.slice(colonIdx + 1);
      const buckets = httpRequestDurationMs.buckets;
      for (let i = 0; i < buckets.length; i++) {
        lines.push(
          `${httpRequestDurationMs.name}_bucket{method="${method}",path="${path}",le="${buckets[i]}"} ${samples[i]}`,
        );
      }
      lines.push(
        `${httpRequestDurationMs.name}_bucket{method="${method}",path="${path}",le="+Inf"} ${samples[buckets.length + 1]}`,
      );
      lines.push(
        `${httpRequestDurationMs.name}_sum{method="${method}",path="${path}"} ${samples[buckets.length]}`,
      );
      lines.push(
        `${httpRequestDurationMs.name}_count{method="${method}",path="${path}"} ${samples[buckets.length + 1]}`,
      );
    }

    // Render gauges
    for (const gauge of [memoryUsageGauge, uptimeGauge]) {
      gauge.value = gauge.getValue();
      lines.push(`# HELP ${gauge.name} ${gauge.help}`);
      lines.push(`# TYPE ${gauge.name} gauge`);
      lines.push(`${gauge.name} ${gauge.value}`);
    }

    return lines.join('\n') + '\n';
  }

  // Expose /metrics endpoint as text/plain
  app.get('/metrics', { logLevel: 'warn' }, async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.header('content-type', 'text/plain; version=0.0.4; charset=utf-8').send(renderMetrics());
  });
}
