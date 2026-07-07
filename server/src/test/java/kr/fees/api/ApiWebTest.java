package kr.fees.api;

import com.fasterxml.jackson.databind.ObjectMapper;
import kr.fees.persistence.PgIntegrationTest;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

/** API 통합 테스트 베이스 — Testcontainers Postgres + MockMvc. */
@AutoConfigureMockMvc
public abstract class ApiWebTest extends PgIntegrationTest {

    @Autowired
    protected MockMvc mvc;

    @Autowired
    protected ObjectMapper json;
}
