import { HttpConfig, HttpConfigL1, httpFactory } from "./http";
import ApiErrorInterceptor from "./interceptors/api-error.interceptor";

const Http = httpFactory(HttpConfig);
const HttpL1 = httpFactory(HttpConfigL1);

// Add authorization
// Http.interceptors.request.use(AuthInterceptorFactory((requestConfig: AxiosRequestConfig) => !!AuthHandler.auth));

// Add API error detection
Http.interceptors.response.use((res: any) => res, ApiErrorInterceptor);
HttpL1.interceptors.response.use((res: any) => res, ApiErrorInterceptor);

// Throttled GET: caches responses per URL for 31s to prevent request stampedes
const requestCache = new Map<string, { promise: Promise<any>; timestamp: number }>();
const THROTTLE_MS = 31_000;

function throttledGet(url: string, force = false): Promise<any> {
  const now = Date.now();
  const cached = requestCache.get(url);

  if (!force && cached && (now - cached.timestamp) < THROTTLE_MS) {
    return cached.promise;
  }

  const promise = Http.get(url);
  requestCache.set(url, { promise, timestamp: now });

  return promise;
}

export { Http, HttpL1, throttledGet };
