// 백엔드(Spring Boot) REST 클라이언트. 프론트는 /api/* 로만 호출한다(vite 프록시 → :8080).
// problem+json 에러를 파싱해 사람이 읽을 메시지로 던진다.

export class ApiError extends Error {
  status: number;
  detail?: unknown;
  constructor(status: number, message: string, detail?: unknown) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

async function handle(res: Response): Promise<unknown> {
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = (body && (body.detail || body.title)) || `요청 실패 (${res.status})`;
    throw new ApiError(res.status, msg, body?.detail_data);
  }
  return body;
}

export const api = {
  get: <T>(path: string): Promise<T> =>
    fetch(path).then(handle) as Promise<T>,
  post: <T>(path: string, body?: unknown): Promise<T> =>
    fetch(path, {
      method: 'POST',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }).then(handle) as Promise<T>,
};

// ---- 서버 DTO 타입 ----
export type SourceType = 'BASE' | 'EVENT' | 'NEGOTIATED';

export interface Account {
  id: string; name: string; grade: string; dormantReturned: boolean;
  metric6mAsset: number; metric6mVolume: number;
}

export interface BindingRow {
  accountId: string; assetClass: string; exchangeCode: string; lookupKey: string;
  sessionCode: string; productCode: string; channelCode: string;
  validFrom: string; validTo: string; scheduleId: string; sourceRuleId: string;
  sourceType: SourceType; reason: string;
}

export interface HistoryRow {
  historyId: number; accountId: string; assetClass: string; lookupKey: string; productCode: string;
  oldScheduleId: string | null; oldSourceRuleId: string | null; oldType: string | null;
  newScheduleId: string | null; newSourceRuleId: string | null; newType: string | null;
  triggerSource: string; reason: string | null; changedAt: string;
}

export interface Dashboard {
  activeRules: number; pendingRules: number; activeNego: number; bindingRows: number;
  recentChanges: { accountId: string; assetClass: string; lookupKey: string;
    newSourceType: string; triggerSource: string; changedAt: string }[];
}

export interface BatchResult { inserted: number; updated: number; deleted: number; unchanged: number }

export interface LookupResponse {
  scheduleId: string; sourceRuleId: string; sourceType: SourceType; fallbackToBase: boolean;
}
