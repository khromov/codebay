import { Mochi, silenceInternalRoutes } from 'mochi-framework';
import { routes } from './routes.ts';

const PORT = Number(process.env.PORT) || 3333;

await Mochi.serve({
  port: PORT,
  development: process.env.MODE === 'development',
  htmlShell: './src/shell.html',
  trailingSlash: 'never',
  filters: {
    'consoleLogger:line': silenceInternalRoutes,
  },
  routes,
});

console.log('Server running at http://localhost:' + PORT);
