package kr.fees.api;

import kr.fees.batch.BindingRebuilder;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.LocalDate;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class TraceApiTest extends ApiWebTest {

    @Autowired BindingRebuilder rebuilder;

    @BeforeEach
    void rebuild() {
        rebuilder.fullRebuild(LocalDate.of(2026, 7, 7));
    }

    @Test
    void ES선물_추적_T3탈락_T2승자_배정판히트() throws Exception {
        mvc.perform(get("/api/trace")
                .param("accountId", "8041-2237-01").param("assetClass", "OVERSEAS_DERIV")
                .param("lookupKey", "FUTURES").param("exchange", "CME").param("product", "ES")
                .param("channel", "MTS").param("tradeDate", "2026-07-07"))
            .andExpect(status().isOk())
            // T3(R-NEGO-03)는 협의 부여 없어 탈락
            .andExpect(jsonPath("$.candidates[?(@.ruleId == 'R-NEGO-03')].gatePass").value(false))
            .andExpect(jsonPath("$.candidates[?(@.ruleId == 'R-NEGO-03')].gateNote").value("협의 부여 없음/기간 밖"))
            // T2(R-NEGO-02)가 승자
            .andExpect(jsonPath("$.candidates[?(@.ruleId == 'R-NEGO-02')].winner").value(true))
            .andExpect(jsonPath("$.bindingHit").value(true))
            .andExpect(jsonPath("$.applied.sourceType").value("NEGOTIATED"));
    }

    @Test
    void K200옵션_추적_기본승자_미스_fallback() throws Exception {
        mvc.perform(get("/api/trace")
                .param("accountId", "8041-2237-01").param("assetClass", "DOMESTIC_DERIV")
                .param("lookupKey", "OPTIONS").param("exchange", "KRX").param("product", "K200")
                .param("channel", "MTS").param("tradeDate", "2026-07-07"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.candidates[?(@.ruleId == 'R-BASE-DD')].winner").value(true))
            .andExpect(jsonPath("$.bindingHit").value(false))
            .andExpect(jsonPath("$.applied.fallbackToBase").value(true));
    }
}
