/** Settings of the gateway, read from environment variables. */
export interface GatewayConfig {
  port: number;
  jwtSecret: string;
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
): GatewayConfig {
  return {
    port: Number(env.PORT ?? 8000),
    jwtSecret: required(env, 'JWT_SECRET'),
  };
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}
