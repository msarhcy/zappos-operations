export interface TelemetryEncoder<TPoint, TPayload> {
  version: string;
  contentType: string;
  encode(points: TPoint[]): TPayload;
  decode(payload: TPayload): TPoint[];
}
