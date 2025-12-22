import { SupportedNetwork } from '../alchemy/alchemy.service';

export enum AppEnv {
  development = 'development',
  production = 'production',
  staging = 'staging',
  test = 'test',
}

export interface Configuration {
  port: number;
  appEnv: AppEnv;
  isProd: boolean;
  isStaging: boolean;
  isDev: boolean;
  DEFAULT_NETWORK: SupportedNetwork;
  cb: {
    projectId: string;
    secret: string;
    httpEndpoint: string;
    wsEndpoint: string;
  };
  sentryDns: string;
  pixelContractDeploymentBlockNumber: number;
  twitter: {
    consumerKey: string;
    consumerSecret: string;
    accessToken: string;
    secret: string;
  };
  discord: {
    secret: string;
    channelId: string;
  };
  aws: {
    accessKey: string;
    accessKeySecret: string;
    region: string;
    bucketName: string;
  };
  redis: {
    host: string;
    port: number;
    password: string;
  };
  smtp: {
    host: string;
    port: string;
    user: string;
    pass: string;
    from: string;
  };
  supportEmailRecipients: string;
  nomicsKey: string;
  alchemyKey: string;
  chainAnalysisKey: string;
  blockCypherKey: string;
  phSecret: string;
  dripKey: string;
}

export default () => ({
  port: parseInt(process.env.PORT) || 3000,
  appEnv: (process.env.APP_ENV as AppEnv) || AppEnv.development,
  isProd: (process.env.APP_ENV as AppEnv) === AppEnv.production,
  isStaging: (process.env.APP_ENV as AppEnv) === AppEnv.staging,
  isDev: (process.env.APP_ENV as AppEnv) === AppEnv.development,
  DEFAULT_NETWORK: process.env.DEFAULT_NETWORK as SupportedNetwork,
  cb: {
    projectId: process.env.CB_PROJECT_ID,
    secret: process.env.CB_SECRET,
    httpEndpoint: process.env.CB_HTTP_ENDPOINT,
    wsEndpoint: process.env.CB_WS_ENDPOINT,
  },
  sentryDns: process.env.SENTRY_DNS,
  pixelContractDeploymentBlockNumber:
    parseInt(process.env.CONTRACT_BLOCK_NUMBER_DEPLOYMENT) || 0,
  twitter: {
    consumerKey: process.env.TWITTER_CONSUMER_KEY,
    consumerSecret: process.env.TWITTER_CONSUMER_SECRET,
    accessToken: process.env.TWITTER_ACCESS_TOKEN,
    secret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
  },
  discord: {
    secret: process.env.DISCORD_SECRET,
    channelId: process.env.DISCORD_CHANNEL_ID,
  },
  aws: {
    accessKey: process.env.AWS_ACCESS_KEY,
    accessKeySecret: process.env.AWS_ACCESS_KEY_SECRET,
    region: process.env.AWS_REGION,
    bucketName: process.env.AWS_S3_BUCKET_NAME,
  },
  redis: {
    url: process.env.REDIS_URL,
    // host: process.env.REDIS_HOST,
    // port: parseInt(process.env.REDIS_PORT),
    // password: process.env.REDIS_PASSWORD,
  },
  smtp: {
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.SMTP_FROM,
  },
  supportEmailRecipients: process.env.SUPPORT_EMAIL_RECIPIENTS,
  nomicsKey: process.env.NOMICS_API_KEY,
  alchemyKey: process.env.ALCHEMY_KEY,
  chainAnalysisKey: process.env.CHAINANLYSIS_KEY,
  blockCypherKey: process.env.BLOCKCYPHER_KEY,
  phSecret: process.env.PH_SECRET,
  dripKey: process.env.DRIP_KEY,
});
