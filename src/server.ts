import {createApp} from './app.js';
import {loadConfig} from './config.js';

const config = loadConfig();

createApp(config).listen(config.port, () => {
  console.log(`ShareWay API gateway listening on port ${config.port}`);
});
