const http = require('http');
const app = require('./app');
const { initializeWebSocket } = require('./services/websocket');
const db = require('./config/database');
const redis = require('./config/redis');
const logger = require('./utils/logger');

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    // Test database connection
    await db.query('SELECT NOW()');
    logger.info('Database connected successfully');

    // Test Redis connection
    await redis.ping();
    logger.info('Redis connected successfully');

    // Create HTTP server
    const server = http.createServer(app);

    // Initialize WebSocket
    initializeWebSocket(server);
    logger.info('WebSocket initialized');

    // Start server
    server.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });

    // Graceful shutdown
    process.on('SIGTERM', async () => {
      logger.info('SIGTERM received. Shutting down gracefully...');
      
      server.close(async () => {
        logger.info('HTTP server closed');
        await db.pool.end();
        await redis.quit();
        logger.info('Database and Redis connections closed');
        process.exit(0);
      });
    });

    process.on('SIGINT', async () => {
      logger.info('SIGINT received. Shutting down gracefully...');
      
      server.close(async () => {
        logger.info('HTTP server closed');
        await db.pool.end();
        await redis.quit();
        logger.info('Database and Redis connections closed');
        process.exit(0);
      });
    });

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
