// EntEx — Fastify API Server
// ADR-001: Fastify-first MVP with domain boundaries preserved for Cloudflare later
import Fastify from 'fastify';
import { v4 as uuid } from 'uuid';
import type { RequestContext } from './plugins/requestContext.js';
import { errorHandlerPlugin } from './plugins/errorHandler.js';
import { rateLimitPlugin } from './plugins/rate-limit.plugin.js';
import { loggerPlugin } from './plugins/logger.plugin.js';
import { metricsPlugin } from './plugins/metrics.plugin.js';
import { healthPlugin } from './plugins/health.plugin.js';
import { sanitizePlugin } from './plugins/sanitize.plugin.js';
import { authPlugin } from './plugins/auth.plugin.js';
import { hydrateAllStores, migrateForward, setCurrentTraceId } from './services/repo.js';
import { apiKeyService } from './services/api-keys.service.js';
import { ipAllowlist } from './services/ip-allowlist.service.js';
import { usageMeter } from './services/usage-meter.service.js';
import { slaMonitor } from './services/sla-monitor.service.js';
import { anomalyAlerts } from './services/anomaly-alerts.service.js';
import { authRoutes } from './routes/auth.js';
import { businessRoutes } from './routes/business.js';
import { bookingRoutes } from './routes/booking.js';
import { ledgerRoutes } from './routes/ledger.js';
import { agentRoutes } from './routes/agent.js';
import { marketplaceRoutes } from './routes/marketplace.js';
import { rightsRoutes } from './routes/rights.js';
import { webhookRoutes } from './routes/webhooks.js';
import { searchRoutes } from './routes/search.js';
import { exportRoutes } from './routes/export.js';
import { activityRoutes } from './routes/activity.js';
import { settingsRoutes } from './routes/settings.js';
import { rateCardRoutes } from './routes/rate-cards.js';
import { splitRoutes } from './routes/splits.js';
import { recurringRoutes } from './routes/recurring.js';
import { notificationRoutes } from './routes/notifications.js';
import { apiKeyRoutes } from './routes/api-keys.js';
import { taxRoutes } from './routes/tax.js';
import { checkInRoutes } from './routes/check-in.js';
import { paymentLinkRoutes } from './routes/payment-links.js';
import { contractRoutes } from './routes/contracts.js';
import { exchangeRateRoutes } from './routes/exchange-rates.js';
import { gdprRoutes } from './routes/gdpr.js';
import { usageRoutes } from './routes/usage.js';
import { billingRoutes } from './routes/billing.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { realtimeRoutes } from './routes/realtime.js';
import { attachmentRoutes } from './routes/attachments.js';
import { slackRoutes } from './routes/slack.js';
import { importRoutes } from './routes/import.js';
import { archivalRoutes } from './routes/archival.js';
import { reportRoutes } from './routes/reports.js';
import { sessionRoutes } from './routes/sessions.js';
import { auditReportRoutes } from './routes/audit-reports.js';
import { rateLimitConfigRoutes } from './routes/rate-limits.js';
import { customFieldRoutes } from './routes/custom-fields.js';
import { onboardingRoutes } from './routes/onboarding.js';
import { totpRoutes } from './routes/totp.js';
import { apiVersionRoutes } from './routes/api-versions.js';
import { oauthRoutes } from './routes/oauth.js';
import { ipAllowlistRoutes } from './routes/ip-allowlist.js';
import { backupRoutes } from './routes/backup.js';
import { deepHealthRoutes } from './routes/deep-health.js';
import { platformAnalyticsRoutes } from './routes/platform-analytics.js';
import { schedulerRoutes } from './routes/scheduler.js';
import { slaRoutes } from './routes/sla.js';
import { auditStreamRoutes } from './routes/audit-streams.js';
import { abTestRoutes } from './routes/ab-tests.js';
import { migrationRoutes } from './routes/migration.js';
import { idempotencyRoutes } from './routes/idempotency.js';
import { cacheAdminRoutes } from './routes/cache-admin.js';
import { anomalyRoutes } from './routes/anomalies.js';
import { bulkDeleteRoutes } from './routes/bulk-delete.js';
import { eventReplayRoutes } from './routes/event-replay.js';
import { anonymizerRoutes } from './routes/anonymizer.js';
import { webhookDashboardRoutes } from './routes/webhook-dashboard.js';
import { exportScheduleRoutes } from './routes/export-schedules.js';
import { rateLimitAnalyticsRoutes } from './routes/rate-limit-analytics.js';
import { apiKeyAnalyticsRoutes } from './routes/api-key-analytics.js';
import { validationRuleRoutes } from './routes/validation-rules.js';
import { dependencyGraphRoutes } from './routes/dependency-graph.js';
import { passwordResetRoutes } from './routes/password-reset.js';
import { emailVerifyRoutes } from './routes/email-verify.js';
import { auditEnrichmentRoutes } from './routes/audit-enrichment.js';
import { contentNegotiationRoutes } from './routes/content-negotiation.js';
import { featureFlagRoutes } from './routes/feature-flags.js';
import { dataRetentionRoutes } from './routes/data-retention.js';
import { responseCacheRoutes } from './routes/response-cache.js';
import { webhookBatchRoutes } from './routes/webhook-batch.js';
import { deadLetterRoutes } from './routes/dead-letters.js';
import { poolMetricsRoutes } from './routes/pool-metrics.js';
import { meteredBillingRoutes } from './routes/metered-billing.js';
import { activityLogRoutes } from './routes/activity-log.js';
import { circuitBreakerRoutes } from './routes/circuit-breakers.js';
import { batchJobRoutes } from './routes/batch-jobs.js';
import { keyRotationRoutes } from './routes/key-rotation.js';
import { quarantineRoutes } from './routes/quarantine.js';
import { dataIntegrityRoutes } from './routes/data-integrity.js';
import { integrationRoutes } from './routes/integrations.js';
import { riskScoreRoutes } from './routes/risk-scores.js';
import { bodyLimitRoutes } from './routes/body-limits.js';
import { customAlertRoutes } from './routes/custom-alerts.js';
import { complianceRoutes } from './routes/compliance.js';
import { changeLogRoutes } from './routes/change-log.js';
import { mfaRecoveryRoutes } from './routes/mfa-recovery.js';
import { dataClassificationRoutes } from './routes/data-classification.js';
import { usageForecastRoutes } from './routes/usage-forecast.js';
import { webhookCatalogRoutes } from './routes/webhook-catalog.js';
import { auditArchiveRoutes } from './routes/audit-archive.js';
import { bulkUserRoutes } from './routes/bulk-users.js';
import { errorBudgetRoutes } from './routes/error-budget.js';
import { transactionTracerRoutes } from './routes/transaction-tracer.js';
import { integrationSyncRoutes } from './routes/integration-sync.js';
import { dataLineageRoutes } from './routes/data-lineage.js';
import { queryPerfRoutes } from './routes/query-perf.js';
import { rateLimitSimRoutes } from './routes/rate-limit-sim.js';
import { configExportRoutes } from './routes/config-export.js';
import { auditSanitizerRoutes } from './routes/audit-sanitizer.js';
import { sdkMetadataRoutes } from './routes/sdk-metadata.js';
import { sandboxRoutes } from './routes/sandbox.js';
import { keyUsageAlertRoutes } from './routes/key-usage-alerts.js';
import { endpointPopularityRoutes } from './routes/endpoint-popularity.js';
import { errorCategoryRoutes } from './routes/error-categories.js';
import { migrationStatusRoutes } from './routes/migration-status.js';
import { transactionViewRoutes } from './routes/transaction-view.js';
import { dataQualityRoutes } from './routes/data-quality.js';
import { latencyHistogramRoutes } from './routes/latency-histogram.js';
import { benchmarkingRoutes } from './routes/benchmarking.js';
import { securityHeaderRoutes } from './routes/security-headers.js';
import { userRateLimitRoutes } from './routes/user-rate-limits.js';
import { activityDigestRoutes } from './routes/activity-digest.js';
import { webhookReplayRoutes } from './routes/webhook-replay.js';
import { requestSigningRoutes } from './routes/request-signing.js';
import { cacheWarmerRoutes } from './routes/cache-warmer.js';
import { compressionRoutes } from './routes/compression.js';
import { isolationReportRoutes } from './routes/isolation-report.js';
import { rateLimitNotifyRoutes } from './routes/rate-limit-notifications.js';
import { cspReportRoutes } from './routes/csp-reports.js';
import { serviceAccountRoutes } from './routes/service-accounts.js';
import { requestTrackerRoutes } from './routes/request-tracker.js';
import { stripeRoutes } from './routes/stripe.js';

export async function buildServer() {
  const app = Fastify({ logger: true });

  // Request context — decorator + hook directly on root so ALL children inherit
  app.decorateRequest('ctx', null as unknown as RequestContext);
  app.addHook('onRequest', async (req) => {
    // Tenant/business from headers for routing. Permissions come ONLY from verified JWT.
    const isTest = process.env.NODE_ENV === 'test';
    const headerPerms = isTest
      ? (req.headers['x-actor-permissions'] as string)?.split(',').map(s => s.trim()) ?? []
      : [];
    const headerActorId = isTest ? ((req.headers['x-actor-id'] as string) || 'anonymous') : 'anonymous';
    const headerActorType: RequestContext['actor']['type'] = isTest
      ? ((req.headers['x-actor-type'] as string) || 'system') as RequestContext['actor']['type']
      : 'system';

    const traceId = (req.headers['x-trace-id'] as string) ?? uuid();
    req.ctx = {
      requestId: uuid(),
      traceId,
      tenantId: (req.headers['x-tenant-id'] as string) ?? '',
      businessId: (req.headers['x-business-id'] as string) ?? undefined,
      actor: {
        type: headerActorType,
        id: headerActorId,
        userId: headerActorId !== 'anonymous' ? headerActorId : undefined,
        roles: [],
        permissions: headerPerms,
      },
    };
    setCurrentTraceId(traceId);
  });

  // Response hook — emit trace ID and log request duration
  app.addHook('onResponse', async (req, reply) => {
    const ctx = req.ctx;
    if (ctx?.traceId) {
      reply.header('X-Trace-Id', ctx.traceId);
    }
    const duration = Math.round(reply.elapsedTime);
    if (duration > 1000) {
      app.log.warn({ traceId: ctx?.traceId, tenantId: ctx?.tenantId, method: req.method, url: req.url, statusCode: reply.statusCode, responseTime: duration }, 'slow request');
    }
    if (ctx?.tenantId) {
      usageMeter.record(ctx.tenantId, req.url, req.method, reply.statusCode, duration);
      slaMonitor.record(ctx.tenantId, reply.statusCode, duration);
      anomalyAlerts.recordRequest(ctx.tenantId);
    }
  });

  // Error handler — directly on root so ALL children inherit
  await errorHandlerPlugin(app);

  // CORS — allow configured origins (production: set CORS_ORIGINS explicitly)
  const corsOrigins = (process.env.CORS_ORIGINS ?? '').split(',').filter(Boolean);
  if (corsOrigins.length === 0 && process.env.NODE_ENV === 'production') {
    app.log.warn('CORS_ORIGINS not set in production — cross-origin requests will be denied');
  }
  app.addHook('onRequest', async (req, reply) => {
    const origin = req.headers.origin;
    if (!origin) return;
    const allowed = corsOrigins.length > 0 && corsOrigins.includes(origin);
    if (!allowed) return;
    reply.header('Access-Control-Allow-Origin', origin);
    reply.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Tenant-Id, X-Business-Id, X-Actor-Id, X-Actor-Type, X-Actor-Permissions, X-Trace-Id');
    reply.header('Access-Control-Max-Age', '86400');
    if (req.method === 'OPTIONS') {
      reply.status(204).send();
    }
  });

  // API key auth — checked before JWT, provides programmatic access
  app.addHook('onRequest', async (req) => {
    if (req.ctx?.actor?.userId && req.ctx.actor.userId !== 'anonymous') return;
    const apiKeyHeader = req.headers['x-api-key'] as string;
    if (!apiKeyHeader) return;
    const result = await apiKeyService.validateKey(apiKeyHeader);
    if (!result.valid || !result.apiKey) return;
    const key = result.apiKey;

    // IP allowlist check for API key access
    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.ip;
    if (!ipAllowlist.isAllowed(key.tenantId, clientIp)) return;

    const reqCtx = req.ctx;
    if (reqCtx) {
      req.ctx = {
        ...reqCtx,
        tenantId: key.tenantId,
        actor: {
          ...reqCtx.actor,
          type: 'api_key',
          id: key.id,
          userId: `apikey:${key.id}`,
          permissions: key.permissions,
        },
      };
    }
  });

  // Auth plugin — reads Authorization: Bearer and populates ctx
  await authPlugin(app);

  // Sanitize plugin — strips bidi chars, trims strings, blocks XSS in body/query
  await sanitizePlugin(app);

  // L5 PRODUCTION — Observability plugins
  await rateLimitPlugin(app);
  await loggerPlugin(app);
  await metricsPlugin(app);
  await healthPlugin(app);

  // PG migrations + hydration — must run before routes register stores
  try {
    const applied = await migrateForward();
    if (applied.length > 0) app.log.info(`Migrations applied: ${applied.join(', ')}`);
  } catch (err) {
    app.log.warn(`Migrations skipped (no PG?): ${err instanceof Error ? err.message : String(err)}`);
  }
  await hydrateAllStores();

  // Wire real email provider into notification service (graceful fallback to console)
  const { emailService } = await import('./services/email.service.js');
  const { notificationService } = await import('./services/notification.service.js');
  const emailProvider = await emailService.getProvider();
  if (emailProvider) notificationService.setEmailProvider(emailProvider);

  // Routes — domain boundaries preserved per service boundary spec
  app.register(authRoutes, { prefix: '/api/v1/auth' });
  app.register(businessRoutes, { prefix: '/api/v1' });
  app.register(bookingRoutes, { prefix: '/api/v1' });
  app.register(ledgerRoutes, { prefix: '/api/v1/ledger' });
  app.register(agentRoutes, { prefix: '/api/v1/agents' });
  app.register(marketplaceRoutes, { prefix: '/api/v1/marketplace' });
  app.register(rightsRoutes, { prefix: '/api/v1/rights' });
  app.register(webhookRoutes, { prefix: '/api/v1' });
  app.register(searchRoutes, { prefix: '/api/v1' });
  app.register(exportRoutes, { prefix: '/api/v1' });
  app.register(activityRoutes, { prefix: '/api/v1' });
  app.register(settingsRoutes, { prefix: '/api/v1' });
  app.register(rateCardRoutes, { prefix: '/api/v1' });
  app.register(splitRoutes, { prefix: '/api/v1' });
  app.register(recurringRoutes, { prefix: '/api/v1' });
  app.register(notificationRoutes, { prefix: '/api/v1' });
  app.register(apiKeyRoutes, { prefix: '/api/v1' });
  app.register(taxRoutes, { prefix: '/api/v1' });
  app.register(checkInRoutes, { prefix: '/api/v1' });
  app.register(paymentLinkRoutes, { prefix: '/api/v1' });
  app.register(contractRoutes, { prefix: '/api/v1' });
  app.register(exchangeRateRoutes, { prefix: '/api/v1' });
  app.register(gdprRoutes, { prefix: '/api/v1' });
  app.register(usageRoutes, { prefix: '/api/v1' });
  app.register(billingRoutes, { prefix: '/api/v1' });
  app.register(dashboardRoutes, { prefix: '/api/v1' });
  app.register(realtimeRoutes, { prefix: '/api/v1' });
  app.register(attachmentRoutes, { prefix: '/api/v1' });
  app.register(slackRoutes, { prefix: '/api/v1' });
  app.register(importRoutes, { prefix: '/api/v1' });
  app.register(archivalRoutes, { prefix: '/api/v1' });
  app.register(reportRoutes, { prefix: '/api/v1' });
  app.register(sessionRoutes, { prefix: '/api/v1' });
  app.register(auditReportRoutes, { prefix: '/api/v1' });
  app.register(rateLimitConfigRoutes, { prefix: '/api/v1' });
  app.register(customFieldRoutes, { prefix: '/api/v1' });
  app.register(onboardingRoutes, { prefix: '/api/v1' });
  app.register(totpRoutes, { prefix: '/api/v1' });
  app.register(apiVersionRoutes, { prefix: '/api/v1' });
  app.register(oauthRoutes, { prefix: '/api/v1' });
  app.register(ipAllowlistRoutes, { prefix: '/api/v1' });
  app.register(backupRoutes, { prefix: '/api/v1' });
  app.register(deepHealthRoutes, { prefix: '/api/v1' });
  app.register(platformAnalyticsRoutes, { prefix: '/api/v1' });
  app.register(schedulerRoutes, { prefix: '/api/v1' });
  app.register(slaRoutes, { prefix: '/api/v1' });
  app.register(auditStreamRoutes, { prefix: '/api/v1' });
  app.register(abTestRoutes, { prefix: '/api/v1' });
  app.register(migrationRoutes, { prefix: '/api/v1' });
  app.register(idempotencyRoutes, { prefix: '/api/v1' });
  app.register(cacheAdminRoutes, { prefix: '/api/v1' });
  app.register(anomalyRoutes, { prefix: '/api/v1' });
  app.register(bulkDeleteRoutes, { prefix: '/api/v1' });
  app.register(rateLimitAnalyticsRoutes, { prefix: '/api/v1' });
  app.register(apiKeyAnalyticsRoutes, { prefix: '/api/v1' });
  app.register(validationRuleRoutes, { prefix: '/api/v1' });
  app.register(dependencyGraphRoutes, { prefix: '/api/v1' });
  app.register(passwordResetRoutes, { prefix: '/api/v1' });
  app.register(emailVerifyRoutes, { prefix: '/api/v1' });
  app.register(auditEnrichmentRoutes, { prefix: '/api/v1' });
  app.register(contentNegotiationRoutes, { prefix: '/api/v1' });
  app.register(featureFlagRoutes, { prefix: '/api/v1' });
  app.register(dataRetentionRoutes, { prefix: '/api/v1' });
  app.register(responseCacheRoutes, { prefix: '/api/v1' });
  app.register(webhookBatchRoutes, { prefix: '/api/v1' });
  app.register(deadLetterRoutes, { prefix: '/api/v1' });
  app.register(poolMetricsRoutes, { prefix: '/api/v1' });
  app.register(meteredBillingRoutes, { prefix: '/api/v1' });
  app.register(activityLogRoutes, { prefix: '/api/v1' });
  app.register(rateLimitNotifyRoutes, { prefix: '/api/v1' });
  app.register(cspReportRoutes, { prefix: '/api/v1' });
  app.register(serviceAccountRoutes, { prefix: '/api/v1' });
  app.register(requestTrackerRoutes, { prefix: '/api/v1' });
  app.register(requestSigningRoutes, { prefix: '/api/v1' });
  app.register(cacheWarmerRoutes, { prefix: '/api/v1' });
  app.register(compressionRoutes, { prefix: '/api/v1' });
  app.register(isolationReportRoutes, { prefix: '/api/v1' });
  app.register(securityHeaderRoutes, { prefix: '/api/v1' });
  app.register(userRateLimitRoutes, { prefix: '/api/v1' });
  app.register(activityDigestRoutes, { prefix: '/api/v1' });
  app.register(webhookReplayRoutes, { prefix: '/api/v1' });
  app.register(endpointPopularityRoutes, { prefix: '/api/v1' });
  app.register(dataQualityRoutes, { prefix: '/api/v1' });
  app.register(latencyHistogramRoutes, { prefix: '/api/v1' });
  app.register(benchmarkingRoutes, { prefix: '/api/v1' });
  app.register(errorCategoryRoutes, { prefix: '/api/v1' });
  app.register(migrationStatusRoutes, { prefix: '/api/v1' });
  app.register(transactionViewRoutes, { prefix: '/api/v1' });
  app.register(auditSanitizerRoutes, { prefix: '/api/v1' });
  app.register(sdkMetadataRoutes, { prefix: '/api/v1' });
  app.register(sandboxRoutes, { prefix: '/api/v1' });
  app.register(keyUsageAlertRoutes, { prefix: '/api/v1' });
  app.register(dataLineageRoutes, { prefix: '/api/v1' });
  app.register(queryPerfRoutes, { prefix: '/api/v1' });
  app.register(rateLimitSimRoutes, { prefix: '/api/v1' });
  app.register(configExportRoutes, { prefix: '/api/v1' });
  app.register(bulkUserRoutes, { prefix: '/api/v1' });
  app.register(errorBudgetRoutes, { prefix: '/api/v1' });
  app.register(transactionTracerRoutes, { prefix: '/api/v1' });
  app.register(integrationSyncRoutes, { prefix: '/api/v1' });
  app.register(dataClassificationRoutes, { prefix: '/api/v1' });
  app.register(usageForecastRoutes, { prefix: '/api/v1' });
  app.register(webhookCatalogRoutes, { prefix: '/api/v1' });
  app.register(auditArchiveRoutes, { prefix: '/api/v1' });
  app.register(customAlertRoutes, { prefix: '/api/v1' });
  app.register(complianceRoutes, { prefix: '/api/v1' });
  app.register(changeLogRoutes, { prefix: '/api/v1' });
  app.register(mfaRecoveryRoutes, { prefix: '/api/v1' });
  app.register(dataIntegrityRoutes, { prefix: '/api/v1' });
  app.register(integrationRoutes, { prefix: '/api/v1' });
  app.register(riskScoreRoutes, { prefix: '/api/v1' });
  app.register(bodyLimitRoutes, { prefix: '/api/v1' });
  app.register(circuitBreakerRoutes, { prefix: '/api/v1' });
  app.register(batchJobRoutes, { prefix: '/api/v1' });
  app.register(keyRotationRoutes, { prefix: '/api/v1' });
  app.register(quarantineRoutes, { prefix: '/api/v1' });
  app.register(eventReplayRoutes, { prefix: '/api/v1' });
  app.register(anonymizerRoutes, { prefix: '/api/v1' });
  app.register(webhookDashboardRoutes, { prefix: '/api/v1' });
  app.register(exportScheduleRoutes, { prefix: '/api/v1' });
  app.register(stripeRoutes, { prefix: '/api/v1' });

  return app;
}

// Start server only when run directly (not when imported)
const isMain = process.argv[1]?.includes('server');
if (isMain) {
  (async () => {
    const PORT = parseInt(process.env.PORT ?? '3000', 10);
    const server = await buildServer();

    // Wait for server to be ready before attaching shutdown handlers
    await server.listen({ port: PORT, host: '0.0.0.0' });
    server.log.info(`EntEx running at ${server.listeningOrigin}`);

    // Graceful shutdown
    async function shutdown(signal: string) {
      server.log.info(`Received ${signal} — shutting down gracefully`);
      try {
        await server.close();
        server.log.info('Server closed');
        process.exit(0);
      } catch (err) {
        server.log.error(`Error during shutdown: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    }

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  })();
}

// Global error boundaries — attempt graceful shutdown before exit
let _shuttingDown = false;

async function gracefulShutdown(server: Awaited<ReturnType<typeof buildServer>> | null) {
  if (_shuttingDown) return;
  _shuttingDown = true;
  try {
    if (server) {
      await Promise.race([
        server.close(),
        new Promise(r => setTimeout(r, 5000)), // 5s timeout
      ]);
    }
    const { closeRepoPool } = await import('./services/repo.js');
    await closeRepoPool();
  } catch { /* best effort */ }
  process.exit(1);
}

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  gracefulShutdown(null);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  gracefulShutdown(null);
});
