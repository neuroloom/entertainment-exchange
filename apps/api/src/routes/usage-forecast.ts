// Usage forecast routes — predict future API consumption
import { params } from '../plugins/requestContext.js';
import type { FastifyInstance } from 'fastify';
import { usageForecast } from '../services/usage-forecast.service.js';

export async function usageForecastRoutes(app: FastifyInstance) {
  app.get('/usage/forecasts', async (req, reply) => {
    const ctx = req.ctx;
    reply.send({ data: usageForecast.listForecasts(ctx.tenantId) });
  });

  app.get('/usage/forecasts/:metric', async (req, reply) => {
    const ctx = req.ctx;
    const forecast = usageForecast.forecast(ctx.tenantId, params(req).metric);
    reply.send({ data: forecast ?? { message: 'Insufficient data for forecast' } });
  });
}
