/**
 * Environment Configuration Entry Point
 * 
 * This file exports the unified configuration from config.ts
 * All chain and network settings are now environment-driven.
 */

import envConfig from "./config";
import { isDevModeEnabled } from "./helpers";

// Don't allow proxy on non-dev builds
if (!isDevModeEnabled()) {
  envConfig.api.proxyURL = null;
}

export { envConfig as default };
