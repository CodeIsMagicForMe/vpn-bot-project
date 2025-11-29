// src/services/vpn-api.ts
import CircuitBreaker from "opossum";
import { config } from "../utils/config";
import { logger } from "../utils/logger";
import { AppError } from "../utils/errors";

export interface VpnConfigItem {
  protocol: "amneziawg" | "vless_reality" | string;
  config_id: string;
  config_text: string;
  qr_data?: string;
  server_ip?: string;
  server_port?: number;
  expires_at?: string;
  connection_limit?: number;
  bandwidth_limit_mbps?: number | null;
  metadata?: Record<string, unknown>;
}

export interface VpnCreateConfigsResponse {
  success: boolean;
  configs?: VpnConfigItem[];
  created_at?: string;
  expires_at?: string;
  error?: {
    code: string;
    message: string;
    retry_after?: number;
    [key: string]: unknown;
  };
}

interface VpnApiRequestOptions {
  endpoint: string;
  body: unknown;
}

class VpnApiClient {
  private breaker: CircuitBreaker<[VpnApiRequestOptions], VpnCreateConfigsResponse>;
  private readonly maxRetries = 3;
  private readonly baseDelayMs = 2000;

  constructor() {
    this.breaker = new CircuitBreaker(
      (options: VpnApiRequestOptions) => this.rawRequest(options),
      {
        timeout: config.vpnApi.timeout,
        errorThresholdPercentage: 50,
        resetTimeout: 30000,
        rollingCountTimeout: 60000,
        name: "VPN-API",
      },
    );

    this.breaker.fallback((options: VpnApiRequestOptions) => {
      logger.warn(
        { endpoint: options.endpoint },
        "VPN API circuit breaker OPEN - returning fallback error",
      );
      return {
        success: false,
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "VPN service temporarily unavailable",
        },
      };
    });

    this.breaker.on("open", () => {
      logger.error("VPN API Circuit Breaker OPENED");
    });

    this.breaker.on("close", () => {
      logger.info("VPN API Circuit Breaker CLOSED");
    });
  }

  async createConfigs(params: {
    userId: number;
    subscriptionId: number;
    allowedDevices: number;
    durationDays: number;
  }): Promise<VpnCreateConfigsResponse> {
    const body = {
      user_id: params.userId,
      subscription_id: params.subscriptionId,
      allowed_devices: params.allowedDevices,
      duration_days: params.durationDays,
      obfuscation_level: "high",
    };

    const res = await this.breaker.fire({
      endpoint: "/configs/create",
      body,
    });

    if (!res.success) {
      throw new AppError(res.error?.message || "VPN config generation failed", {
        code: res.error?.code || "VPN_CONFIG_GENERATION_FAILED",
      });
    }

    return res;
  }

  async revokeConfigs(configIds: string[], reason = "subscription_expired"): Promise<void> {
    if (!configIds.length) return;

    const body = {
      config_ids: configIds,
      reason,
      timestamp: new Date().toISOString(),
    };

    const res = await this.breaker.fire({
      endpoint: "/configs/revoke",
      body,
    });

    if (!res.success) {
      logger.error(
        { configIds, error: res.error },
        "Failed to revoke configs via VPN API",
      );
    }
  }

  private async rawRequest({
    endpoint,
    body,
  }: VpnApiRequestOptions): Promise<VpnCreateConfigsResponse> {
    const url = `${config.vpnApi.url}/api/v1${endpoint}`;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(
          () => controller.abort(),
          config.vpnApi.timeout,
        );

        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${config.vpnApi.tokenPrimary}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (response.status === 503) {
          const retryAfter = response.headers.get("Retry-After");
          const delayMs = retryAfter
            ? Number(retryAfter) * 1000
            : this.baseDelayMs * attempt;

          logger.warn(
            { endpoint, attempt, delayMs },
            "VPN API 503, retrying after delay",
          );
          await new Promise((r) => setTimeout(r, delayMs));
          continue;
        }

        const json = (await response.json()) as VpnCreateConfigsResponse;

        if (!response.ok || json.success === false) {
          const err = new AppError(
            json.error?.message || `VPN API error ${response.status}`,
            {
              code: json.error?.code || "VPN_API_ERROR",
              status: response.status,
              details: json.error,
            },
          );
          throw err;
        }

        return json;
      } catch (err) {
        logger.error(
          { endpoint, attempt, err },
          "VPN API request attempt failed",
        );
        if (attempt === this.maxRetries) {
          throw err;
        }
        await new Promise((r) => setTimeout(r, this.baseDelayMs * attempt));
      }
    }

    // Should never reach here
    throw new AppError("VPN API request failed after retries", {
      code: "VPN_API_RETRY_FAILED",
    });
  }
}

export const vpnApi = new VpnApiClient();

