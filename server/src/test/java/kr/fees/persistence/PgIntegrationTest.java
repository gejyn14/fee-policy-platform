package kr.fees.persistence;

import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.annotation.Transactional;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * 통합 테스트 베이스. postgres:16 컨테이너 한 개를 정적으로 공유하고(Flyway가 스키마 적용),
 * 각 테스트가 상속해 JdbcTemplate·저장소를 주입받는다. Podman 소켓(/var/run/docker.sock)으로 붙는다.
 * @Transactional 로 각 테스트 메서드가 롤백돼 시드 상태가 서로 오염되지 않는다.
 */
@SpringBootTest
@Testcontainers
@Transactional
public abstract class PgIntegrationTest {

    static final PostgreSQLContainer<?> PG = new PostgreSQLContainer<>("postgres:16");

    static {
        PG.start();
    }

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", PG::getJdbcUrl);
        r.add("spring.datasource.username", PG::getUsername);
        r.add("spring.datasource.password", PG::getPassword);
    }
}
