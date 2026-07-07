import type { TelemetryEncoder } from "./encoder";
import { JSON_ENCODER_VERSION, type TelemetryPoint } from "./types";

export class JSONTelemetryEncoderV1 implements TelemetryEncoder<TelemetryPoint, TelemetryPoint[]> {
  version = JSON_ENCODER_VERSION;
  contentType = "application/json";

  encode(points: TelemetryPoint[]) {
    return points.map((point) => ({ ...point, encoder_version: this.version }));
  }

  decode(payload: TelemetryPoint[]) {
    return payload.map((point) => ({ ...point }));
  }
}
