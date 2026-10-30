import {createApp} from './app.js';
import {loadConfig} from './config.js';
import {createLogger} from './logger.js';

const config = loadConfig();
const logger = createLogger(config.logLevel);

createApp(config, logger).listen(config.port, () => {
  logger.info(
    {
      port: config.port,
      publicUrl: config.publicUrl,
      routes: config.routes.map(route => ({
        service: route.service,
        upstream: route.upstream ?? 'not configured',
        extracted: route.extracted,
      })),
    },
    'ShareWay API gateway listening',
  );
});
