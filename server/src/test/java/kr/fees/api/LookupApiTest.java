package kr.fees.api;

import kr.fees.batch.BindingRebuilder;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.LocalDate;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class LookupApiTest extends ApiWebTest {

    @Autowired BindingRebuilder rebuilder;

    @BeforeEach
    void rebuild() {
        rebuilder.fullRebuild(LocalDate.of(2026, 7, 7));
    }

    @Test
    void 협의_선물_셀은_배정판_히트로_협의요율표() throws Exception {
        mvc.perform(get("/api/lookup")
                .param("accountId", "8041-2237-01")
                .param("assetClass", "OVERSEAS_DERIV")
                .param("lookupKey", "FUTURES")
                .param("exchange", "CME").param("product", "ES").param("channel", "MTS")
                .param("tradeDate", "2026-07-07"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.sourceRuleId").value("R-NEGO-02"))
            .andExpect(jsonPath("$.sourceType").value("NEGOTIATED"))
            .andExpect(jsonPath("$.fallbackToBase").value(false));
    }

    @Test
    void 기본_셀은_배정판_미스로_기본요율표_fallback() throws Exception {
        // ES 옵션은 배정판에 없음 → 기본(R-BASE-05) fallback
        mvc.perform(get("/api/lookup")
                .param("accountId", "8041-2237-01")
                .param("assetClass", "OVERSEAS_DERIV")
                .param("lookupKey", "OPTIONS")
                .param("exchange", "CME").param("product", "ES").param("channel", "MTS")
                .param("tradeDate", "2026-07-07"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.sourceRuleId").value("R-BASE-05"))
            .andExpect(jsonPath("$.sourceType").value("BASE"))
            .andExpect(jsonPath("$.fallbackToBase").value(true));
    }

    @Test
    void ETF_셀은_이벤트요율표() throws Exception {
        mvc.perform(get("/api/lookup")
                .param("accountId", "8041-2237-01")
                .param("assetClass", "OVERSEAS_STOCK")
                .param("lookupKey", "ETF")
                .param("channel", "MTS").param("tradeDate", "2026-07-07"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.scheduleId").value("SCH-OS-EVT-03"))
            .andExpect(jsonPath("$.sourceType").value("EVENT"));
    }

    @Test
    void 계산은_구성요소_명세를_반환() throws Exception {
        String body = """
            {"scheduleId":"SCH-OS-BASE","price":100,"qty":100}""";
        mvc.perform(post("/api/calc").contentType("application/json").content(body))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.customerTotal").value(25.00))   // 10,000 * 25bp
            .andExpect(jsonPath("$.lines[0].name").value("자사 수수료"));
    }

    @Test
    void 배정판_조회() throws Exception {
        mvc.perform(get("/api/accounts/8041-2237-01/bindings"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$[0].accountId").value("8041-2237-01"));
    }
}
