# v1 화면 전환 설계 — 레거시 6종을 실 백엔드로 (구간표 저작 포함)

> 2026-07-08 · 상태: 사용자 지시로 작성("알아서 스펙·플랜") · 전신: `2026-07-07-v1-java-postgres-platform-design.md`(구현 완료)
> 범위: **대시보드 · 이벤트 등록(Wizard) · 승인함 · 협의 신청 · 협의 승인 · 협수 관리 · 수수료 결정 흐름(FeeTrace)** 을 mock(zustand)에서 서버 API 기반으로 전환. **국내 옵션 구간별(BANDS) 수수료 저작을 실 모델로 관통**시킨다.

## 1. 배경 — 무엇이 안 되고 있나

- v1 백엔드(Spring Boot+Postgres)는 완성됐지만, 레거시 화면 7종 중 "백엔드 연동(Live)" 탭만 실 API를 쓴다. 나머지는 여전히 mock 스토어(한글 코드값, 구 모델: NegoException·resolve 오버레이)로 동작한다.
- **구간표 갭**: Wizard에 밴드 에디터 UI는 이미 있으나(mock의 '구간표') 저장이 mock에 갇혀 있고, 서버 시드(V2)에 국내파생이 아예 없어 "국내 옵션 = 가격 구간별 정률+정액+최소수수료" 케이스가 실 모델에서 시연·검증 불가. 서버 도메인(FeeCalculator BANDS·jsonb·지배관계 probe)은 이미 지원한다 — **막힌 곳은 시드와 화면→API 연결뿐**.
- 승인함은 사용자가 명시하지 않았으나 Wizard가 만드는 PENDING 룰의 종착점이므로 포함한다(등록 흐름 완결).

비범위: 계좌 조회(Live 탭이 대체)·종목 마스터·정책 우선순위 화면, 프론트 구 도메인 코드(src/domain) 삭제 — 남는 화면이 아직 참조하므로 이번 판에서는 유지.

## 2. 서버 보강 (4건)

### 2.1 V3 시드 — 국내파생 + 구간표 기준선
- 품목: `('DOMESTIC_DERIV','KRX','K200','KOSPI200','KRW',{REGULAR})`
- 요율표 `SCH-DD-BASE`(국내파생 기본): 자사 수수료 = **BANDS 3구간**(구 mock의 KOSPI200 옵션 실구조 — 0~0.42: 14bp+13원 / 0.42~2.47: 15bp / 2.47~: 14.7bp+78원) + 거래소 정액 300원. 룰 `R-BASE-DD`(BASE·ACTIVE).
- `8041-2237-01`에 `DOMESTIC_DERIV` 상품군 개설 추가(셀 유니버스에 K200 선물/옵션 셀 등장).

### 2.2 룰 상태 전이 — `POST /api/rules/{id}/submit`
DRAFT → PENDING. Wizard의 "상신"이 이걸 호출하고, 승인함이 PENDING 목록을 승인/반려한다. approve는 PENDING만 허용(그 외 400).

### 2.3 협의 조회 API 2종
- `GET /api/nego/requests?status=REQUESTED` — request_id 로 묶은 요청 목록(계좌·자격구분·사유·요청자·일시). 협의 승인함 데이터원.
- `GET /api/nego/enrollments` — 활성(NEGOTIATED) 부여 목록(계좌·룰·기간·자격구분). 협수 관리 데이터원.

### 2.4 결정 추적 — `GET /api/trace`
FeeTrace 화면용. 파라미터는 lookup과 동일(계좌·자산군·조회구분·거래소·세션·품목·채널·기준일). 응답:

```json
{
  "candidates": [ { "ruleId","ruleName","ruleType","scheduleId","rank",
                    "scopeMatch": true, "gatePass": false, "gateNote": "enrollment 없음", "winner": false } ],
  "bindingHit": true,
  "applied": { "scheduleId","sourceRuleId","sourceType","fallbackToBase" }
}
```
candidates = 해당 자산군의 활성 룰 전부(랭킹 순) — 탈락 룰과 사유(범위 불일치/기간 밖/대상 아님/enrollment 없음)를 화면이 그대로 보여준다. 도메인(PolicyRanking·ScopeMatcher·EligibilityGate) 재사용, 신규 로직 없음.

## 3. 화면 전환 (7종)

공통: `src/api/client.ts` 사용(타입·라벨 확장), zustand `useStore` import 제거, 표시 한글·전송 영문 코드값. 에러는 problem+json 메시지 그대로 노출.

| 화면 | 데이터원(API) | 액션 | 비고 |
|---|---|---|---|
| 대시보드 | `GET /api/dashboard`, `GET /api/rules` | — | 룰 테이블(상태·타입 필터, 검색) + 집계 카드 + 최근 배정 변경 |
| 이벤트 등록(Wizard) | `GET /api/products`, `GET /api/schedules` | `POST /api/rules`(룰+요율표) → `POST /{id}/validate` → `POST /{id}/submit` | **밴드 에디터 유지**: 구간표 선택 시 from/to/rateBp/flat 행 편집 + minFee. 국내 옵션(K200·OPTIONS) 시나리오가 기준 케이스. 검증 리포트(지배관계 실패 지점·역마진) 표시 후 상신 |
| 승인함 | `GET /api/rules`(PENDING 필터) | `POST /{id}/approve`(400=지배관계 위반 상세 표시) / `reject` | 승인 성공 시 증분 결과(inserted/updated) 표시 |
| 협의 신청 | `GET /api/rules`(NEGOTIATED)·`GET /api/accounts` | `POST /api/nego/requests` | 표준 등급 룰 선택 + 계좌 다건. 서버 자격 자동판정 결과(MET/EXCEPTION) 표시, 미충족은 영업예외 사유 필수. 요율 개별조정 UI 제거(표준등급 모델 — 안내 문구) |
| 협의 승인 | `GET /api/nego/requests?status=REQUESTED` | `POST /requests/{id}/approve`·`reject` | 요청번호 단위 일괄 승인, 승인 후 배정판 증분 결과 표시 |
| 협수 관리 | `GET /api/nego/enrollments`·`GET /api/nego/extension-candidates` | `POST /api/nego/extend` | 그룹(주식형=상품군/파생=품목)별 유지·탈락 + 선택 일괄 연장 |
| 수수료 결정 흐름 | `GET /api/trace` → `GET /api/lookup` → `POST /api/calc` | — | 5단계 재구성: ①조회키 구성 ②후보·게이트(trace) ③승자 ④배정판 히트/미스→기본(§1.4 시각화) ⑤체결 입력→구성요소 명세(구간표는 매칭 구간 하이라이트) |

## 4. 완료 기준

1. 위 7개 탭이 mock 없이 서버만으로 동작(서버 중단 시 명확한 에러 표시).
2. **국내 옵션 E2E**: Wizard에서 K200 OPTIONS 대상 구간표 이벤트(기준선보다 전 구간 저렴) 작성 → 검증 통과 → 상신 → 승인함 승인 → 배정판에 행 생성 → 결정 흐름에서 K200 옵션 조회 시 이벤트 승자·구간 매칭 금액 확인.
3. 역케이스: 특정 구간에서 기준선보다 비싼 구간표는 검증 리포트에 실패 지점(가격·차액) 표시, 승인 400.
4. 서버 테스트(기존 73 + 신규) · 프론트 빌드·테스트 green.
