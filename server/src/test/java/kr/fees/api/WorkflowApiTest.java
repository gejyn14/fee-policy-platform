package kr.fees.api;

import kr.fees.batch.BindingRebuilder;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.LocalDate;

import static org.hamcrest.Matchers.greaterThan;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class WorkflowApiTest extends ApiWebTest {

    private static final String D = "2026-07-07";

    @Autowired BindingRebuilder rebuilder;

    @Test
    void 룰_승인_흐름_검증후_승인시_활성() throws Exception {
        // 시드의 PENDING 이벤트 R-EVT-DS 검증 → 승인
        mvc.perform(post("/api/rules/R-EVT-DS/validate"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.dominanceOk").value(true));

        mvc.perform(post("/api/rules/R-EVT-DS/approve").param("baseDate", D))
            .andExpect(status().isOk());

        mvc.perform(get("/api/rules/R-EVT-DS"))
            .andExpect(jsonPath("$.status").value("ACTIVE"));
    }

    @Test
    void 기안_상신_승인_전이() throws Exception {
        // DRAFT 룰 생성 → 상신(PENDING) → 승인(ACTIVE)
        String rule = """
            {"rule":{"id":"R-DRAFT-1","name":"국내주식 가을 이벤트","type":"EVENT","status":"DRAFT",
              "applyMode":"AUTO_ENROLL","startDate":"2026-07-01","endDate":"2026-10-31","benefitKind":"CALENDAR",
              "scheduleId":"SCH-DS-EVT","scope":{"assetClass":"DOMESTIC_STOCK","excludeProducts":[]}}}""";
        mvc.perform(post("/api/rules").contentType("application/json").content(rule))
            .andExpect(status().isOk());
        // DRAFT 직접 승인은 400
        mvc.perform(post("/api/rules/R-DRAFT-1/approve").param("baseDate", D))
            .andExpect(status().isBadRequest());
        // 상신 → PENDING
        mvc.perform(post("/api/rules/R-DRAFT-1/submit")).andExpect(status().isOk());
        mvc.perform(get("/api/rules/R-DRAFT-1")).andExpect(jsonPath("$.status").value("PENDING"));
        // 승인 → ACTIVE
        mvc.perform(post("/api/rules/R-DRAFT-1/approve").param("baseDate", D)).andExpect(status().isOk());
        mvc.perform(get("/api/rules/R-DRAFT-1")).andExpect(jsonPath("$.status").value("ACTIVE"));
    }

    @Test
    void 협의_신청_승인이_배정판에_반영() throws Exception {
        // 7022-3345-11(자격 충족) 해외주식 협의 신청
        String body = """
            {"accountIds":["7022-3345-11"],"ruleId":"R-NEGO-OS","requestedBy":"tester"}""";
        String resp = mvc.perform(post("/api/nego/requests").contentType("application/json").content(body))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.perAccount[0].met").value(true))
            .andReturn().getResponse().getContentAsString();
        String requestId = json.readTree(resp).get("requestId").asText();

        mvc.perform(post("/api/nego/requests/" + requestId + "/approve").param("baseDate", D))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.inserted", greaterThan(0)));

        mvc.perform(get("/api/accounts/7022-3345-11/bindings"))
            .andExpect(jsonPath("$[?(@.sourceType == 'NEGOTIATED')]").isNotEmpty());
    }

    @Test
    void 미충족_계좌는_영업예외_사유_없으면_400() throws Exception {
        String body = """
            {"accountIds":["5533-1100-99"],"ruleId":"R-NEGO-OS","requestedBy":"tester"}""";
        mvc.perform(post("/api/nego/requests").contentType("application/json").content(body))
            .andExpect(status().isBadRequest());
    }

    @Test
    void 미충족_계좌도_영업예외_사유_있으면_요청_생성() throws Exception {
        String body = """
            {"accountIds":["5533-1100-99"],"ruleId":"R-NEGO-OS",
             "exceptionReasons":{"5533-1100-99":"영업상 우대 필요"},"requestedBy":"tester"}""";
        mvc.perform(post("/api/nego/requests").contentType("application/json").content(body))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.perAccount[0].qualifyType").value("EXCEPTION"));
    }

    @Test
    void 대시보드_집계() throws Exception {
        rebuilder.fullRebuild(LocalDate.of(2026, 7, 7));
        mvc.perform(get("/api/dashboard"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.activeRules", greaterThan(0)))
            .andExpect(jsonPath("$.bindingRows", greaterThan(0)));
    }

    @Test
    void 배치_트리거_API() throws Exception {
        // 멱등이라 inserted 는 상태에 따라 0일 수 있음 — 실행 성공과 이력 기록을 확인
        mvc.perform(post("/api/batch/rebuild").param("baseDate", D))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.unchanged").exists());
        mvc.perform(get("/api/batch/runs"))
            .andExpect(jsonPath("$[0].runType").value("FULL_REBUILD"));
    }
}
