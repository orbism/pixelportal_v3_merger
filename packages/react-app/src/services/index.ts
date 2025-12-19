import { HttpConfig, HttpConfigL1, httpFactory } from "./http";
import ApiErrorInterceptor from "./interceptors/api-error.interceptor";

const Http = httpFactory(HttpConfig);
const HttpL1 = httpFactory(HttpConfigL1);

// Add authorization
// Http.interceptors.request.use(AuthInterceptorFactory((requestConfig: AxiosRequestConfig) => !!AuthHandler.auth));

// Add API error detection
Http.interceptors.response.use((res: any) => res, ApiErrorInterceptor);
HttpL1.interceptors.response.use((res: any) => res, ApiErrorInterceptor);

export { Http, HttpL1 };
