package kr.fees.api;

import org.junit.jupiter.api.Test;

import static org.hamcrest.Matchers.greaterThanOrEqualTo;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class NegoListApiTest extends ApiWebTest {

    @Test
    void 신청_생성후_요청목록에_묶여_나온다() throws Exception {
        String body = """
            {"accountIds":["7022-3345-11"],"ruleId":"R-NEGO-OS","requestedBy":"오세훈"}""";
        mvc.perform(post("/api/nego/requests").contentType("application/json").content(body))
            .andExpect(status().isOk());

        mvc.perform(get("/api/nego/requests").param("status", "REQUESTED"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$[0].ruleId").value("R-NEGO-OS"))
            .andExpect(jsonPath("$[0].items[0].accountName").value("최수진"))
            .andExpect(jsonPath("$[0].items[0].qualifyType").value("MET"));
    }

    @Test
    void 활성_협의_부여목록에_시드_T2가_나온다() throws Exception {
        mvc.perform(get("/api/nego/enrollments"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.length()", greaterThanOrEqualTo(1)))
            .andExpect(jsonPath("$[?(@.accountId == '8041-2237-01' && @.ruleId == 'R-NEGO-02')]").isNotEmpty());
    }
}
