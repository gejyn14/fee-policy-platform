// ---------------------------------------------------------------------------
// 픽커 선택 상태 순수 로직 (모두 불변 — spread 기반, 입력을 절대 변형하지 않는다)
// ---------------------------------------------------------------------------

export interface Selection {
  products: string[] | '*';
  excludeProducts: string[];
  exchanges: string[] | '*';
}

/** 지정 모드: 선택을 토글한다. 전체(*) 모드: 제외 목록을 토글한다. */
export function toggleCode(s: Selection, code: string): Selection {
  if (s.products === '*') {
    const has = s.excludeProducts.includes(code);
    return {
      ...s,
      excludeProducts: has
        ? s.excludeProducts.filter((c) => c !== code)
        : [...s.excludeProducts, code],
    };
  }
  const has = s.products.includes(code);
  return {
    ...s,
    products: has ? s.products.filter((c) => c !== code) : [...s.products, code],
  };
}

/** 지정 모드로 코드 목록을 merge한다(중복 제거, 제외 목록에서는 삭제). */
export function selectCodes(s: Selection, codes: string[]): Selection {
  const current = s.products === '*' ? [] : s.products;
  const merged = new Set([...current, ...codes]);
  const excludeSet = new Set(codes);
  return {
    ...s,
    products: [...merged],
    excludeProducts: s.excludeProducts.filter((c) => !excludeSet.has(c)),
  };
}

/** 전체 모드로 전환하고 거래소를 설정한다(제외 목록은 유지). */
export function selectAllMode(s: Selection, exchanges: string[] | '*'): Selection {
  return { ...s, products: '*', exchanges };
}

/** 선택 상태를 완전히 초기화한다. */
export function clearSelection(_s: Selection): Selection {
  return { products: [], excludeProducts: [], exchanges: '*' };
}

/** 선택/제외 어느 쪽에 있든 해당 코드를 제거한다. */
export function removeChip(s: Selection, code: string): Selection {
  if (s.products === '*') {
    return { ...s, excludeProducts: s.excludeProducts.filter((c) => c !== code) };
  }
  return { ...s, products: s.products.filter((c) => c !== code) };
}

/** 현재 선택 상태를 요약 문자열로 표현한다. */
export function summarize(s: Selection): string {
  if (s.products === '*') {
    return s.excludeProducts.length > 0 ? `전체 · 제외 ${s.excludeProducts.length}건` : '전체';
  }
  return `지정 ${s.products.length}건`;
}

// ---------------------------------------------------------------------------
// CSV 코드 파서 (canonical home — Wizard.tsx의 구현을 그대로 복사. 이후 태스크에서
// Wizard가 이 함수를 import하도록 갱신되어 순환 참조를 피한다.)
// ---------------------------------------------------------------------------

/** 콤마/개행으로 구분된 코드 목록을 파싱해 유효 코드(accepted)와 무시된 코드(rejected)로 분류한다. */
export function parseCsvCodes(text: string, valid: Set<string>): { accepted: string[]; rejected: string[] } {
  const tokens = text.split(/[,\n]/).map((t) => t.trim()).filter((t) => t.length > 0);
  const accepted: string[] = [];
  const rejected: string[] = [];
  const seenAccepted = new Set<string>();
  const seenRejected = new Set<string>();
  for (const t of tokens) {
    if (valid.has(t)) {
      if (!seenAccepted.has(t)) { seenAccepted.add(t); accepted.push(t); }
    } else if (!seenRejected.has(t)) { seenRejected.add(t); rejected.push(t); }
  }
  return { accepted, rejected };
}
