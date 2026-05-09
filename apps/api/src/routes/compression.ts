// Compression analysis routes — Content-Encoding support
import type { FastifyInstance } from 'fastify';

export async function compressionRoutes(app: FastifyInstance) {
  app.get('/system/compression', async (req, reply) => {
    const acceptEncoding = req.headers['accept-encoding'] ?? '';
    const supported: Record<string, boolean> = {
      gzip: acceptEncoding.includes('gzip'),
      br: acceptEncoding.includes('br'),
      deflate: acceptEncoding.includes('deflate'),
      identity: true,
    };

    const clientSupports = Object.entries(supported).filter(([, v]) => v).map(([k]) => k);

    reply.send({
      data: {
        clientEncoding: acceptEncoding || 'none',
        supported: clientSupports,
        recommended: supported.br ? 'br' : supported.gzip ? 'gzip' : 'identity',
        serverCapabilities: ['gzip', 'deflate', 'identity'],
      },
    });
  });
}
