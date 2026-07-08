package kr.fees.api;

import org.junit.jupiter.api.Test;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** 정책 우선순위 API — PolicyPriority 화면용. 계좌 무관(자격 무시) 통합 랭킹. */
class PriorityApiTest extends ApiWebTest {

    @Test
    void 해외파생_랭킹_요율오름차순_T3_T2_기본() throws Exception {
        mvc.perform(get("/api/priority")
                .param("assetClass", "OVERSEAS_DERIV").param("tradeDate", "2026-07-07"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$[0].ruleId").value("R-NEGO-03"))
            .andExpect(jsonPath("$[0].ruleType").value("NEGOTIATED"))
            .andExpect(jsonPath("$[0].scheduleName").isNotEmpty())
            .andExpect(jsonPath("$[1].ruleId").value("R-NEGO-02"))
            .andExpect(jsonPath("$[2].ruleId").value("R-BASE-05"))
            .andExpect(jsonPath("$[2].ruleType").value("BASE"));
    }

    @Test
    void 전체_랭킹_활성만_포함_승인대기_제외() throws Exception {
        mvc.perform(get("/api/priority").param("tradeDate", "2026-07-07"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$[?(@.ruleId == 'R-EVT-12')]").exists())
            .andExpect(jsonPath("$[?(@.ruleId == 'R-EVT-DS')]").doesNotExist());
    }

    @Test
    void top_ES선물_협의T3_이론상최저() throws Exception {
        mvc.perform(get("/api/priority/top")
                .param("assetClass", "OVERSEAS_DERIV").param("lookupKey", "FUTURES")
                .param("exchange", "CME").param("product", "ES").param("channel", "MTS")
                .param("tradeDate", "2026-07-07"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.top.ruleId").value("R-NEGO-03"));
    }

    @Test
    void top_옵션은_협의범위밖_기본이최저() throws Exception {
        mvc.perform(get("/api/priority/top")
                .param("assetClass", "OVERSEAS_DERIV").param("lookupKey", "OPTIONS")
                .param("exchange", "CME").param("product", "ES").param("channel", "MTS")
                .param("tradeDate", "2026-07-07"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.top.ruleId").value("R-BASE-05"));
    }
}
